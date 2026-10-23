import sharp from "sharp";
import { rowToLocator } from "../assets/upload";
import {
  canonicalDocument,
  canonicalJson,
  parseDocument,
  allLayers,
  isImageLayer,
  isTextLayer,
  type DocumentModel,
} from "@album/document";
import {
  fontRecordHash,
  type AssetRecord,
  type ResourceManifest,
} from "@album/assets";
import { assertManifest, type SavedRevision } from "@album/storage";
import {
  type Actor,
  type Database,
  fail,
  id,
  digest,
  runIdempotent,
} from "@album/server-core";
import type { PoolClient } from "pg";
import type { ObjectStore, StorageConfig } from "../assets/types";
import { patchDocument, type MiniPatch, type MiniPolicy } from "./mini-patch";
import { nativeMiniPolicy } from "./native-mini-policy";
export interface RevisionAuthorization {
  authorize(
    actor: Actor,
    wid: string,
    action: "read" | "edit",
    tx?: PoolClient,
  ): Promise<unknown>;
}
type ObjectRef = {
  workspaceId: string;
  objectId: string;
  fontVersionId?: string;
};
export class RevisionService {
  constructor(
    private db: Database,
    private workspaces: RevisionAuthorization,
    private objects: ObjectStore,
    private config: StorageConfig,
    private miniPolicy?: MiniPolicy,
    private resolveMiniAsset?: (
      tx: PoolClient,
      actor: Actor,
      wid: string,
      assetId: string,
    ) => Promise<AssetRecord>,
  ) {}
  private async project(tx: PoolClient, wid: string, pid: string) {
    const row = (
      await tx.query(
        `SELECT * FROM projects WHERE workspace_id=$1 AND id=$2 AND state='active' AND deleted_at IS NULL FOR UPDATE`,
        [wid, pid],
      )
    ).rows[0];
    if (!row) fail("PROJECT_NOT_FOUND", 404);
    return row;
  }
  private async loadInTx(
    tx: PoolClient,
    wid: string,
    pid: string,
    revision?: number,
  ): Promise<SavedRevision> {
    const { rows } = await tx.query(
      `SELECT r.*,p.document,p.resources FROM project_revisions r JOIN project_revision_payloads p ON p.revision_id=r.id JOIN projects pr ON pr.id=r.project_id AND pr.workspace_id=r.workspace_id WHERE r.workspace_id=$1 AND r.project_id=$2 AND r.number=COALESCE($3,pr.current_revision) AND pr.deleted_at IS NULL`,
      [wid, pid, revision ?? null],
    );
    const r = rows[0];
    if (!r) fail("REVISION_NOT_FOUND", 404);
    const doc = parseDocument(r.document);
    if (digest(canonicalDocument(doc)) !== r.document_hash)
      fail("STORAGE_CORRUPT", 500);
    return {
      doc,
      docHash: r.document_hash,
      resources: r.resources,
      savedAt: new Date(r.created_at).toISOString(),
    };
  }
  async load(actor: Actor, wid: string, pid: string, revision?: number) {
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "read", tx);
      return this.loadInTx(tx, wid, pid, revision);
    });
  }
  async list(
    actor: Actor,
    wid: string,
    pid: string,
    beforeRevision: number | null = null,
    limit = 20,
  ) {
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "read", tx);
      await this.project(tx, wid, pid);
      return (
        await tx.query(
          "SELECT number AS revision,created_at,created_by,command_id,document_hash FROM project_revisions WHERE workspace_id=$1 AND project_id=$2 AND ($3::bigint IS NULL OR number<$3) ORDER BY number DESC LIMIT $4",
          [wid, pid, beforeRevision, Math.min(101, limit)],
        )
      ).rows.map((r) => ({
        revision: Number(r.revision),
        createdAt: new Date(r.created_at).toISOString(),
        createdBy: r.created_by,
        commandId: r.command_id,
        documentSha256: r.document_hash,
        reason: "Saved revision",
      }));
    });
  }
  async createProject(actor: Actor, wid: string, pid: string, name: string) {
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "edit", tx);
      if (!name.trim() || name.length > 120) fail("INVALID_PROJECT_NAME", 422);
      await tx.query(
        "INSERT INTO projects(id,workspace_id,name,created_by) VALUES($1,$2,$3,$4)",
        [pid, wid, name, actor.userId],
      );
      return { id: pid, name, currentRevision: 0 };
    });
  }
  /** Only the HTTP boundary's validated server-generated initial documents enter here. */
  async createInitialProject(
    actor: Actor,
    wid: string,
    doc: DocumentModel,
    resources: ResourceManifest,
    key: string,
    name: string,
  ): Promise<SavedRevision> {
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "edit", tx);
      return runIdempotent(
        tx,
        `${actor.userId}:${wid}:project:create`,
        key,
        digest(canonicalJson({ doc, resources, name })),
        async () => {
          if (typeof name !== "string" || !name.trim() || name.length > 120)
            fail("INVALID_PROJECT_NAME", 422);
          await tx.query(
            "INSERT INTO projects(id,workspace_id,name,created_by) VALUES($1,$2,$3,$4)",
            [doc.projectId, wid, name, actor.userId],
          );
          return this.saveInTx(tx, actor, wid, doc, 0, resources, key);
        },
      );
    });
  }
  private async validateResources(
    tx: PoolClient,
    actor: Actor,
    wid: string,
    doc: DocumentModel,
    resources: ResourceManifest,
  ): Promise<ObjectRef[]> {
    assertManifest(resources);
    const refs: ObjectRef[] = [];
    const assetIds = new Set(resources.assets.map((a) => a.id)),
      fontIds = new Set(resources.fonts.map((f) => f.id));
    for (const l of allLayers(doc)) {
      if (
        isImageLayer(l) &&
        (!assetIds.has(l.assetId) ||
          (l.alphaMask && !assetIds.has(l.alphaMask.assetId)))
      )
        fail("RESOURCE_MANIFEST_INCOMPLETE", 422);
      if (isTextLayer(l) && !fontIds.has(l.fontAssetId))
        fail("RESOURCE_MANIFEST_INCOMPLETE", 422);
    }
    for (const a of resources.assets) {
      let trustedAsset: AssetRecord | undefined;
      if (this.resolveMiniAsset) {
        const trusted = await this.resolveMiniAsset(tx, actor, wid, a.id);
        trustedAsset = trusted;
        const sourceIdentity = (value: AssetRecord) => ({
          ...value.source,
          name: "",
        });
        if (
          (trusted.usage ?? "photo") !== (a.usage ?? "photo") ||
          canonicalJson(trusted.license) !== canonicalJson(a.license) ||
          canonicalJson(sourceIdentity(trusted)) !==
            canonicalJson(sourceIdentity(a))
        )
          fail("RESOURCE_METADATA_MISMATCH", 409);
      } else if (a.usage && a.usage !== "photo")
        fail("RESOURCE_METADATA_UNAVAILABLE", 503);
      if (a.status !== "ready" || !a.license.usable)
        fail("RESOURCE_UNAVAILABLE", 422);
      const r = (
        await tx.query(
          `SELECT * FROM assets WHERE workspace_id=$1 AND id=$2 AND state='ready' AND deleted_at IS NULL FOR SHARE`,
          [wid, a.id],
        )
      ).rows[0];
      if (!r) fail("RESOURCE_NOT_FOUND", 404);
      if (
        Number(r.content_version) !== a.version ||
        r.sha256 !== a.sha256 ||
        r.width !== a.width ||
        r.height !== a.height
      )
        fail("RESOURCE_VERSION_MISMATCH", 409);
      for (const variant of ["original", "normalized", "preview"] as const) {
        const o =
          variant === "original"
            ? (
                await tx.query(
                  `SELECT * FROM storage_objects WHERE workspace_id=$1 AND id=$2 FOR SHARE`,
                  [wid, r.original_object_id],
                )
              ).rows[0]
            : (
                await tx.query(
                  `SELECT o.*,v.width,v.height FROM asset_variants v JOIN storage_objects o ON o.id=v.storage_object_id AND o.workspace_id=v.workspace_id WHERE v.workspace_id=$1 AND v.asset_id=$2 AND v.variant=$3 AND o.sha256=$4 FOR SHARE OF o,v`,
                  [wid, a.id, variant, a.variants[variant].sha256],
                )
              ).rows[0];
        const v = a.variants[variant];
        if (variant === "original" && !trustedAsset && o) {
          const bytes = await this.objects.read(await rowToLocator(tx, o));
          if (
            digest(bytes) !== o.sha256 ||
            bytes.length !== Number(o.byte_size)
          )
            fail("STORAGE_CORRUPT", 500);
          const meta = await sharp(bytes).metadata();
          if (meta.width !== v.width || meta.height !== v.height)
            fail("RESOURCE_HASH_MISMATCH", 409);
        }
        if (
          variant === "original" &&
          trustedAsset &&
          (v.width !== trustedAsset.variants.original.width ||
            v.height !== trustedAsset.variants.original.height)
        )
          fail("RESOURCE_HASH_MISMATCH", 409);
        if (
          !o ||
          o.state !== "verified" ||
          o.deleted_at ||
          o.sha256 !== v.sha256 ||
          Number(o.byte_size) !== v.byteLength ||
          o.mime_type !== v.mimeType ||
          (variant === "normalized" &&
            (o.mime_type !== a.mimeType ||
              o.width !== a.width ||
              o.height !== a.height)) ||
          (variant !== "original" &&
            (o.width !== v.width || o.height !== v.height))
        )
          fail("RESOURCE_HASH_MISMATCH", 409);
        refs.push({ workspaceId: wid, objectId: o.id });
      }
    }
    for (const f of resources.fonts) {
      if (
        f.status !== "ready" ||
        !f.license.usable ||
        (await fontRecordHash(f)) !== f.sha256
      )
        fail("FONT_UNAVAILABLE", 422);
      const bundle = (
        await tx.query(
          `SELECT b.* FROM editor_font_bundles b JOIN license_versions l ON l.id=b.license_version_id WHERE b.workspace_id=$1 AND b.id=$2 AND b.version=$3 AND b.state='published' AND l.embedding_allowed AND l.valid_from<=now() AND (l.valid_until IS NULL OR l.valid_until>now()) FOR SHARE OF b,l`,
          [wid, f.id, f.version],
        )
      ).rows[0];
      if (bundle) {
        if (
          bundle.sha256 !== f.sha256 ||
          canonicalJson(bundle.record) !== canonicalJson(f)
        )
          fail("FONT_HASH_MISMATCH", 409);
        const faces = (
          await tx.query(
            `SELECT ef.face_id,ef.record,o.* FROM editor_font_faces ef JOIN storage_objects o ON o.workspace_id=ef.workspace_id AND o.id=ef.storage_object_id WHERE ef.workspace_id=$1 AND ef.bundle_id=$2 AND ef.bundle_version=$3 FOR SHARE OF ef,o`,
            [wid, f.id, f.version],
          )
        ).rows;
        if (faces.length !== f.faces.length) fail("FONT_HASH_MISMATCH", 409);
        for (const face of f.faces) {
          const row = faces.find((r) => r.face_id === face.id);
          if (
            !row ||
            canonicalJson(row.record) !== canonicalJson(face) ||
            row.sha256 !== face.sha256 ||
            Number(row.byte_size) !== face.byteLength ||
            row.kind !== "font" ||
            row.state !== "verified" ||
            row.deleted_at
          )
            fail("FONT_HASH_MISMATCH", 409);
          refs.push({ workspaceId: wid, objectId: row.id });
        }
        continue;
      }
      const versions = (
        await tx.query(
          `SELECT v.*,o.state AS object_state,o.sha256 AS object_hash,o.byte_size,o.deleted_at FROM font_versions v JOIN fonts f ON f.id=v.font_id JOIN storage_objects o ON o.id=v.storage_object_id AND o.workspace_id=v.storage_workspace_id JOIN license_versions l ON l.id=v.license_version_id WHERE v.font_id=$1 AND v.version=$2 AND f.state='published' AND v.embedding_allowed AND l.embedding_allowed AND l.valid_from<=now() AND (l.valid_until IS NULL OR l.valid_until>now()) AND v.storage_workspace_id=$3 FOR SHARE OF v,o,f,l`,
          [f.id, f.version, wid],
        )
      ).rows;
      if (versions.length !== 1) fail("FONT_UNAVAILABLE", 422);
      const v = versions[0];
      if (
        f.faces.length !== 1 ||
        f.faces[0].sha256 !== v.sha256 ||
        v.object_hash !== v.sha256 ||
        v.object_state !== "verified" ||
        v.deleted_at ||
        Number(v.byte_size) !== f.faces[0].byteLength ||
        v.family_name !== f.family
      )
        fail("FONT_HASH_MISMATCH", 409);
      refs.push({
        workspaceId: wid,
        objectId: v.storage_object_id,
        fontVersionId: v.id,
      });
    }
    return refs;
  }
  private async saveInTx(
    tx: PoolClient,
    actor: Actor,
    wid: string,
    document: DocumentModel,
    expected: number,
    resources: ResourceManifest,
    key: string,
  ): Promise<SavedRevision> {
    if (
      !Number.isSafeInteger(expected) ||
      expected < 0 ||
      expected >= Number.MAX_SAFE_INTEGER
    )
      fail("INVALID_REVISION", 422);
    const project = await this.project(tx, wid, document.projectId);
    if (Number(project.current_revision) !== expected)
      fail("REVISION_CONFLICT", 409, {
        currentRevision: Number(project.current_revision),
      });
    const doc = parseDocument({ ...document, revision: expected + 1 }),
      refs = await this.validateResources(tx, actor, wid, doc, resources),
      body = canonicalDocument(doc),
      hash = digest(body),
      objectId = id(),
      revisionId = id();
    const profile = (
      await tx.query(
        "SELECT * FROM storage_profile_versions WHERE id=$1 AND profile_id=$2 AND version=$3 AND bucket=$4",
        [
          this.config.profileVersionId,
          this.config.storageProfileId,
          this.config.profileVersion,
          this.config.bucket,
        ],
      )
    ).rows[0];
    if (!profile || profile.base_prefix !== this.config.basePrefix)
      fail("STORAGE_UNCONFIGURED", 503);
    const keyPath = `${this.config.basePrefix.replace(/\/$/, "")}/${wid}/documents/${doc.projectId}/${revisionId}.json`;
    const locator = {
      storageProfileId: this.config.storageProfileId,
      profileVersion: this.config.profileVersion,
      bucket: this.config.bucket,
      key: keyPath,
      objectVersionId: null,
      sha256: hash,
      variant: "document",
    };
    const bytes = new TextEncoder().encode(body);
    await this.objects.put(locator, bytes);
    const head = await this.objects.head(locator);
    if (head.sha256 !== hash || head.bytes !== bytes.length)
      fail("DOCUMENT_STORAGE_MISMATCH", 500);
    await tx.query(
      `INSERT INTO storage_objects(id,workspace_id,profile_version_id,bucket,object_key,kind,sha256,byte_size,mime_type,state,verified_at) VALUES($1,$2,$3,$4,$5,'document',$6,$7,'application/json','verified',now())`,
      [
        objectId,
        wid,
        this.config.profileVersionId,
        this.config.bucket,
        keyPath,
        hash,
        bytes.length,
      ],
    );
    const inserted = await tx.query(
      `INSERT INTO project_revisions(id,workspace_id,project_id,number,schema_version,storage_object_id,document_hash,spread_count,photo_count,created_by,command_id,base_revision) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,$9,$10,$11) RETURNING created_at`,
      [
        revisionId,
        wid,
        doc.projectId,
        doc.revision,
        objectId,
        hash,
        doc.spreads.length,
        resources.assets.filter((a) => !a.usage || a.usage === "photo").length,
        actor.userId,
        key,
        expected,
      ],
    );
    await tx.query(
      "INSERT INTO project_revision_payloads(revision_id,document,resources) VALUES($1,$2,$3)",
      [revisionId, JSON.stringify(doc), JSON.stringify(resources)],
    );
    for (const a of resources.assets)
      await tx.query(
        "INSERT INTO project_revision_assets(id,workspace_id,revision_id,asset_id) VALUES($1,$2,$3,$4)",
        [id(), wid, revisionId, a.id],
      );
    for (const r of [{ workspaceId: wid, objectId }, ...refs])
      await tx.query(
        "INSERT INTO project_revision_resources(revision_id,storage_workspace_id,storage_object_id,font_version_id) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
        [
          revisionId,
          r.workspaceId,
          r.objectId,
          "fontVersionId" in r ? r.fontVersionId : null,
        ],
      );
    await tx.query(
      "UPDATE projects SET current_revision=$3 WHERE workspace_id=$1 AND id=$2",
      [wid, doc.projectId, doc.revision],
    );
    // Immutable history is retained in full; this exceeds the minimum twenty revisions and never releases active task pins.
    return {
      doc,
      docHash: hash,
      resources: structuredClone(resources),
      savedAt: new Date(inserted.rows[0].created_at).toISOString(),
    };
  }
  async saveCloudRevision(
    actor: Actor,
    wid: string,
    doc: DocumentModel,
    expected: number,
    resources: ResourceManifest,
    key: string,
  ) {
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "edit", tx);
      if (actor.client !== "web") fail("MINI_PATCH_FORBIDDEN", 403);
      return runIdempotent(
        tx,
        `${actor.userId}:${wid}:revision:${doc.projectId}`,
        key,
        digest(canonicalJson({ doc, expected, resources })),
        () => this.saveInTx(tx, actor, wid, doc, expected, resources, key),
      );
    });
  }
  async applyMiniPatch(
    actor: Actor,
    wid: string,
    pid: string,
    expected: number,
    patches: MiniPatch[],
    key: string,
  ) {
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "edit", tx);
      return runIdempotent(
        tx,
        `${actor.userId}:${wid}:mini:${pid}`,
        key,
        digest(canonicalJson({ expected, patches })),
        async () => {
          await this.project(tx, wid, pid);
          const saved = await this.loadInTx(tx, wid, pid);
          if (saved.doc.revision !== expected) fail("REVISION_CONFLICT", 409);
          if (
            !Array.isArray(patches) ||
            !patches.length ||
            patches.length > 100 ||
            patches.some((p) => !p || typeof p !== "object")
          )
            fail("MINI_PATCH_FORBIDDEN", 403);
          const assets = [...saved.resources.assets];
          for (const patch of patches) {
            if (
              patch.type === "replaceAsset" &&
              !assets.some((a) => a.id === patch.assetId)
            ) {
              if (!this.resolveMiniAsset)
                fail("RESOURCE_MANIFEST_UNAVAILABLE", 503);
              const asset = await this.resolveMiniAsset(
                tx,
                actor,
                wid,
                patch.assetId,
              );
              if (asset.id !== patch.assetId) fail("RESOURCE_ID_MISMATCH", 409);
              assets.push(asset);
            }
          }
          const resources: ResourceManifest = {
            assets,
            fonts: saved.resources.fonts,
          };
          const policy: MiniPolicy =
            this.miniPolicy ?? nativeMiniPolicy(resources);
          return this.saveInTx(
            tx,
            actor,
            wid,
            patchDocument(saved.doc, patches, policy),
            expected,
            resources,
            key,
          );
        },
      );
    });
  }
  async restore(
    actor: Actor,
    wid: string,
    pid: string,
    source: number,
    expected: number,
    key: string,
  ) {
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "edit", tx);
      return runIdempotent(
        tx,
        `${actor.userId}:${wid}:restore:${pid}`,
        key,
        digest(canonicalJson({ source, expected })),
        async () => {
          const old = await this.loadInTx(tx, wid, pid, source);
          return this.saveInTx(
            tx,
            actor,
            wid,
            old.doc,
            expected,
            old.resources,
            key,
          );
        },
      );
    });
  }
}
