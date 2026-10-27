import { digest, fail, id } from "@album/server-core";
import { ProviderRegistry, OpenAIImagesAdapter } from "@album/providers";
import type { SecretPort } from "../config/types";
import type { ApiRuntime } from "../http/runtime";
import type { AiRuntimeOptions } from "./runtime";
import { OpenAIModerationAdapter } from "./moderation";
import { rowToLocator } from "../assets/upload";
import type { StorageLocator } from "../assets/types";
/** Server-only allowlists and immutable policy bindings. No browser supplied endpoint or key. */
export function deploymentAi(
  runtime: ApiRuntime,
  env: NodeJS.ProcessEnv,
  secrets?: SecretPort,
): AiRuntimeOptions | undefined {
  if (!env.AI_ENDPOINT_HOSTS) return;
  if (!secrets || !runtime.objects || !runtime.storage)
    fail("AI_DEPLOYMENT_CONFIGURATION_REQUIRED", 503);
  const hosts = (value: string | undefined) => {
    const result = (value ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (
      !result.length ||
      result.some((h) => !/^([a-z0-9-]+\.)+[a-z0-9-]+$/i.test(h))
    )
      fail("AI_HOST_ALLOWLIST_REQUIRED", 503);
    return result;
  };
  const endpointHosts = hosts(env.AI_ENDPOINT_HOSTS),
    resultHosts = hosts(env.AI_RESULT_HOSTS),
    moderationHosts = hosts(env.AI_MODERATION_HOSTS),
    policy = env.AI_MODERATION_POLICY_VERSION,
    label = env.AI_LABEL_POLICY_VERSION;
  if (
    !policy ||
    !label ||
    !env.AI_MODERATION_BASE_URL ||
    !env.AI_MODERATION_MODEL ||
    !env.AI_MODERATION_SECRET_REF ||
    !env.AI_MODERATION_SECRET_VERSION
  )
    fail("AI_MODERATION_CONFIGURATION_REQUIRED", 503);
  const read = async (ref: string, version: string) => {
    if (await secrets.isRevoked(ref, version)) fail("SECRET_UNAVAILABLE", 503);
    return Buffer.from(await secrets.read(ref, version)).toString("utf8");
  };
  const registry = new ProviderRegistry();
  registry.register(
    new OpenAIImagesAdapter({
      allowedEndpointHosts: endpointHosts,
      imageToImage: env.AI_IMAGE_EDITS_ENABLED === "true",
    }),
  );
  const moderator = new OpenAIModerationAdapter({
    allowedHosts: moderationHosts,
    policies: {
      [policy]: {
        endpoint: env.AI_MODERATION_BASE_URL,
        model: env.AI_MODERATION_MODEL,
        readSecret: () =>
          read(
            env.AI_MODERATION_SECRET_REF!,
            env.AI_MODERATION_SECRET_VERSION!,
          ),
      },
    },
  });
  return {
    cleanupStaged: async () => {
      const rows = await runtime.db.transaction(
        async (tx) =>
          (
            await tx.query(
              "SELECT s.job_id,s.locator FROM generation_inline_objects s JOIN jobs j ON j.id=s.job_id WHERE j.state IN ('succeeded','failed','cancelled') ORDER BY s.created_at LIMIT 100",
            )
          ).rows,
      );
      for (const row of rows)
        await runtime.db.transaction(async (tx) => {
          const staged = (
            await tx.query(
              "SELECT locator FROM generation_inline_objects WHERE job_id=$1 FOR UPDATE",
              [row.job_id],
            )
          ).rows[0];
          if (!staged) return;
          await runtime.objects!.remove(staged.locator);
          await tx.query(
            "DELETE FROM generation_inline_objects WHERE job_id=$1",
            [row.job_id],
          );
        });
    },
    registry,
    moderator,
    allowedResultHosts: resultHosts,
    labelPolicies: new Set([label]),
    validatePolicies: (m, l) => m === policy && l === label,
    quota: {
      readQuota: async (wid) => ({
        limitBytes: (
          await runtime.commerce!.entitlements.getEntitlements(
            wid,
            new Date().toISOString(),
          )
        ).storageLimitBytes,
        maxProjectPhotos: 500,
      }),
    },
    makeContext: async (manifest, lease) => ({
      connectionVersionId: manifest.providerVersionId,
      secretRef: manifest.secretRef,
      secretVersion: manifest.secretVersion,
      endpoint: manifest.endpoint,
      allowedResultHosts: resultHosts,
      providerModelId: manifest.providerModelId,
      estimatedCostFen: manifest.estimatedCostFen,
      readSecret: () => read(manifest.secretRef, manifest.secretVersion),
      readReference: async (assetId) => {
        const locator = await runtime.db.transaction(async (tx) => {
          const row = (
            await tx.query(
              "SELECT o.* FROM resource_pins p JOIN storage_objects o ON o.workspace_id=p.storage_workspace_id AND o.id=p.storage_object_id WHERE p.workspace_id=$1 AND p.job_id=$2 AND p.asset_id=$3 AND p.released_at IS NULL AND o.state='verified'",
              [lease.job.workspaceId, lease.job.jobId, assetId],
            )
          ).rows[0];
          if (!row || Number(row.byte_size) > 25000000)
            fail("REFERENCE_UNAVAILABLE", 422);
          return { locator: await rowToLocator(tx, row), mime: row.mime_type };
        });
        const bytes = await runtime.objects!.read(locator.locator);
        if (digest(bytes) !== locator.locator.sha256)
          fail("HASH_MISMATCH", 422);
        return { bytes, mime: locator.mime };
      },
      persistInline: async (bytes, mime, operationId) => {
        if (
          operationId !== lease.job.jobId ||
          bytes.length > 25000000 ||
          !["image/png", "image/jpeg"].includes(mime)
        )
          fail("GENERATION_IMAGE_INVALID", 422);
        const sha256 = digest(bytes),
          storage = runtime.storage!,
          locator: StorageLocator = {
            storageProfileId: storage.storageProfileId,
            profileVersion: storage.profileVersion,
            bucket: storage.bucket,
            key: `${storage.basePrefix}/ai-staging/${lease.job.workspaceId}/${operationId}/${id()}`,
            sha256,
            variant: "original",
            objectVersionId: null,
          };
        await runtime.db.transaction((tx) =>
          tx.query(
            "INSERT INTO generation_inline_objects(job_id,locator) VALUES($1,$2)",
            [operationId, locator],
          ),
        );
        await runtime.db.transaction(async (tx) => {
          const staged = (
            await tx.query(
              "SELECT job_id FROM generation_inline_objects WHERE job_id=$1 FOR UPDATE",
              [operationId],
            )
          ).rows[0];
          if (!staged) fail("GENERATION_STAGING_MISSING", 409);
          await runtime.objects!.put(locator, bytes);
          const check = await runtime.objects!.head(locator);
          if (check.bytes !== bytes.length || check.sha256 !== sha256)
            fail("HASH_MISMATCH", 422);
        });
        const url = await runtime.objects!.sign(locator, "download", 3600);
        if (!resultHosts.includes(new URL(url).hostname))
          fail("RESULT_URL_FORBIDDEN", 503);
        return { url, sha256 };
      },
    }),
  };
}
