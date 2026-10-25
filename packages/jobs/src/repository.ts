import type { PoolClient } from "pg";
import {
  digest,
  fail,
  id,
  type Actor,
  type Database,
} from "@album/server-core";
import type {
  CreateJobInput,
  ExecutionPolicy,
  JobLease,
  JobOutcome,
  JobRecord,
  PolicyPort,
  SubmissionState,
  TerminalCommit,
} from "./types";

type Row = Record<string, any>;
export const isResourceFailure = (code: string | null | undefined) =>
  /RESOURCE_EXHAUSTED|OOM|MEMORY_BUDGET|SURFACE_BUDGET/.test(code ?? "");
const terminal = (state: string) =>
  ["succeeded", "failed", "cancelled"].includes(state);
const select =
  "SELECT j.*,s.config_release_id FROM jobs j JOIN job_snapshots s ON s.id=j.snapshot_id AND s.workspace_id=j.workspace_id";
const record = (row: Row): JobRecord => ({
  jobId: row.id,
  workspaceId: row.workspace_id,
  kind: row.kind,
  state: row.state,
  configReleaseId: row.config_release_id,
  attempt: Number(row.attempt_count),
  fence: Number(row.fence),
  cancelRequested: !!row.cancel_requested_at,
  providerSubmissionState: row.provider_submission_state,
  stage: row.stage,
});
const leaseOf = (row: Row): JobLease => ({
  job: record(row),
  leaseOwner: row.lease_owner,
  fence: Number(row.fence),
  expiresAt: new Date(row.lease_expires_at).toISOString(),
});
const canonical = (value: unknown): string => {
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  if (value !== null && typeof value === "object")
    return (
      "{" +
      Object.entries(value)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => JSON.stringify(key) + ":" + canonical(value))
        .join(",") +
      "}"
    );
  return JSON.stringify(value) ?? "null";
};
export async function jobEvent(
  tx: PoolClient,
  row: Row,
  eventType: string,
  payload: object,
) {
  const eventId = id();
  await tx.query(
    "INSERT INTO outbox(id,workspace_id,event_key,aggregate_kind,aggregate_id,event_type,payload) VALUES($1,$2,$1,'job',$3,$4,$5)",
    [eventId, row.workspace_id, row.id, eventType, JSON.stringify(payload)],
  );
}
export async function createJob(
  tx: PoolClient,
  input: CreateJobInput,
  key: string,
): Promise<JobRecord> {
  if (!input.createdBy || !input.snapshotId)
    fail("JOB_TRUSTED_CONTEXT_REQUIRED");
  if (!/^[0-9a-f]{64}$/.test(input.inputHash)) fail("INVALID_INPUT_HASH");
  const maxAttempts = input.maxAttempts ?? 4;
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 4)
    fail("INVALID_JOB_ATTEMPTS");
  // C3 runIdempotent omits workspace_id; SQL forbids changing ownership after
  // insertion. Keep the same transaction pattern with the required workspace key.
  if (!key || key.length > 128) fail("IDEMPOTENCY_KEY_REQUIRED", 428);
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "workspace:" + input.workspaceId + ":" + key,
  ]);
  const requestHash =
    input.idempotencyRequestHash ??
    digest(
      canonical({
        operation: "job.create",
        ...input,
        snapshotId: undefined,
        maxAttempts,
      }),
    );
  const existing = await tx.query(
    "SELECT * FROM idempotency_keys WHERE workspace_id=$1 AND principal_scope='workspace' AND idempotency_key=$2 FOR UPDATE",
    [input.workspaceId, key],
  );
  if (existing.rows[0]) {
    if (
      existing.rows[0].operation !== "job.create" ||
      existing.rows[0].request_hash !== requestHash
    )
      fail("IDEMPOTENCY_CONFLICT", 409);
    return existing.rows[0].response_json as JobRecord;
  }
  const result = await (async () => {
    const snapshot = (
      await tx.query(
        "SELECT * FROM job_snapshots WHERE id=$1 AND workspace_id=$2",
        [input.snapshotId, input.workspaceId],
      )
    ).rows[0];
    if (
      !snapshot ||
      snapshot.kind !== input.kind ||
      snapshot.config_release_id !== input.configReleaseId ||
      snapshot.normalized_spec_hash !== input.inputHash ||
      (snapshot.quote_id ?? undefined) !== input.quoteId
    )
      fail("JOB_SNAPSHOT_MISMATCH", 409);
    // A new wizard/key must not bypass the known-OOM restriction. Only these
    // deterministic kinds have a stable accepted spec/resource hash here.
    if (["export", "layout"].includes(input.kind)) {
      const known = await tx.query(
        "SELECT 1 FROM jobs j JOIN job_snapshots s ON s.workspace_id=j.workspace_id AND s.id=j.snapshot_id WHERE j.workspace_id=$1 AND j.kind=$2 AND j.state='failed' AND j.error_code='RESOURCE_EXHAUSTED' AND s.config_release_id=$3 AND s.normalized_spec_hash=$4 LIMIT 1",
        [input.workspaceId, input.kind, input.configReleaseId, input.inputHash],
      );
      if (known.rowCount) fail("RESOURCE_BUDGET_REVIEW_REQUIRED", 409);
    }
    if (input.retry) {
      const parent = (
        await tx.query(
          "SELECT kind,state,revision,provider_submission_state,error_code FROM jobs WHERE workspace_id=$1 AND id=$2 FOR SHARE",
          [input.workspaceId, input.retry.parentJobId],
        )
      ).rows[0];
      if (!parent || parent.kind !== input.kind) fail("NOT_FOUND", 404);
      if (Number(parent.revision) !== input.retry.expectedRevision)
        fail("REVISION_CONFLICT", 409);
      if (
        !["failed", "cancelled"].includes(parent.state) ||
        parent.provider_submission_state !== "terminal"
      )
        fail("JOB_CONFIRMATION_REQUIRED", 409);
      if (isResourceFailure(parent.error_code))
        fail("RESOURCE_BUDGET_REVIEW_REQUIRED", 409);
      if (!input.retry.reason?.trim() || input.retry.reason.length > 300)
        fail("REASON_REQUIRED", 422);
    }
    const jobId = id();
    const row = (
      await tx.query(
        `INSERT INTO jobs(id,workspace_id,kind,snapshot_id,quote_id,created_by,max_attempts,parent_job_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
        [
          jobId,
          input.workspaceId,
          input.kind,
          input.snapshotId,
          input.quoteId ?? null,
          input.createdBy,
          maxAttempts,
          input.retry?.parentJobId ?? null,
        ],
      )
    ).rows[0];
    if (input.retry)
      await tx.query(
        "INSERT INTO audit_events(id,workspace_id,actor_user_id,action,target_kind,target_id,request_id,reason,redacted_details) VALUES($1,$2,$3,'job.retry','job',$4,$5,$6,$7)",
        [
          id(),
          input.workspaceId,
          input.createdBy,
          jobId,
          id(),
          input.retry.reason,
          {
            parentJobId: input.retry.parentJobId,
            expectedRevision: input.retry.expectedRevision,
          },
        ],
      );
    await jobEvent(tx, row, "job.ready", { jobId });
    return record({ ...row, config_release_id: input.configReleaseId });
  })();
  await tx.query(
    "INSERT INTO idempotency_keys(id,workspace_id,principal_scope,idempotency_key,request_hash,operation,state,response_status,response_json,resource_kind,resource_id,expires_at) VALUES($1,$2,'workspace',$3,$4,'job.create','completed',200,$5,'job',$6,clock_timestamp()+interval '7 days')",
    [
      id(),
      input.workspaceId,
      key,
      requestHash,
      JSON.stringify(result),
      result.jobId,
    ],
  );
  return result;
}

export class JobRepository {
  constructor(
    private readonly db: Database,
    private readonly policy: PolicyPort,
    private readonly onTerminal?: TerminalCommit,
  ) {}
  private transaction<T>(work: (tx: PoolClient) => Promise<T>) {
    return this.db.transaction(async (tx) => {
      await tx.query("SET LOCAL statement_timeout='5s'");
      await tx.query("SET LOCAL lock_timeout='2s'");
      return work(tx);
    });
  }
  private async lock(
    tx: PoolClient,
    jobId: string,
    wid?: string,
  ): Promise<Row | undefined> {
    return (
      await tx.query(
        select +
          " WHERE j.id=$1" +
          (wid ? " AND j.workspace_id=$2" : "") +
          " FOR UPDATE OF j",
        wid ? [jobId, wid] : [jobId],
      )
    ).rows[0];
  }
  private async live(
    tx: PoolClient,
    lease: JobLease,
  ): Promise<Row | undefined> {
    const row = await this.lock(tx, lease.job.jobId, lease.job.workspaceId);
    if (
      !row ||
      terminal(row.state) ||
      Number(row.fence) !== lease.fence ||
      row.lease_owner !== lease.leaseOwner
    )
      return;
    return (
      await tx.query(
        "SELECT lease_expires_at>clock_timestamp() AS live FROM jobs WHERE id=$1",
        [row.id],
      )
    ).rows[0].live
      ? row
      : undefined;
  }
  private validatePolicy(policy: ExecutionPolicy) {
    const limits = [
      policy.deployment.global,
      policy.deployment.workspace,
      policy.release.global,
      policy.release.workspace,
      policy.entitlement.global,
      policy.entitlement.workspace,
    ];
    if (
      limits.some((value) => !Number.isSafeInteger(value) || value < 0) ||
      !Number.isInteger(policy.leaseSeconds) ||
      policy.leaseSeconds < 1 ||
      policy.leaseSeconds > 3600 ||
      !Number.isInteger(policy.maxAttempts) ||
      policy.maxAttempts < 1 ||
      policy.maxAttempts > 4 ||
      policy.retryBackoffSeconds.length > 3 ||
      policy.retryBackoffSeconds.some(
        (value, index) => value !== [10, 30, 90][index],
      )
    )
      fail("INVALID_JOB_POLICY");
  }
  async claimJob(
    jobId: string,
    workerId: string,
    _now: string,
  ): Promise<JobLease | null> {
    if (!workerId || workerId.length > 128) fail("INVALID_WORKER_ID");
    return this.transaction(async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('album.jobs.claim',0))",
      );
      let row = await this.lock(tx, jobId);
      if (!row || terminal(row.state)) return null;
      const confirmation =
        row.provider_submission_state === "unknown" &&
        ["running", "cancel_requested"].includes(row.state);
      if (confirmation) {
        if (
          (
            await tx.query(
              "SELECT lease_expires_at>clock_timestamp() AS live FROM jobs WHERE id=$1",
              [jobId],
            )
          ).rows[0].live
        )
          return null;
      } else {
        if (row.state === "retry_wait") {
          if (
            !(
              await tx.query(
                "SELECT next_attempt_at<=clock_timestamp() AS due FROM jobs WHERE id=$1",
                [jobId],
              )
            ).rows[0].due
          )
            return null;
          await tx.query(
            "UPDATE jobs SET state='queued',stage='queued',revision=revision+1 WHERE id=$1",
            [jobId],
          );
          row = (await this.lock(tx, jobId))!;
        }
        if (row.state !== "queued") return null;
      }
      const policy = await this.policy(tx, record(row));
      this.validatePolicy(policy);
      const counts = (
        await tx.query(
          "SELECT count(*)::int AS global,count(*) FILTER (WHERE workspace_id=$1)::int AS workspace FROM jobs WHERE state IN ('running','packaging','cancel_requested') AND lease_expires_at>clock_timestamp()",
          [row.workspace_id],
        )
      ).rows[0];
      if (
        counts.global >=
          Math.min(
            policy.deployment.global,
            policy.release.global,
            policy.entitlement.global,
          ) ||
        counts.workspace >=
          Math.min(
            policy.deployment.workspace,
            policy.release.workspace,
            policy.entitlement.workspace,
          )
      )
        return null;
      if (
        !confirmation &&
        row.attempt_count >= Math.min(row.max_attempts, policy.maxAttempts)
      ) {
        await this.complete(tx, row, {
          state: "failed",
          result: { code: "ATTEMPTS_EXHAUSTED" },
        });
        return null;
      }
      // Every acquisition gets a token even if worker IDs are reused. Confirmation
      // takeovers cannot increment SQL fence, so owner-token comparison is essential.
      const claimed = (
        await tx.query(
          `UPDATE jobs SET state=$2,stage=$3,fence=fence+$4,attempt_count=attempt_count+$4,lease_owner=$5,lease_expires_at=clock_timestamp()+$6*interval '1 second',next_attempt_at=NULL,revision=revision+1 WHERE id=$1 RETURNING *`,
          [
            jobId,
            confirmation ? row.state : "running",
            confirmation ? "confirming_upstream" : "running",
            confirmation ? 0 : 1,
            id(),
            policy.leaseSeconds,
          ],
        )
      ).rows[0];
      claimed.config_release_id = row.config_release_id;
      if (!confirmation)
        await tx.query(
          "INSERT INTO job_attempts(id,workspace_id,job_id,attempt,fence,worker_id,state,started_at,submission_state) VALUES($1,$2,$3,$4,$5,$6,'running',clock_timestamp(),$7)",
          [
            id(),
            row.workspace_id,
            jobId,
            claimed.attempt_count,
            claimed.fence,
            workerId,
            claimed.provider_submission_state,
          ],
        );
      else
        await tx.query(
          "UPDATE job_attempts SET worker_id=$2 WHERE job_id=$1 AND fence=$3",
          [jobId, workerId, claimed.fence],
        );
      const timing = (
        await tx.query(
          "SELECT greatest(0,extract(epoch FROM (clock_timestamp()-created_at))*1000)::float8 AS delay FROM jobs WHERE id=$1",
          [jobId],
        )
      ).rows[0];
      await jobEvent(tx, claimed, "job.claimed", {
        jobId,
        fence: Number(claimed.fence),
        mode: confirmation ? "confirm" : "execute",
        queueDelayMs: timing.delay,
      });
      return leaseOf(claimed);
    });
  }
  async renewLease(lease: JobLease, _now: string): Promise<JobLease> {
    return this.transaction(async (tx) => {
      const row = await this.live(tx, lease);
      if (!row) fail("JOB_LEASE_LOST", 409);
      const policy = await this.policy(tx, record(row));
      this.validatePolicy(policy);
      const updated = (
        await tx.query(
          "UPDATE jobs SET lease_expires_at=clock_timestamp()+$2*interval '1 second',revision=revision+1 WHERE id=$1 AND lease_expires_at>clock_timestamp() RETURNING *",
          [row.id, policy.leaseSeconds],
        )
      ).rows[0];
      if (!updated) fail("JOB_LEASE_LOST", 409);
      updated.config_release_id = row.config_release_id;
      const heartbeat = (await tx.query("SELECT clock_timestamp() AS at"))
        .rows[0].at;
      await jobEvent(tx, updated, "job.heartbeat", {
        jobId: row.id,
        fence: lease.fence,
        heartbeatAt: new Date(heartbeat).toISOString(),
      });
      return leaseOf(updated);
    });
  }
  /** Invalid leases never invoke hooks; caller can compose output/ledger in its transaction. */
  async finishJobInTransaction(
    tx: PoolClient,
    lease: JobLease,
    outcome: JobOutcome,
    commit?: TerminalCommit,
  ): Promise<boolean> {
    const row = await this.live(tx, lease);
    if (!row) return false;
    if (
      outcome.state === "succeeded" &&
      !["running", "packaging"].includes(row.state)
    )
      return false;
    if (outcome.state === "cancelled" && row.state !== "cancel_requested")
      return false;
    await this.complete(tx, row, outcome, commit, lease);
    return true;
  }
  finishJob(
    lease: JobLease,
    outcome: JobOutcome,
    commit?: TerminalCommit,
  ): Promise<boolean> {
    return this.transaction((tx) =>
      this.finishJobInTransaction(tx, lease, outcome, commit),
    );
  }
  private async complete(
    tx: PoolClient,
    row: Row,
    outcome: JobOutcome,
    commit?: TerminalCommit,
    lease?: JobLease,
  ) {
    if (commit) await commit(tx, record(row), outcome);
    if (this.onTerminal) await this.onTerminal(tx, record(row), outcome);
    if (lease && !(await this.live(tx, lease))) fail("JOB_LEASE_LOST", 409);
    const updated = (
      await tx.query(
        "UPDATE jobs SET state=$2,stage=$2,provider_submission_state='terminal',terminal_at=clock_timestamp(),lease_owner=NULL,lease_expires_at=NULL,error_code=$3,revision=revision+1 WHERE id=$1 AND ($4::text IS NULL OR (lease_owner=$4 AND fence=$5 AND lease_expires_at>clock_timestamp())) RETURNING *",
        [
          row.id,
          outcome.state,
          outcome.state === "failed"
            ? ((outcome.result as { code?: string } | null)?.code ??
              "JOB_FAILED")
            : null,
          lease?.leaseOwner ?? null,
          lease?.fence ?? null,
        ],
      )
    ).rows[0];
    if (!updated) fail("JOB_LEASE_LOST", 409);
    await tx.query(
      "UPDATE job_attempts SET state=$2,submission_state='terminal',ended_at=clock_timestamp(),error_code=$3 WHERE job_id=$1 AND fence=$4",
      [row.id, outcome.state, updated.error_code, row.fence],
    );
    await jobEvent(tx, row, "job.terminal", {
      jobId: row.id,
      state: outcome.state,
      result: outcome.result,
    });
  }
  /** Trusted platform recovery caller supplies live authorization and operation atomicity. */
  async recoverTargetInTransaction(
    tx: PoolClient,
    jobId: string,
    action: "reschedule_dispatch" | "request_cancel",
    expectedRevision: number,
  ) {
    let row = await this.lock(tx, jobId);
    if (!row) fail("NOT_FOUND", 404);
    if (Number(row.revision) !== expectedRevision)
      fail("REVISION_CONFLICT", 409);
    if (terminal(row.state)) fail("JOB_TERMINAL", 409);
    if (action === "reschedule_dispatch") {
      if (
        !["queued", "retry_wait"].includes(row.state) ||
        row.provider_submission_state !== "not_submitted"
      )
        fail("JOB_CONFIRMATION_REQUIRED", 409);
      await tx.query("UPDATE jobs SET revision=revision+1 WHERE id=$1", [
        jobId,
      ]);
      const changed = await tx.query(
        "UPDATE outbox SET sent_at=NULL,claimed_by=NULL,claim_expires_at=NULL,available_at=COALESCE((SELECT next_attempt_at FROM jobs WHERE id=$1),clock_timestamp()),last_error_code=NULL WHERE aggregate_kind='job' AND aggregate_id=$1 AND event_type='job.ready' RETURNING id",
        [jobId],
      );
      if (!changed.rowCount) await jobEvent(tx, row, "job.ready", { jobId });
    } else if (["queued", "retry_wait"].includes(row.state)) {
      await tx.query(
        "UPDATE jobs SET cancel_requested_at=clock_timestamp(),revision=revision+1 WHERE id=$1",
        [jobId],
      );
      row = (await this.lock(tx, jobId))!;
      await this.complete(tx, row, { state: "cancelled", result: {} });
    } else if (row.state !== "cancel_requested")
      await tx.query(
        "UPDATE jobs SET state='cancel_requested',stage='cancelling',cancel_requested_at=clock_timestamp(),revision=revision+1 WHERE id=$1",
        [jobId],
      );
  }
  async requestCancel(
    actor: Actor,
    wid: string,
    jobId: string,
  ): Promise<JobRecord> {
    return this.transaction(async (tx) => {
      const context = (
        await tx.query(
          "SELECT w.kind FROM workspaces w JOIN users u ON u.id=$2 JOIN auth_sessions s ON s.user_id=u.id WHERE w.id=$1 AND w.state='active' AND u.status='active' AND s.id=$3 AND s.client_kind=$4 AND s.revoked_at IS NULL AND s.expires_at>clock_timestamp() FOR SHARE OF w,u,s",
          [wid, actor.userId, actor.sessionId, actor.client],
        )
      ).rows[0];
      if (!context) fail("NOT_FOUND", 404);
      if (context.kind !== "platform") {
        const membership = (
          await tx.query(
            "SELECT role FROM workspace_members WHERE workspace_id=$1 AND user_id=$2 AND state='active' FOR SHARE",
            [wid, actor.userId],
          )
        ).rows[0];
        if (!membership) fail("NOT_FOUND", 404);
        if (membership.role === "viewer") fail("FORBIDDEN", 403);
      }
      let row = await this.lock(tx, jobId, wid);
      if (!row) fail("NOT_FOUND", 404);
      if (context.kind === "platform") {
        // Workspace kind is the boundary, so privacy_export cannot bypass this gate.
        const required: Partial<Record<JobRecord["kind"], string>> = {
          config_test: "platform.config.test",
          reconciliation: "platform.ops.reconcile",
          backup_restore_drill: "platform.ops.backup.verify",
          storage_migration: "platform.storage.migrate",
        };
        const permission =
          required[row.kind as JobRecord["kind"]] ?? "platform.ops.jobs.manage";
        if (!actor.platformPermissions.includes(permission))
          fail("FORBIDDEN", 403);
      }
      if (terminal(row.state)) return record(row);
      if (row.state === "queued" || row.state === "retry_wait") {
        await tx.query(
          "UPDATE jobs SET cancel_requested_at=clock_timestamp(),revision=revision+1 WHERE id=$1",
          [jobId],
        );
        row = (await this.lock(tx, jobId, wid))!;
        await this.complete(tx, row, { state: "cancelled", result: {} });
      } else if (row.state !== "cancel_requested")
        await tx.query(
          "UPDATE jobs SET state='cancel_requested',stage='cancelling',cancel_requested_at=clock_timestamp(),revision=revision+1 WHERE id=$1",
          [jobId],
        );
      return record((await this.lock(tx, jobId, wid))!);
    });
  }
  async markSubmission(
    lease: JobLease,
    state: Exclude<SubmissionState, "not_submitted" | "terminal">,
    providerRequestId: string,
  ): Promise<boolean> {
    return this.transaction(async (tx) => {
      const row = await this.live(tx, lease);
      if (!row || row.state !== "running") return false;
      const allowed: Record<string, string[]> = {
        not_submitted: ["submitting"],
        submitting: ["accepted", "unknown"],
        accepted: ["unknown"],
        unknown: ["accepted"],
      };
      if (!allowed[row.provider_submission_state]?.includes(state))
        return false;
      if (!providerRequestId || providerRequestId.length > 128)
        fail("INVALID_PROVIDER_REQUEST_ID");
      if (
        row.provider_request_id &&
        row.provider_request_id !== providerRequestId
      )
        return false;
      const changed = await tx.query(
        "UPDATE jobs SET provider_submission_state=$2,provider_request_id=$3,stage=$4,revision=revision+1 WHERE id=$1 AND lease_expires_at>clock_timestamp() RETURNING id",
        [
          row.id,
          state,
          providerRequestId,
          state === "unknown" ? "confirming_upstream" : "running",
        ],
      );
      if (!changed.rowCount) return false;
      await tx.query(
        "UPDATE job_attempts SET submission_state=$2,provider_request_id=$3,state=$4 WHERE job_id=$1 AND fence=$5",
        [
          row.id,
          state,
          providerRequestId,
          state === "unknown" ? "unknown" : "running",
          row.fence,
        ],
      );
      return true;
    });
  }
  async failAttempt(
    lease: JobLease,
    error: { code: string; retryable: boolean; definite: boolean },
  ): Promise<boolean> {
    return this.transaction(async (tx) => {
      const row = await this.live(tx, lease);
      if (!row) return false;
      // A definite error from a confirmation request says nothing about the original
      // paid request. Generic errors cannot authorize another submission or release.
      if (
        ["submitting", "accepted", "unknown"].includes(
          row.provider_submission_state,
        )
      ) {
        await this.unknown(tx, row);
        return true;
      }
      if (!error.definite) {
        await this.unknown(tx, row);
        return true;
      }
      if (row.state === "cancel_requested") {
        await this.complete(
          tx,
          row,
          { state: "cancelled", result: {} },
          undefined,
          lease,
        );
        return true;
      }
      const code =
        error.code === "OOM"
          ? "RESOURCE_EXHAUSTED"
          : [
                "UPSTREAM_TEMPORARY",
                "LEASE_EXPIRED",
                "PROVIDER_REJECTED",
                "INVALID_INPUT",
              ].includes(error.code)
            ? error.code
            : "JOB_FAILED";
      const policy = await this.policy(tx, record(row));
      this.validatePolicy(policy);
      if (
        error.retryable &&
        ["UPSTREAM_TEMPORARY", "LEASE_EXPIRED"].includes(code) &&
        row.attempt_count < Math.min(row.max_attempts, policy.maxAttempts) &&
        policy.retryBackoffSeconds[row.attempt_count - 1] !== undefined
      )
        await this.retry(
          tx,
          row,
          code,
          policy.retryBackoffSeconds[row.attempt_count - 1],
          true,
        );
      else
        await this.complete(
          tx,
          row,
          {
            state: "failed",
            result: {
              code,
              ...(code === "RESOURCE_EXHAUSTED"
                ? { guidance: "reduce_resolution_or_split" }
                : {}),
            },
          },
          undefined,
          lease,
        );
      return true;
    });
  }
  private async unknown(tx: PoolClient, row: Row, releaseLease = false) {
    const changed = await tx.query(
      "UPDATE jobs SET provider_submission_state='unknown',stage='confirming_upstream',lease_owner=CASE WHEN $2 THEN NULL ELSE lease_owner END,lease_expires_at=CASE WHEN $2 THEN NULL ELSE lease_expires_at END,revision=revision+1 WHERE id=$1 AND ($2 OR lease_expires_at>clock_timestamp()) RETURNING id",
      [row.id, releaseLease],
    );
    if (!changed.rowCount) fail("JOB_LEASE_LOST", 409);
    await tx.query(
      "UPDATE job_attempts SET state='unknown',submission_state='unknown',error_code='UPSTREAM_STATUS_UNKNOWN',next_query_at=clock_timestamp()+interval '10 seconds' WHERE job_id=$1 AND fence=$2",
      [row.id, row.fence],
    );
  }
  private async retry(
    tx: PoolClient,
    row: Row,
    code: string,
    delay: number,
    requireLive = false,
  ) {
    // No resubmission surface exists without verified original-request resolution.
    if (row.provider_submission_state !== "not_submitted")
      fail("JOB_CONFIRMATION_REQUIRED", 409);
    const changed = await tx.query(
      "UPDATE jobs SET state='retry_wait',stage='retry_wait',provider_submission_state='not_submitted',provider_request_id=NULL,lease_owner=NULL,lease_expires_at=NULL,next_attempt_at=clock_timestamp()+$2*interval '1 second',error_code=$3,revision=revision+1 WHERE id=$1 AND (NOT $4 OR lease_expires_at>clock_timestamp()) RETURNING id",
      [row.id, delay, code, requireLive],
    );
    if (!changed.rowCount) fail("JOB_LEASE_LOST", 409);
    await tx.query(
      "UPDATE job_attempts SET state='failed',ended_at=clock_timestamp(),error_code=$2 WHERE job_id=$1 AND fence=$3",
      [row.id, code, row.fence],
    );
    await tx.query(
      "UPDATE outbox SET available_at=(SELECT next_attempt_at FROM jobs WHERE id=$1),sent_at=NULL WHERE aggregate_id=$1 AND aggregate_kind='job' AND event_type='job.ready'",
      [row.id],
    );
  }
  async recoverExpiredJobs(limit: number): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      fail("INVALID_DISPATCH_LIMIT");
    return this.transaction(async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('album.jobs.claim',0))",
      );
      const candidates = (
        await tx.query(
          select +
            " WHERE j.state IN ('running','packaging','cancel_requested') AND j.lease_expires_at<=clock_timestamp() ORDER BY j.id LIMIT $1 FOR UPDATE OF j SKIP LOCKED",
          [limit],
        )
      ).rows;
      for (const row of candidates) {
        if (
          ["submitting", "accepted", "unknown"].includes(
            row.provider_submission_state,
          )
        )
          await this.unknown(tx, row, true);
        else if (row.state === "cancel_requested")
          await this.complete(tx, row, { state: "cancelled", result: {} });
        else {
          const policy = await this.policy(tx, record(row));
          this.validatePolicy(policy);
          if (
            row.attempt_count <
              Math.min(row.max_attempts, policy.maxAttempts) &&
            policy.retryBackoffSeconds[row.attempt_count - 1] !== undefined
          )
            await this.retry(
              tx,
              row,
              "LEASE_EXPIRED",
              policy.retryBackoffSeconds[row.attempt_count - 1],
            );
          else
            await this.complete(tx, row, {
              state: "failed",
              result: { code: "LEASE_EXPIRED" },
            });
        }
      }
      return candidates.length;
    });
  }
}
