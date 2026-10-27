import sharp from "sharp";
import { fail, id, digest, type Database } from "@album/server-core";
import type { JobLease, JobRepository } from "@album/jobs";
import type {
  ObjectStore,
  StorageConfig,
  StorageLocator,
} from "../assets/types";
import { fetchApprovedHttps } from "../config/network-policy";
import type { ModerationAdapter } from "./moderation";
import type { GenerationProvenance } from "@album/document";
export type PreparedGeneration = {
  assetId: string;
  state: "ready" | "rejected" | "review";
  commit: Parameters<JobRepository["finishJob"]>[2];
  storageBytes: number;
  cleanup: () => Promise<void>;
};
export class GenerationOutputService {
  constructor(
    private options: {
      db: Database;
      objects: ObjectStore;
      storage: StorageConfig;
      moderator: ModerationAdapter;
      allowedResultHosts: string[];
      labelPolicies: ReadonlySet<string>;
      download?: typeof fetchApprovedHttps;
    },
  ) {}
  private locator(
    key: string,
    sha256: string,
    variant: string,
  ): StorageLocator {
    return {
      storageProfileId: this.options.storage.storageProfileId,
      profileVersion: this.options.storage.profileVersion,
      bucket: this.options.storage.bucket,
      key,
      sha256,
      variant,
      objectVersionId: null,
    };
  }
  async prepare(
    lease: JobLease,
    result: Extract<
      import("@album/providers").QueryResult,
      { state: "succeeded" }
    >,
    context: any,
    signal: AbortSignal,
  ): Promise<PreparedGeneration> {
    if (
      result.outputs.length !== 1 ||
      !this.options.labelPolicies.has(context.labelPolicyVersion)
    )
      fail("AI_LABEL_POLICY_UNCONFIGURED", 503);
    const output = result.outputs[0],
      url = new URL(output.url);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !this.options.allowedResultHosts.includes(url.hostname)
    )
      fail("RESULT_URL_FORBIDDEN", 422);
    const raw = Buffer.from(
      await (this.options.download ?? fetchApprovedHttps)(
        output.url,
        { signal },
        this.options.allowedResultHosts,
        { maxBytes: 25000000, timeoutMs: 60000 },
      ),
    );
    if (output.sha256 && digest(raw) !== output.sha256)
      fail("HASH_MISMATCH", 422);
    const header = raw.subarray(0, 8).toString("hex");
    if (
      header !== "89504e470d0a1a0a" &&
      raw.subarray(0, 3).toString("hex") !== "ffd8ff"
    )
      fail("GENERATION_IMAGE_INVALID", 422);
    const image = sharp(raw, { limitInputPixels: 50000000, failOn: "error" }),
      meta = await image.metadata();
    if (
      !meta.width ||
      !meta.height ||
      !["png", "jpeg"].includes(meta.format ?? "") ||
      (meta.pages ?? 1) !== 1 ||
      meta.width < 128 ||
      meta.height < 128 ||
      meta.width !== context.providerInput.width ||
      meta.height !== context.providerInput.height
    )
      fail("GENERATION_IMAGE_INVALID", 422);
    const unlabelled = await image
      .rotate()
      .toColourspace("srgb")
      .png()
      .toBuffer();
    const normalizedMeta = await sharp(unlabelled).metadata();
    if (
      normalizedMeta.width !== context.providerInput.width ||
      normalizedMeta.height !== context.providerInput.height
    )
      fail("GENERATION_IMAGE_INVALID", 422);
    const moderation = await this.options.moderator.review(
      unlabelled,
      context.moderationPolicyVersion,
    );
    if (moderation.policyVersion !== context.moderationPolicyVersion)
      fail("MODERATION_POLICY_MISMATCH", 503);
    const reviewId = id();
    await this.options.db.transaction((tx) =>
      tx.query(
        "INSERT INTO generation_reviews(id,workspace_id,job_id,state,reason_code,policy_version) VALUES($1,$2,$3,$4,$5,$6)",
        [
          reviewId,
          lease.job.workspaceId,
          lease.job.jobId,
          moderation.state,
          moderation.reasonCode,
          moderation.policyVersion,
        ],
      ),
    );
    if (moderation.state !== "approved")
      return {
        assetId: "",
        state: moderation.state === "rejected" ? "rejected" : "review",
        storageBytes: 0,
        commit: undefined,
        cleanup: async () => {},
      };
    const font = Math.max(8, Math.min(14, meta.width / 12)),
      badgeHeight = Math.ceil(font * 2),
      badge = Buffer.from(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.min(meta.width, 180)}" height="${badgeHeight}"><rect width="100%" height="100%" fill="white"/><text x="6" y="${font * 1.5}" font-size="${font}" font-family="sans-serif" fill="black">AI GENERATED</text></svg>`,
      );
    const normalized = await sharp(unlabelled)
        .composite([{ input: badge, gravity: "southeast" }])
        .png()
        .toBuffer(),
      preview = await sharp(normalized)
        .resize({
          width: 512,
          height: 512,
          fit: "inside",
          withoutEnlargement: true,
        })
        .png()
        .toBuffer();
    const variants = [
      {
        kind: "original",
        bytes: normalized,
        width: meta.width,
        height: meta.height,
        mime: "image/png",
      },
      {
        kind: "normalized",
        bytes: normalized,
        width: meta.width,
        height: meta.height,
        mime: "image/png",
      },
      {
        kind: "preview",
        bytes: preview,
        width: 0,
        height: 0,
        mime: "image/png",
      },
    ];
    const pm = await sharp(preview).metadata();
    variants[2].width = pm.width!;
    variants[2].height = pm.height!;
    if (variants.some((v) => v.bytes.length > 25000000))
      fail("GENERATION_IMAGE_TOO_LARGE", 413);
    const assetId = id(),
      objects = variants.map((v) => ({
        ...v,
        id: id(),
        locator: this.locator(
          `${this.options.storage.basePrefix}/ai/${lease.job.workspaceId}/${lease.job.jobId}/${id()}/${v.kind}.${v.mime === "image/png" ? "png" : "jpg"}`,
          digest(v.bytes),
          v.kind,
        ),
      }));
    // Journal before any upload. Publication and cleanup lock the same journal rows,
    // so an uncertain COMMIT acknowledgement cannot delete committed resources.
    await this.options.db.transaction(async (tx) => {
      for (const object of objects)
        await tx.query(
          "INSERT INTO generation_staged_objects(job_id,object_key,locator) VALUES($1,$2,$3)",
          [lease.job.jobId, object.locator.key, object.locator],
        );
    });
    const cleanup = async () => {
      for (const object of objects)
        await this.options.db
          .transaction(async (tx) => {
            const staged = (
              await tx.query(
                "SELECT locator FROM generation_staged_objects WHERE job_id=$1 AND object_key=$2 FOR UPDATE",
                [lease.job.jobId, object.locator.key],
              )
            ).rows[0];
            if (!staged) return;
            const published = (
              await tx.query(
                "SELECT 1 FROM storage_objects WHERE bucket=$1 AND object_key=$2 AND state='verified'",
                [object.locator.bucket, object.locator.key],
              )
            ).rowCount;
            if (!published) await this.options.objects.remove(object.locator);
            await tx.query(
              "DELETE FROM generation_staged_objects WHERE object_key=$1",
              [object.locator.key],
            );
          })
          .catch(() => {});
    };
    try {
      for (const object of objects) {
        signal.throwIfAborted();
        await this.options.db.transaction(async (tx) => {
          const staged = (
            await tx.query(
              "SELECT object_key FROM generation_staged_objects WHERE job_id=$1 AND object_key=$2 FOR UPDATE",
              [lease.job.jobId, object.locator.key],
            )
          ).rows[0];
          if (!staged) fail("GENERATION_STAGING_MISSING", 409);
          await this.options.objects.put(object.locator, object.bytes);
          const check = await this.options.objects.head(object.locator);
          if (
            check.sha256 !== object.locator.sha256 ||
            check.bytes !== object.bytes.length
          )
            fail("HASH_MISMATCH", 422);
        });
      }
    } catch (e) {
      await cleanup();
      throw e;
    }
    const storageBytes = objects.reduce((n, o) => n + o.bytes.length, 0);
    return {
      assetId,
      state: "ready",
      storageBytes,
      cleanup,
      commit: async (tx, job) => {
        if (
          job.jobId !== lease.job.jobId ||
          job.workspaceId !== lease.job.workspaceId
        )
          fail("JOB_MISMATCH", 409);
        const staged = (
          await tx.query(
            "SELECT object_key FROM generation_staged_objects WHERE job_id=$1 AND object_key=ANY($2::text[]) ORDER BY object_key FOR UPDATE",
            [job.jobId, objects.map((o) => o.locator.key)],
          )
        ).rows;
        if (staged.length !== objects.length)
          fail("GENERATION_STAGING_MISSING", 409);
        await tx.query(
          "DELETE FROM generation_staged_objects WHERE job_id=$1 AND object_key=ANY($2::text[])",
          [job.jobId, objects.map((o) => o.locator.key)],
        );
        for (const object of objects)
          await tx.query(
            "INSERT INTO storage_objects(id,workspace_id,profile_version_id,bucket,object_key,kind,sha256,byte_size,mime_type,state,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'verified',clock_timestamp())",
            [
              object.id,
              job.workspaceId,
              this.options.storage.profileVersionId,
              object.locator.bucket,
              object.locator.key,
              object.kind,
              object.locator.sha256,
              object.bytes.length,
              object.mime,
            ],
          );
        await tx.query(
          "INSERT INTO assets(id,workspace_id,original_object_id,original_filename,sha256,byte_size,width,height,mime_type,origin,state) VALUES($1,$2,$3,'AI-art.png',$4,$5,$6,$7,$8,'generated','ready')",
          [
            assetId,
            job.workspaceId,
            objects[0].id,
            objects[0].locator.sha256,
            objects[0].bytes.length,
            meta.width,
            meta.height,
            variants[0].mime,
          ],
        );
        for (const object of objects.slice(1))
          await tx.query(
            "INSERT INTO asset_variants(id,workspace_id,asset_id,variant,storage_object_id,pipeline_version,width,height) VALUES($1,$2,$3,$4,$5,'ai-labelled-v1',$6,$7)",
            [
              id(),
              job.workspaceId,
              assetId,
              object.kind,
              object.id,
              object.width,
              object.height,
            ],
          );
        const quote = (
          await tx.query("SELECT * FROM generation_quotes WHERE id=$1", [
            job.kind === "generation"
              ? (
                  await tx.query("SELECT quote_id FROM jobs WHERE id=$1", [
                    job.jobId,
                  ])
                ).rows[0].quote_id
              : null,
          ])
        ).rows[0];
        await tx.query(
          "INSERT INTO generation_provenance(id,workspace_id,job_id,asset_id,quote_id,consent_id,provider_version_id,model_version_id,preset_version_id,input_hash,provider_request_id,license_version_id,moderation_policy_ref,label_policy_ref,moderation_result,label_applied,provider_output_sha256) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'approved',true,$15)",
          [
            id(),
            job.workspaceId,
            job.jobId,
            assetId,
            quote.id,
            quote.consent_id,
            quote.provider_version_id,
            quote.model_version_id,
            quote.preset_version_id,
            quote.input_hash,
            result.providerRequestId,
            context.licenseId,
            context.moderationPolicyVersion,
            context.labelPolicyVersion,
            digest(raw),
          ],
        );
        await tx.query(
          "INSERT INTO job_outputs(id,workspace_id,job_id,artifact_index,storage_object_id,committed_fence,format,sha256,byte_size,width,height,expires_at) VALUES($1,$2,$3,0,$4,$5,'png',$6,$7,$8,$9,clock_timestamp()+interval '7 days')",
          [
            id(),
            job.workspaceId,
            job.jobId,
            objects[1].id,
            lease.fence,
            objects[1].locator.sha256,
            normalized.length,
            meta.width,
            meta.height,
          ],
        );
      },
    };
  }
  async cleanupStaged() {
    const rows = await this.options.db.transaction(
      async (tx) =>
        (
          await tx.query(
            "SELECT s.job_id,s.object_key FROM generation_staged_objects s JOIN jobs j ON j.id=s.job_id WHERE j.state IN ('succeeded','failed','cancelled') ORDER BY s.created_at LIMIT 100",
          )
        ).rows,
    );
    for (const row of rows)
      await this.options.db.transaction(async (tx) => {
        const staged = (
          await tx.query(
            "SELECT locator FROM generation_staged_objects WHERE job_id=$1 AND object_key=$2 FOR UPDATE",
            [row.job_id, row.object_key],
          )
        ).rows[0];
        if (!staged) return;
        const published = (
          await tx.query(
            "SELECT 1 FROM storage_objects WHERE bucket=$1 AND object_key=$2 AND state='verified'",
            [staged.locator.bucket, row.object_key],
          )
        ).rowCount;
        if (!published) await this.options.objects.remove(staged.locator);
        await tx.query(
          "DELETE FROM generation_staged_objects WHERE object_key=$1",
          [row.object_key],
        );
      });
  }
  async result(
    actor: import("@album/server-core").Actor,
    wid: string,
    jobId: string,
    workspaces: import("../workspaces/service").WorkspaceService,
    uploads: import("../assets/upload").UploadService,
  ) {
    const row = await this.options.db.transaction(async (tx) => {
      await workspaces.authorize(actor, wid, "read", tx);
      return (
        await tx.query(
          "SELECT j.state,j.error_code,p.asset_id FROM jobs j LEFT JOIN generation_provenance p ON p.workspace_id=j.workspace_id AND p.job_id=j.id WHERE j.workspace_id=$1 AND j.id=$2 AND j.kind='generation'",
          [wid, jobId],
        )
      ).rows[0];
    });
    if (!row) fail("NOT_FOUND", 404);
    return {
      jobId,
      state: row.state,
      ...(row.state === "succeeded" && row.asset_id
        ? { asset: await uploads.getAsset(actor, wid, row.asset_id) }
        : {}),
      ...(row.error_code ? { reasonCode: row.error_code } : {}),
    };
  }
}
