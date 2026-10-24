import type { PoolClient } from "pg";
import type { ConfigRelease } from "../../../apps/api/src/config/types";
import type { components } from "../../contracts/src/api";

export type JobState =
  | "queued"
  | "running"
  | "packaging"
  | "retry_wait"
  | "cancel_requested"
  | "succeeded"
  | "failed"
  | "cancelled";
export type SubmissionState =
  "not_submitted" | "submitting" | "accepted" | "unknown" | "terminal";
export type JobRecord = {
  jobId: string;
  workspaceId: string;
  kind: components["schemas"]["Job"]["kind"];
  state: JobState;
  configReleaseId: string;
  attempt: number;
  fence: number;
  cancelRequested: boolean;
  providerSubmissionState: SubmissionState;
  stage: string;
};
export type JobLease = {
  job: JobRecord;
  leaseOwner: string;
  fence: number;
  expiresAt: string;
};
/** Trusted server input. Caller creates/validates the immutable snapshot in this transaction. */
export type CreateJobInput = {
  workspaceId: string;
  kind: JobRecord["kind"];
  configReleaseId: string;
  inputHash: string;
  payload: unknown;
  createdBy: string;
  snapshotId: string;
  quoteId?: string;
  maxAttempts?: number;
  retry?: { parentJobId: string; expectedRevision: number; reason: string };
};
export type ConcurrencyLimits = { global: number; workspace: number };
export type ExecutionPolicy = {
  deployment: ConcurrencyLimits;
  release: ConcurrencyLimits;
  entitlement: ConcurrencyLimits;
  leaseSeconds: number;
  maxAttempts: number;
  retryBackoffSeconds: readonly number[];
};
/** Resolve frozen release and current deployment/entitlements; SQL-only under locks. */
export type PolicyPort = (
  tx: PoolClient,
  job: JobRecord,
) => Promise<ExecutionPolicy>;
export type JobOutcome = {
  state: "succeeded" | "failed" | "cancelled";
  result: unknown;
};
/** Throwing rolls back terminal state and all output/ledger writes. No external calls. */
export type TerminalCommit = (
  tx: PoolClient,
  job: JobRecord,
  outcome: JobOutcome,
) => Promise<void>;
export type SchedulerMode = "execute" | "confirm";
export interface SchedulerPort {
  schedule(jobId: string, mode: SchedulerMode): Promise<void>;
}

export function policyFromRelease(
  release: ConfigRelease,
  workerKind: "export" | "generation" | "layout" | "storageMigration",
  deployment: ConcurrencyLimits,
  entitlement: ConcurrencyLimits,
): ExecutionPolicy {
  const queues = Object.values(release.versions)
    .map((version) => version.payload)
    .filter(
      (payload) =>
        payload.kind === "queue" && payload.workerKind === workerKind,
    );
  if (queues.length !== 1 || queues[0].kind !== "queue")
    throw Error("JOB_QUEUE_UNCONFIGURED");
  const queue = queues[0];
  return {
    deployment,
    entitlement,
    release: {
      global: queue.maxGlobalConcurrency,
      workspace: queue.maxWorkspaceConcurrency,
    },
    leaseSeconds: queue.leaseSeconds,
    maxAttempts: Math.min(queue.maxAttemptsPerTask, queue.retryLimit + 1, 4),
    retryBackoffSeconds: queue.retryBackoffSeconds,
  };
}
