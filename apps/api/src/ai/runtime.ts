import { fail } from "@album/server-core";
import type { ApiRuntime } from "../http/runtime";
import type { ProviderRegistry, ProviderContext } from "@album/providers";
import type { JobLease } from "@album/jobs";
import { GenerationService } from "./quotes";
import { GenerationOutputService } from "./output";
import type { ModerationAdapter } from "./moderation";
import type { QuotaPolicyPort } from "../assets/types";
import { GenerationWorker } from "../../../ai-worker/src/generate-job";
export type AiRuntimeOptions = {
  cleanupStaged?: () => Promise<void>;
  registry: ProviderRegistry;
  moderator: ModerationAdapter;
  allowedResultHosts: string[];
  labelPolicies: ReadonlySet<string>;
  validatePolicies: (moderation: string, label: string) => boolean;
  quota: QuotaPolicyPort;
  makeContext: (manifest: any, lease: JobLease) => Promise<ProviderContext>;
};
/** No replay/default paid route: deployment must explicitly bind every live dependency. */
export function bindAiRuntime(runtime: ApiRuntime, options: AiRuntimeOptions) {
  const commerce = runtime.commerce;
  if (!commerce || !runtime.storage || !runtime.objects || !runtime.uploads)
    fail("GENERATION_UNCONFIGURED", 503);
  const service = new GenerationService({
    db: runtime.db,
    workspaces: runtime.workspaces,
    registry: options.registry,
    loadRelease: (id) => commerce.config.loadRelease(id),
    environment: runtime.environment,
    quota: options.quota,
    validatePolicies: options.validatePolicies,
    assertAllowed: () => commerce.config.assertNewRequestsAllowed("generation"),
  });
  const output = new GenerationOutputService({
    db: runtime.db,
    objects: runtime.objects,
    storage: runtime.storage,
    moderator: options.moderator,
    allowedResultHosts: options.allowedResultHosts,
    labelPolicies: options.labelPolicies,
  });
  const worker = new GenerationWorker({
    db: runtime.db,
    jobs: commerce.jobs,
    registry: options.registry,
    output,
    makeContext: options.makeContext,
    assertSubmitAllowed: () =>
      commerce.config.assertNewRequestsAllowed("generation"),
  });
  runtime.ai = {
    service,
    output,
    worker,
    cleanupStaged: async () => {
      await output.cleanupStaged();
      await options.cleanupStaged?.();
    },
  };
  runtime.operationHandlers = {
    ...runtime.operationHandlers,
    listGenerationPresets: async (r) => {
      const items = await service.listPresets(
        r.actor,
        String(r.query.workspaceId),
      );
      return {
        items: items.filter(
          (p) =>
            !r.query.capability || p.capabilities.includes(r.query.capability),
        ),
        nextCursor: null,
        hasMore: false,
      };
    },
    createGenerationQuote: (r) =>
      service.createGenerationQuote(r.actor, r.body),
    getGenerationQuote: (r) => service.getQuote(r.actor, r.params.quoteId),
    createGenerationJob: async (r) => {
      const created = await service.acceptGenerationQuote(
        r.actor,
        r.body,
        String(r.headers["idempotency-key"] ?? ""),
      );
      r.resolvedWorkspaceId = created.workspaceId;
      return runtime.operationHandlers!.getJob(
        { ...r, params: { ...r.params, jobId: created.jobId } },
        undefined,
      );
    },
    getGenerationResult: (r) =>
      output.result(
        r.actor,
        r.resolvedWorkspaceId || String(r.headers["x-workspace-id"] ?? ""),
        r.params.jobId,
        runtime.workspaces,
        runtime.uploads!,
      ),
  };
  return runtime.ai;
}
