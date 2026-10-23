import sharp from "sharp";
import { assetReferences, referencesBlock } from "./references";
import { digest, fail, id, runIdempotent } from "@album/server-core";
import type {
  Actor,
  Database,
  ObjectStore,
  QuotaPolicyPort,
  StorageConfig,
  StorageLocator,
  WorkspaceAuthorization,
} from "./types";
import type { AssetRecord, ImageVariant, ResourcePort } from "@album/assets";
import type { PoolClient } from "pg";
import {
  pageLimit,
  validateSearch,
  pageCursor,
  readPageCursor,
} from "./pagination";
export interface AssetListQuery {
  folderId?: string | null;
  cursor?: string | null;
  limit?: number;
  state?: "ready" | "pending_scan" | "rejected" | "trashed";
  q?: string;
  sort?: "name_asc" | "created_desc";
}
export interface UploadCompletionExpected {
  assetId: string;
  sha256: string;
  sizeBytes: number;
}
export async function rowToLocator(
  tx: PoolClient,
  r: any,
): Promise<StorageLocator> {
  const p = (
    await tx.query(
      "SELECT profile_id,version FROM storage_profile_versions WHERE id=$1",
      [r.profile_version_id],
    )
  ).rows[0];
  return {
    storageProfileId: p.profile_id,
    profileVersion: p.version,
    bucket: r.bucket,
    key: r.object_key,
    objectVersionId: r.object_version_id ?? null,
    sha256: r.sha256,
    variant: r.kind ?? "original",
  };
}
export class UploadService {
  constructor(
    private db: Database,
    private workspaces: WorkspaceAuthorization,
    private store: ObjectStore,
    private quota: QuotaPolicyPort,
    private config: StorageConfig,
  ) {
    if (
      !config.basePrefix ||
      config.basePrefix.startsWith("/") ||
      config.basePrefix.includes("..") ||
      /[\\\p{Cc}]/u.test(config.basePrefix)
    )
      fail("INVALID_STORAGE_PREFIX");
  }
  private locator(
    key: string,
    sha256: string,
    variant = "original",
  ): StorageLocator {
    return {
      storageProfileId: this.config.storageProfileId,
      profileVersion: this.config.profileVersion,
      bucket: this.config.bucket,
      key,
      objectVersionId: null,
      sha256,
      variant,
    };
  }
  async beginUpload(
    actor: Actor,
    wid: string,
    input: {
      bytes: number;
      sha256: string;
      mime: "image/jpeg" | "image/png";
      folderId: string | null;
      projectId: string | null;
      filename?: string;
    },
    key: string,
  ) {
    if (
      !Number.isSafeInteger(input.bytes) ||
      input.bytes < 1 ||
      input.bytes > 25000000 ||
      !/^([0-9a-f]{64})$/.test(input.sha256) ||
      !["image/jpeg", "image/png"].includes(input.mime)
    )
      fail("INVALID_UPLOAD");
    const policy = await this.quota.readQuota(wid);
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        wid + ":assets",
      ]);
      await this.workspaces.authorize(actor, wid, "manageAssets", tx);
      return runIdempotent(
        tx,
        wid + ":upload",
        key,
        digest(JSON.stringify(input)),
        async () => {
          if (
            input.folderId &&
            !(
              await tx.query(
                "SELECT id FROM asset_folders WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
                [wid, input.folderId],
              )
            ).rowCount
          )
            fail("NOT_FOUND", 404);
          if (input.projectId) {
            if (
              !(
                await tx.query(
                  "SELECT id FROM projects WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
                  [wid, input.projectId],
                )
              ).rowCount
            )
              fail("NOT_FOUND", 404);
            const count = Number(
              (
                await tx.query(
                  "SELECT count(*) FROM project_revision_assets p WHERE p.workspace_id=$1 AND p.revision_id=(SELECT r.id FROM project_revisions r JOIN projects p ON p.workspace_id=r.workspace_id AND p.id=r.project_id AND p.current_revision=r.number WHERE p.workspace_id=$1 AND p.id=$2)",
                  [wid, input.projectId],
                )
              ).rows[0].count,
            );
            if (count >= policy.maxProjectPhotos)
              fail("PROJECT_PHOTO_LIMIT", 409);
          }
          await tx.query(
            "INSERT INTO storage_usage_accounts(id,workspace_id,category,limit_bytes) VALUES($1,$2,'original',$3) ON CONFLICT(workspace_id,category) DO NOTHING",
            [id(), wid, policy.limitBytes],
          );
          const account = (
            await tx.query(
              "SELECT * FROM storage_usage_accounts WHERE workspace_id=$1 AND category='original' FOR UPDATE",
              [wid],
            )
          ).rows[0];
          const expired = (
            await tx.query(
              "UPDATE storage_quota_reservations SET state='expired' WHERE workspace_id=$1 AND usage_account_id=$2 AND state='held' AND expires_at<=now() RETURNING bytes",
              [wid, account.id],
            )
          ).rows.reduce((n, r) => n + Number(r.bytes), 0);
          const reserved = Number(account.reserved_bytes) - expired;
          if (
            Number(account.used_bytes) + reserved + input.bytes >
            policy.limitBytes
          )
            fail("STORAGE_QUOTA_EXCEEDED", 409);
          await tx.query(
            "UPDATE storage_usage_accounts SET reserved_bytes=$2,limit_bytes=$3,revision=revision+1 WHERE id=$1",
            [account.id, reserved + input.bytes, policy.limitBytes],
          );
          const uploadId = id(),
            assetId = id(),
            reservation = id(),
            objectKey = `${this.config.basePrefix}/${wid}/${assetId}/original`,
            ttl = this.config.uploadTtlSeconds ?? 900,
            expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
          await tx.query(
            "INSERT INTO storage_quota_reservations(id,workspace_id,usage_account_id,operation_id,bytes,expires_at) VALUES($1,$2,$3,$4,$5,$6)",
            [reservation, wid, account.id, uploadId, input.bytes, expiresAt],
          );
          await tx.query(
            "INSERT INTO assets(id,workspace_id,folder_id,original_filename,byte_size,mime_type,origin) VALUES($1,$2,$3,$4,$5,$6,'upload')",
            [
              assetId,
              wid,
              input.folderId,
              input.filename ?? "upload",
              input.bytes,
              input.mime,
            ],
          );
          await tx.query(
            "INSERT INTO upload_sessions(id,workspace_id,asset_id,quota_reservation_id,profile_version_id,bucket,object_key,created_by,expected_bytes,expected_mime,expires_at,expected_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
            [
              uploadId,
              wid,
              assetId,
              reservation,
              this.config.profileVersionId,
              this.config.bucket,
              objectKey,
              actor.userId,
              input.bytes,
              input.mime,
              expiresAt,
              input.sha256,
            ],
          );
          return {
            uploadId,
            assetId,
            url: await this.store.sign(
              this.locator(objectKey, input.sha256),
              "upload",
              ttl,
            ),
            expiresAt,
            method: "PUT" as const,
            headers: [{ name: "Content-Type", value: input.mime }],
            formFields: [],
            maxBytes: input.bytes,
          };
        },
      );
    });
  }
  async completeUpload(
    actor: Actor,
    wid: string,
    uploadId: string,
    key: string,
    expected?: UploadCompletionExpected,
  ): Promise<AssetRecord> {
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "manageAssets", tx);
      return runIdempotent(
        tx,
        wid + ":upload-complete",
        key,
        digest(JSON.stringify({ uploadId, expected: expected ?? null })),
        async () => {
          const u = (
            await tx.query(
              "SELECT u.*,u.expected_sha256 AS sha256,a.original_filename FROM upload_sessions u JOIN assets a ON a.workspace_id=u.workspace_id AND a.id=u.asset_id WHERE u.workspace_id=$1 AND u.id=$2 FOR UPDATE OF u",
              [wid, uploadId],
            )
          ).rows[0];
          if (!u) fail("NOT_FOUND", 404);
          if (
            expected &&
            (expected.assetId !== u.asset_id ||
              expected.sha256 !== u.sha256 ||
              expected.sizeBytes !== Number(u.expected_bytes))
          )
            fail("UPLOAD_TICKET_MISMATCH", 409);
          if (u.state === "ready") return this.record(tx, wid, u.asset_id);
          if (u.expires_at <= new Date()) fail("UPLOAD_EXPIRED", 409);
          const original = await this.store.read(
            await rowToLocator(tx, {
              profile_version_id: u.profile_version_id,
              bucket: u.bucket,
              object_key: u.object_key,
              object_version_id: null,
              sha256: u.sha256,
              kind: "original",
            }),
          );
          if (
            original.length !== Number(u.expected_bytes) ||
            digest(original) !== u.sha256
          )
            fail("UPLOAD_CHECKSUM_MISMATCH");
          let normalized: Buffer,
            preview: Buffer,
            width: number,
            height: number,
            originalWidth: number,
            originalHeight: number;
          try {
            const image = sharp(original, {
                failOn: "warning",
                limitInputPixels: 80000000,
              }),
              metadata = await image.metadata();
            if (
              !metadata.width ||
              !metadata.height ||
              !["jpeg", "png"].includes(metadata.format ?? "") ||
              (metadata.pages && metadata.pages > 1) ||
              `image/${metadata.format}` !== u.expected_mime
            )
              throw Error();
            originalWidth = metadata.width;
            originalHeight = metadata.height;
            normalized = await image
              .rotate()
              .toColourspace("srgb")
              .png()
              .toBuffer();
            const m = await sharp(normalized).metadata();
            width = m.width!;
            height = m.height!;
            preview = await sharp(normalized)
              .resize({
                width: 1200,
                height: 1200,
                fit: "inside",
                withoutEnlargement: true,
              })
              .png()
              .toBuffer();
          } catch {
            fail("INVALID_IMAGE");
          }
          const variants: {
            kind: string;
            bytes: Uint8Array;
            width: number;
            height: number;
            mime: string;
            objectId: string;
          }[] = [
            {
              kind: "original",
              bytes: original,
              width: originalWidth!,
              height: originalHeight!,
              mime: u.expected_mime,
              objectId: id(),
            },
            {
              kind: "normalized",
              bytes: normalized!,
              width: width!,
              height: height!,
              mime: "image/png",
              objectId: id(),
            },
            {
              kind: "preview",
              bytes: preview!,
              width: 0,
              height: 0,
              mime: "image/png",
              objectId: id(),
            },
          ];
          const pm = await sharp(preview!).metadata();
          variants[2].width = pm.width!;
          variants[2].height = pm.height!;
          const total = variants.reduce((n, v) => n + v.bytes.length, 0),
            policy = await this.quota.readQuota(wid);
          const account = (
            await tx.query(
              "SELECT a.*,r.bytes AS held_bytes,r.state AS reservation_state FROM storage_usage_accounts a JOIN storage_quota_reservations r ON r.usage_account_id=a.id AND r.workspace_id=a.workspace_id WHERE r.workspace_id=$1 AND r.id=$2 FOR UPDATE OF a,r",
              [wid, u.quota_reservation_id],
            )
          ).rows[0];
          if (account.reservation_state !== "held") fail("UPLOAD_EXPIRED", 409);
          if (
            Number(account.used_bytes) +
              Number(account.reserved_bytes) -
              Number(account.held_bytes) +
              total >
            policy.limitBytes
          )
            fail("STORAGE_QUOTA_EXCEEDED", 409);
          for (const v of variants) {
            const hash = digest(v.bytes),
              objectKey =
                v.kind === "original"
                  ? u.object_key
                  : `${this.config.basePrefix}/${wid}/${u.asset_id}/${v.kind}`;
            if (v.kind !== "original")
              await this.store.put(
                this.locator(objectKey, hash, v.kind),
                v.bytes,
              );
            await tx.query(
              "INSERT INTO storage_objects(id,workspace_id,profile_version_id,bucket,object_key,kind,sha256,byte_size,mime_type,state,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified',now())",
              [
                v.objectId,
                wid,
                v.kind === "original"
                  ? u.profile_version_id
                  : this.config.profileVersionId,
                v.kind === "original" ? u.bucket : this.config.bucket,
                objectKey,
                v.kind,
                hash,
                v.bytes.length,
                v.mime,
              ],
            );
            if (v.kind !== "original")
              await tx.query(
                "INSERT INTO asset_variants(id,workspace_id,asset_id,variant,storage_object_id,pipeline_version,width,height) VALUES($1,$2,$3,$4,$5,'sharp-v1',$6,$7)",
                [id(), wid, u.asset_id, v.kind, v.objectId, v.width, v.height],
              );
          }
          await tx.query(
            "UPDATE assets SET original_object_id=$3,width=$4,height=$5,sha256=$6,state='ready',revision=revision+1 WHERE workspace_id=$1 AND id=$2",
            [wid, u.asset_id, variants[0].objectId, width!, height!, u.sha256],
          );
          await tx.query(
            "UPDATE upload_sessions SET state='ready',completed_at=now(),revision=revision+1 WHERE workspace_id=$1 AND id=$2",
            [wid, uploadId],
          );
          await tx.query(
            "UPDATE storage_quota_reservations SET state='consumed' WHERE workspace_id=$1 AND id=$2",
            [wid, u.quota_reservation_id],
          );
          await tx.query(
            "UPDATE storage_usage_accounts SET reserved_bytes=reserved_bytes-$2,used_bytes=used_bytes+$3,revision=revision+1 WHERE id=$1",
            [account.id, Number(account.held_bytes), total],
          );
          return this.record(tx, wid, u.asset_id);
        },
      );
    });
  }
  private async record(
    tx: PoolClient,
    wid: string,
    assetId: string,
  ): Promise<AssetRecord> {
    const a = (
      await tx.query(
        "SELECT * FROM assets WHERE workspace_id=$1 AND id=$2 AND state='ready' AND deleted_at IS NULL",
        [wid, assetId],
      )
    ).rows[0];
    if (!a) fail("NOT_FOUND", 404);
    const rows = (
      await tx.query(
        "SELECT o.*,v.variant,v.width,v.height FROM asset_variants v JOIN storage_objects o ON o.workspace_id=v.workspace_id AND o.id=v.storage_object_id WHERE v.workspace_id=$1 AND v.asset_id=$2 UNION ALL SELECT o.*,'original' AS variant,a.width,a.height FROM assets a JOIN storage_objects o ON o.workspace_id=a.workspace_id AND o.id=a.original_object_id WHERE a.workspace_id=$1 AND a.id=$2",
        [wid, assetId],
      )
    ).rows;
    const variants = {} as Record<
      "original" | "normalized" | "preview",
      ImageVariant
    >;
    for (const r of rows) {
      let width = r.width,
        height = r.height;
      if (r.variant === "original") {
        const metadata = await sharp(
          await this.store.read(await rowToLocator(tx, r)),
        ).metadata();
        width = metadata.width!;
        height = metadata.height!;
      }
      variants[r.variant as keyof typeof variants] = {
        sha256: r.sha256,
        byteLength: Number(r.byte_size),
        mimeType: r.mime_type,
        width,
        height,
      };
    }
    return {
      id: a.id,
      version: Number(a.content_version ?? 1),
      sha256: a.sha256,
      width: a.width,
      height: a.height,
      mimeType: "image/png",
      source: { kind: "import", name: a.original_filename },
      license: { id: "user-provided", usable: true },
      status: "ready",
      variants,
    };
  }
  async moveAsset(
    actor: Actor,
    wid: string,
    assetId: string,
    expectedRevision: number,
    folderId: string | null,
    key: string,
  ) {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        wid + ":assets",
      ]);
      await this.workspaces.authorize(actor, wid, "manageAssets", tx);
      return runIdempotent(
        tx,
        wid + ":asset-move-one",
        key,
        digest(JSON.stringify({ assetId, expectedRevision, folderId })),
        async () => {
          const asset = (
            await tx.query(
              "SELECT * FROM assets WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",
              [wid, assetId],
            )
          ).rows[0];
          if (!asset) fail("NOT_FOUND", 404);
          if (Number(asset.revision) !== expectedRevision)
            fail("REVISION_CONFLICT", 409);
          if (asset.state !== "ready") fail("ASSET_NOT_READY", 409);
          if (
            folderId &&
            !(
              await tx.query(
                "SELECT id FROM asset_folders WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
                [wid, folderId],
              )
            ).rowCount
          )
            fail("NOT_FOUND", 404);
          const changed = (
            await tx.query(
              "UPDATE assets SET folder_id=$3,revision=revision+1 WHERE workspace_id=$1 AND id=$2 RETURNING *",
              [wid, assetId, folderId],
            )
          ).rows[0];
          return {
            ...this.assetDto(changed),
            editorResource: await this.record(tx, wid, assetId),
          };
        },
      );
    });
  }
  async references(actor: Actor, wid: string, assetId: string) {
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "read", tx);
      if (
        !(
          await tx.query(
            "SELECT id FROM assets WHERE workspace_id=$1 AND id=$2",
            [wid, assetId],
          )
        ).rowCount
      )
        fail("NOT_FOUND", 404);
      return assetReferences(tx, wid, [assetId]);
    });
  }
  async trashAsset(
    actor: Actor,
    wid: string,
    assetId: string,
    expectedRevision: number,
    key: string,
  ) {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        wid + ":assets",
      ]);
      await this.workspaces.authorize(actor, wid, "deleteAssets", tx);
      return runIdempotent(
        tx,
        wid + ":asset-trash",
        key,
        digest(JSON.stringify({ assetId, expectedRevision })),
        async () => {
          const asset = (
            await tx.query(
              "SELECT * FROM assets WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL FOR UPDATE",
              [wid, assetId],
            )
          ).rows[0];
          if (!asset) fail("NOT_FOUND", 404);
          if (Number(asset.revision) !== expectedRevision)
            fail("REVISION_CONFLICT", 409);
          if (asset.state !== "ready") fail("ASSET_NOT_READY", 409);
          const references = await assetReferences(tx, wid, [assetId]);
          if (referencesBlock(references))
            fail("ASSET_IN_USE", 409, references);
          const operation = id();
          await tx.query(
            "INSERT INTO trash_operations(id,workspace_id,operation_id,created_by,restore_until) VALUES($1,$2,$3,$4,now()+interval '30 days')",
            [operation, wid, id(), actor.userId],
          );
          await tx.query(
            "INSERT INTO trash_items(id,workspace_id,trash_operation_id,asset_id,original_parent_id,original_name,expected_revision) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              id(),
              wid,
              operation,
              assetId,
              asset.folder_id,
              asset.original_filename,
              expectedRevision + 1,
            ],
          );
          const changed = (
            await tx.query(
              "UPDATE assets SET state='trashed',deleted_at=now(),revision=revision+1 WHERE workspace_id=$1 AND id=$2 RETURNING *",
              [wid, assetId],
            )
          ).rows[0];
          return this.assetDto(changed);
        },
      );
    });
  }
  async restoreAsset(
    actor: Actor,
    wid: string,
    assetId: string,
    folderId: string | null,
    expectedRevision: number | undefined,
    key: string,
  ) {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        wid + ":assets",
      ]);
      await this.workspaces.authorize(actor, wid, "manageAssets", tx);
      return runIdempotent(
        tx,
        wid + ":asset-restore",
        key,
        digest(
          JSON.stringify({
            assetId,
            folderId,
            expectedRevision: expectedRevision ?? null,
          }),
        ),
        async () => {
          const asset = (
            await tx.query(
              "SELECT * FROM assets WHERE workspace_id=$1 AND id=$2 AND state='trashed' AND deleted_at IS NOT NULL FOR UPDATE",
              [wid, assetId],
            )
          ).rows[0];
          if (!asset) fail("NOT_FOUND", 404);
          if (
            expectedRevision !== undefined &&
            Number(asset.revision) !== expectedRevision
          )
            fail("REVISION_CONFLICT", 409);
          if (
            folderId &&
            !(
              await tx.query(
                "SELECT id FROM asset_folders WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL",
                [wid, folderId],
              )
            ).rowCount
          )
            fail("NOT_FOUND", 404);
          const operation = (
            await tx.query(
              "SELECT o.id FROM trash_operations o JOIN trash_items i ON i.workspace_id=o.workspace_id AND i.trash_operation_id=o.id WHERE i.workspace_id=$1 AND i.asset_id=$2 AND o.state='trashed' AND o.restore_until>now() ORDER BY o.created_at DESC LIMIT 1",
              [wid, assetId],
            )
          ).rows[0];
          if (!operation) fail("RESTORE_EXPIRED", 409);
          const objects = (
            await tx.query(
              "SELECT o.*,'original' AS variant FROM storage_objects o WHERE o.workspace_id=$1 AND o.id=$2 UNION ALL SELECT o.*,v.variant FROM storage_objects o JOIN asset_variants v ON v.workspace_id=o.workspace_id AND v.storage_object_id=o.id WHERE v.workspace_id=$1 AND v.asset_id=$3 AND v.variant IN('normalized','preview')",
              [wid, asset.original_object_id, assetId],
            )
          ).rows;
          if (
            objects.length !== 3 ||
            objects.some((o) => o.state !== "verified" || o.deleted_at)
          )
            fail("RESOURCE_MISSING", 409);
          for (const object of objects) {
            const bytes = await this.store.read(await rowToLocator(tx, object));
            if (
              bytes.length !== Number(object.byte_size) ||
              digest(bytes) !== object.sha256
            )
              fail("RESOURCE_HASH_MISMATCH", 409);
          }
          const changed = (
            await tx.query(
              "UPDATE assets SET state='ready',deleted_at=NULL,folder_id=$3,revision=revision+1 WHERE workspace_id=$1 AND id=$2 RETURNING *",
              [wid, assetId, folderId],
            )
          ).rows[0];
          await tx.query(
            "UPDATE trash_operations o SET state='restored',revision=revision+1 WHERE o.workspace_id=$1 AND o.id=$2 AND NOT EXISTS(SELECT 1 FROM trash_items i LEFT JOIN assets a ON a.workspace_id=i.workspace_id AND a.id=i.asset_id LEFT JOIN asset_folders f ON f.workspace_id=i.workspace_id AND f.id=i.folder_id WHERE i.workspace_id=o.workspace_id AND i.trash_operation_id=o.id AND (a.deleted_at IS NOT NULL OR f.deleted_at IS NOT NULL))",
            [wid, operation.id],
          );
          return {
            ...this.assetDto(changed),
            editorResource: await this.record(tx, wid, assetId),
          };
        },
      );
    });
  }
  async usage(actor: Actor, wid: string) {
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "read", tx);
      const policy = await this.quota.readQuota(wid);
      let projectLimit = policy.projectLimit;
      if (projectLimit === undefined) {
        const profile = (
          await tx.query(
            "SELECT environment,provider FROM storage_profile_versions WHERE id=$1",
            [this.config.profileVersionId],
          )
        ).rows[0];
        if (profile?.environment !== "dev" || profile?.provider !== "local")
          fail("QUOTA_POLICY_UNCONFIGURED", 503);
        projectLimit = Number.MAX_SAFE_INTEGER;
      }
      if (!Number.isSafeInteger(projectLimit) || projectLimit < 0)
        fail("QUOTA_POLICY_UNCONFIGURED", 503);
      const physical = (
        await tx.query(
          "SELECT coalesce(sum(byte_size),0) AS bytes FROM storage_objects WHERE workspace_id=$1 AND state NOT IN('deleted','missing')",
          [wid],
        )
      ).rows[0];
      const reserved = (
        await tx.query(
          "SELECT coalesce(sum(bytes),0) AS bytes FROM storage_quota_reservations WHERE workspace_id=$1 AND state='held' AND expires_at>now()",
          [wid],
        )
      ).rows[0];
      const recycle = (
        await tx.query(
          "SELECT coalesce(sum(o.byte_size),0) AS bytes FROM storage_objects o WHERE o.workspace_id=$1 AND o.state NOT IN('deleted','missing') AND o.id IN(SELECT original_object_id FROM assets WHERE workspace_id=$1 AND state='trashed' UNION SELECT v.storage_object_id FROM asset_variants v JOIN assets a ON a.workspace_id=v.workspace_id AND a.id=v.asset_id WHERE a.workspace_id=$1 AND a.state='trashed' UNION SELECT r.storage_object_id FROM project_revisions r JOIN projects p ON p.workspace_id=r.workspace_id AND p.id=r.project_id WHERE p.workspace_id=$1 AND p.state='trashed')",
          [wid],
        )
      ).rows[0];
      const counts = (
        await tx.query(
          "SELECT (SELECT count(*) FROM projects WHERE workspace_id=$1 AND deleted_at IS NULL AND state IN('active','archived')) AS projects,(SELECT count(*) FROM workspace_members WHERE workspace_id=$1 AND state='active') AS seats,(SELECT settings_json FROM workspace_settings WHERE workspace_id=$1) AS settings,now() AS measured_at",
          [wid],
        )
      ).rows[0];
      return {
        storageBytes: Number(physical.bytes),
        reservedUploadBytes: Number(reserved.bytes),
        recycleBinBytes: Number(recycle.bytes),
        storageLimitBytes: policy.limitBytes,
        projectCount: Number(counts.projects),
        projectLimit,
        seatCount: Number(counts.seats),
        seatLimit: Number(counts.settings?.seatLimit ?? 1),
        measuredAt: counts.measured_at.toISOString(),
      };
    });
  }
  async getAsset(actor: Actor, wid: string, assetId: string) {
    return this.db.transaction((tx) =>
      this.getAssetInTx(tx, actor, wid, assetId),
    );
  }
  /** Reuses the caller's transaction and locks metadata throughout trusted validation. */
  async getAssetInTx(
    tx: PoolClient,
    actor: Actor,
    wid: string,
    assetId: string,
  ) {
    await this.workspaces.authorize(actor, wid, "read", tx);
    const asset = (
      await tx.query(
        "SELECT * FROM assets WHERE workspace_id=$1 AND id=$2 FOR SHARE",
        [wid, assetId],
      )
    ).rows[0];
    if (!asset) fail("NOT_FOUND", 404);
    return {
      ...this.assetDto(asset),
      ...(asset.state === "ready" && !asset.deleted_at
        ? { editorResource: await this.record(tx, wid, assetId) }
        : {}),
    };
  }
  private assetDto(a: any) {
    return {
      id: a.id,
      workspaceId: a.workspace_id,
      originalFilename: a.original_filename,
      folderId: a.folder_id,
      origin: a.origin,
      state: a.state,
      ...(a.sha256 ? { sha256: a.sha256 } : {}),
      ...(a.width ? { width: a.width, height: a.height } : {}),
      sizeBytes: Number(a.byte_size),
      revision: Number(a.revision),
      createdAt: a.created_at.toISOString(),
    };
  }
  async listAssets(actor: Actor, wid: string, input: AssetListQuery = {}) {
    const limit = pageLimit(input.limit),
      q = validateSearch(input.q),
      state = input.state ?? null,
      sort = input.sort ?? "created_desc";
    if (
      (state !== null &&
        !["ready", "pending_scan", "rejected", "trashed"].includes(state)) ||
      !["name_asc", "created_desc"].includes(sort) ||
      (input.folderId !== undefined &&
        input.folderId !== null &&
        (typeof input.folderId !== "string" ||
          input.folderId.length < 1 ||
          input.folderId.length > 128))
    )
      fail("INVALID_REQUEST");
    const filters = {
      folderId: input.folderId ?? null,
      filterFolder: input.folderId !== undefined,
      q,
      state,
      sort,
    };
    const cursor = readPageCursor(input.cursor, "assets", wid, filters);
    if (cursor && typeof cursor.value !== "string") fail("INVALID_CURSOR");
    if (
      cursor &&
      sort === "created_desc" &&
      !Number.isFinite(Date.parse(cursor.value!))
    )
      fail("INVALID_CURSOR");
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "read", tx);
      const cursorClause =
        sort === "name_asc"
          ? '($3::text IS NULL OR (original_filename COLLATE "C",id COLLATE "C")>($3::text COLLATE "C",$4::text COLLATE "C"))'
          : "($3::timestamptz IS NULL OR (created_at,id)<($3::timestamptz,$4::text))";
      const order =
        sort === "name_asc"
          ? 'original_filename COLLATE "C" ASC,id COLLATE "C" ASC'
          : "created_at DESC,id DESC";
      const rows = (
        await tx.query(
          `SELECT *,created_at::text AS cursor_created_at FROM assets WHERE workspace_id=$1 AND (($2::text IS NULL AND deleted_at IS NULL) OR ($2::text IS NOT NULL AND state=$2 AND ($2='trashed' OR deleted_at IS NULL))) AND ${cursorClause} AND ($5::boolean OR folder_id IS NOT DISTINCT FROM $6::text) AND ($7::text IS NULL OR position(lower($7) in lower(original_filename))>0) ORDER BY ${order} LIMIT $8`,
          [
            wid,
            state,
            cursor?.value ?? null,
            cursor?.id ?? null,
            input.folderId === undefined,
            input.folderId ?? null,
            q,
            limit + 1,
          ],
        )
      ).rows;
      const last = rows[limit - 1];
      return {
        items: rows.slice(0, limit).map((a) => this.assetDto(a)),
        nextCursor:
          rows.length > limit
            ? pageCursor("assets", wid, filters, {
                id: last.id,
                value:
                  sort === "name_asc"
                    ? last.original_filename
                    : last.cursor_created_at,
              })
            : null,
        hasMore: rows.length > limit,
      };
    });
  }

  async download(
    actor: Actor,
    wid: string,
    assetId: string,
    variant: "original" | "normalized" | "preview" = "original",
  ) {
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "read", tx);
      const a = (
        await tx.query(
          "SELECT * FROM assets WHERE workspace_id=$1 AND id=$2 AND state='ready' AND deleted_at IS NULL",
          [wid, assetId],
        )
      ).rows[0];
      if (!a) fail("NOT_FOUND", 404);
      const r =
        variant === "original"
          ? (
              await tx.query(
                "SELECT * FROM storage_objects WHERE workspace_id=$1 AND id=$2",
                [wid, a.original_object_id],
              )
            ).rows[0]
          : (
              await tx.query(
                "SELECT o.* FROM asset_variants v JOIN storage_objects o ON o.workspace_id=v.workspace_id AND o.id=v.storage_object_id WHERE v.workspace_id=$1 AND v.asset_id=$2 AND v.variant=$3",
                [wid, assetId, variant],
              )
            ).rows[0];
      if (!r || r.state !== "verified") fail("NOT_FOUND", 404);
      const ttl = this.config.downloadTtlSeconds ?? 300;
      return {
        url: await this.store.sign(await rowToLocator(tx, r), "download", ttl),
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      };
    });
  }
  createResourcePort(actor: Actor, wid: string): ResourcePort {
    return {
      read: async (assetId, variant) =>
        this.db.transaction(async (tx) => {
          await this.workspaces.authorize(actor, wid, "read", tx);
          if (variant === "font") {
            const font = (
              await tx.query(
                "SELECT o.* FROM editor_font_faces f JOIN editor_font_bundles b ON b.workspace_id=f.workspace_id AND b.id=f.bundle_id AND b.version=f.bundle_version JOIN storage_objects o ON o.workspace_id=f.workspace_id AND o.id=f.storage_object_id JOIN license_versions l ON l.id=b.license_version_id WHERE f.workspace_id=$1 AND f.face_id=$2 AND b.state='published' AND l.embedding_allowed AND l.valid_from<=now() AND (l.valid_until IS NULL OR l.valid_until>now()) AND o.state='verified' AND o.deleted_at IS NULL LIMIT 1",
                [wid, assetId],
              )
            ).rows[0];
            if (!font) fail("NOT_FOUND", 404);
            const bytes = await this.store.read(await rowToLocator(tx, font));
            if (digest(bytes) !== font.sha256) fail("RESOURCE_HASH_MISMATCH");
            return bytes;
          }
          const a = (
            await tx.query(
              "SELECT * FROM assets WHERE workspace_id=$1 AND id=$2 AND state='ready' AND deleted_at IS NULL",
              [wid, assetId],
            )
          ).rows[0];
          if (!a) fail("NOT_FOUND", 404);
          const r =
            variant === "original"
              ? (
                  await tx.query(
                    "SELECT * FROM storage_objects WHERE workspace_id=$1 AND id=$2",
                    [wid, a.original_object_id],
                  )
                ).rows[0]
              : (
                  await tx.query(
                    "SELECT o.* FROM asset_variants v JOIN storage_objects o ON o.workspace_id=v.workspace_id AND o.id=v.storage_object_id WHERE v.workspace_id=$1 AND v.asset_id=$2 AND v.variant=$3",
                    [wid, assetId, variant],
                  )
                ).rows[0];
          if (!r || r.state !== "verified") fail("NOT_FOUND", 404);
          const bytes = await this.store.read(await rowToLocator(tx, r));
          if (digest(bytes) !== r.sha256) fail("RESOURCE_HASH_MISMATCH");
          return bytes;
        }),
    };
  }
}
