import { payloadHash } from "../../api/src/config/types";
import { fail, type Database } from "@album/server-core";
import type { JobLease, JobRepository } from "@album/jobs";
import type {
  ProviderRegistry,
  ProviderContext,
  QueryResult,
} from "@album/providers";
import { SqlProviderReceipts } from "../../api/src/ai/receipts";
import type { GenerationOutputService } from "../../api/src/ai/output";
export class GenerationWorker {
  constructor(
    private options: {
      db: Database;
      jobs: JobRepository;
      registry: ProviderRegistry;
      output: GenerationOutputService;
      makeContext: (manifest: any, lease: JobLease) => Promise<ProviderContext>;
    },
  ) {}
  async runGenerationJob(lease: JobLease, signal: AbortSignal) {
    const r = await this.options.db.transaction(
      async (tx) =>
        (
          await tx.query(
            "SELECT j.*,s.manifest,s.manifest_hash FROM jobs j JOIN job_snapshots s ON s.id=j.snapshot_id WHERE j.id=$1 AND j.workspace_id=$2",
            [lease.job.jobId, lease.job.workspaceId],
          )
        ).rows[0],
    );
    if (!r || ["succeeded", "failed", "cancelled"].includes(r.state)) return;
    if (payloadHash(r.manifest) !== r.manifest_hash) {
      await this.finish(lease, "failed", {
        code: "SNAPSHOT_HASH_MISMATCH",
        costFen: 0,
      });
      return;
    }
    const context = r.manifest,
      adapter = this.options.registry.get(
        context.adapterId,
        context.adapterVersion,
      );
    const providerContext = await this.options.makeContext(context, lease);
    providerContext.receipts ??= new SqlProviderReceipts(this.options.db);
    providerContext.signal = signal;
    if (
      r.state === "cancel_requested" &&
      r.provider_submission_state === "not_submitted"
    ) {
      await this.options.jobs.finishJob(lease, {
        state: "cancelled",
        result: {},
      });
      return;
    }
    const identity = {
      operationId: r.id,
      providerRequestId: r.provider_request_id ?? null,
    };
    let result: QueryResult;
    if (r.provider_submission_state === "not_submitted") {
      try {
        await this.slot(lease, context.providerVersionId);
      } catch {
        await this.options.jobs.failAttempt(lease, {
          code: "PROVIDER_CAPACITY_REACHED",
          retryable: true,
          definite: true,
        });
        return;
      }
      if (!(await this.options.jobs.markSubmission(lease, "submitting", r.id)))
        return;
      let submitted;
      try {
        submitted = await adapter.submit(
          { ...context.providerInput, operationId: r.id },
          providerContext,
        );
      } catch {
        await this.options.jobs.failAttempt(lease, {
          code: "UPSTREAM_STATUS_UNKNOWN",
          retryable: false,
          definite: false,
        });
        return;
      }
      if (submitted.state === "rejected") {
        await this.finish(lease, "failed", {
          code: submitted.code,
          costFen: 0,
        });
        return;
      }
      if (submitted.state === "accepted") {
        identity.providerRequestId = submitted.providerRequestId;
        if (submitted.providerRequestId !== r.id) {
          await this.options.jobs.failAttempt(lease, {
            code: "PROVIDER_IDENTITY_MISMATCH",
            retryable: false,
            definite: false,
          });
          return;
        }
        if (
          !(await this.options.jobs.markSubmission(
            lease,
            "accepted",
            submitted.providerRequestId,
          ))
        )
          return;
      } else {
        await this.options.jobs.failAttempt(lease, {
          code: "UPSTREAM_STATUS_UNKNOWN",
          retryable: false,
          definite: false,
        });
        return;
      }
    }
    try {
      result = await adapter.query(identity, providerContext);
    } catch {
      await this.options.jobs.failAttempt(lease, {
        code: "UPSTREAM_STATUS_UNKNOWN",
        retryable: false,
        definite: false,
      });
      return;
    }
    if (
      ["unknown", "queued", "running", "cancel_requested"].includes(
        result.state,
      )
    ) {
      if (
        Date.now() - new Date(r.created_at).getTime() >
        context.timeoutSeconds * 1000
      ) {
        await this.finish(lease, "failed", {
          code: "UPSTREAM_UNCONFIRMED",
          costFen: context.estimatedCostFen,
          billingEvidence: "estimated_unknown",
        });
        return;
      }
      await this.options.jobs.failAttempt(lease, {
        code: "UPSTREAM_STATUS_UNKNOWN",
        retryable: false,
        definite: false,
      });
      return;
    }
    if (result.state !== "succeeded") {
      await this.finish(lease, "failed", {
        code: "code" in result ? result.code : "PROVIDER_FAILED",
        costFen: 0,
      });
      return;
    }
    const state = await this.status(lease.job.jobId);
    if (state === "cancel_requested") {
      await this.finish(lease, "cancelled", { costFen: result.costFen });
      return;
    }
    let prepared:
      Awaited<ReturnType<GenerationOutputService["prepare"]>> | undefined;
    try {
      prepared = await this.options.output.prepare(
        lease,
        result,
        context,
        signal,
      );
      if (prepared.state !== "ready") {
        await this.finish(lease, "failed", {
          code:
            prepared.state === "review"
              ? "MODERATION_REVIEW_REQUIRED"
              : "MODERATION_REJECTED",
          costFen: result.costFen,
        });
        return;
      }
      const committed = await this.options.jobs.finishJob(
        lease,
        {
          state: "succeeded",
          result: {
            assetId: prepared.assetId,
            storageBytes: prepared.storageBytes,
            costFen: result.costFen,
          },
        },
        prepared.commit,
      );
      if (!committed) {
        await prepared.cleanup();
        if ((await this.status(lease.job.jobId)) === "cancel_requested")
          await this.finish(lease, "cancelled", { costFen: result.costFen });
      }
    } catch (e) {
      await prepared?.cleanup();
      await this.finish(lease, "failed", {
        code:
          e instanceof Error && /^[A-Z][A-Z_]+$/.test(e.message)
            ? e.message
            : "GENERATION_OUTPUT_INVALID",
        costFen: result.costFen,
      });
    }
  }
  private async status(jobId: string) {
    return this.options.db.transaction(
      async (tx) =>
        (await tx.query("SELECT state FROM jobs WHERE id=$1", [jobId])).rows[0]
          ?.state,
    );
  }
  private async finish(
    lease: JobLease,
    state: "failed" | "cancelled",
    result: Record<string, unknown>,
  ) {
    if ((await this.status(lease.job.jobId)) === "cancel_requested")
      state = "cancelled";
    await this.options.jobs.finishJob(lease, { state, result });
  }
  private async slot(lease: JobLease, provider: string) {
    await this.options.db.transaction(async (tx) => {
      const p = (
        await tx.query("SELECT * FROM ai_provider_versions WHERE id=$1", [
          provider,
        ])
      ).rows[0];
      if (!p) fail("PROVIDER_UNCONFIGURED", 503);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "ai-submit:" + p.billing_account_id,
      ]);
      const old = (
        await tx.query(
          "SELECT job_id FROM ai_submission_slots WHERE job_id=$1",
          [lease.job.jobId],
        )
      ).rows[0];
      if (old) return;
      const counts = (
        await tx.query(
          "SELECT count(*) FILTER(WHERE closed_at IS NULL)::int AS active,count(*) FILTER(WHERE started_at>clock_timestamp()-interval '1 minute')::int AS rate FROM ai_submission_slots WHERE connection_id=$1",
          [p.connection_id],
        )
      ).rows[0];
      if (
        counts.active >= p.max_concurrent ||
        counts.rate >= p.requests_per_minute
      )
        fail("PROVIDER_CAPACITY_REACHED", 429);
      await tx.query(
        "INSERT INTO ai_submission_slots(job_id,connection_id,billing_account_id) VALUES($1,$2,$3)",
        [lease.job.jobId, p.connection_id, p.billing_account_id],
      );
    });
  }
}
