import type { Queue } from "bullmq";
import { digest, fail, id, type Database } from "@album/server-core";
import type { SchedulerMode, SchedulerPort } from "./types";
import type { JobRepository } from "./repository";

/** Queue contents may be lost or duplicated. Workers must claim in PostgreSQL first. */
export class BullMqScheduler implements SchedulerPort {
  constructor(private readonly queue: Queue) {}
  async schedule(jobId: string, mode: SchedulerMode) {
    const schedulingId = digest(jobId); // Opaque IDs may contain ':', which BullMQ rejects.
    const previous = await this.queue.getJob(schedulingId);
    if (previous) {
      const state = await previous.getState();
      if (["completed", "failed"].includes(state)) await previous.remove();
      else if (state === "waiting" || state === "delayed")
        await previous.updateData({ jobId, mode });
    }
    await this.queue.add(
      "durable-job",
      { jobId, mode },
      {
        jobId: schedulingId,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }
}
export class OutboxDispatcher {
  constructor(
    private readonly db: Database,
    private readonly scheduler: SchedulerPort,
    private readonly repository: JobRepository,
  ) {}
  async dispatchOutbox(limit: number): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      fail("INVALID_DISPATCH_LIMIT");
    await this.repository.recoverExpiredJobs(limit);
    const owner = id();
    const candidates = await this.db.transaction(async (tx) => {
      // Rescan sent rows too: Redis is always rebuilt from durable facts.
      // Persist workspace recency in sent_at so even limit=1 rotates.
      return (
        await tx.query(
          `WITH runnable AS (
        SELECT o.id,j.id AS job_id,j.workspace_id,o.created_at,o.sent_at,
          CASE WHEN j.provider_submission_state='unknown' THEN 'confirm' ELSE 'execute' END AS mode,
          row_number() OVER(PARTITION BY j.workspace_id ORDER BY o.sent_at NULLS FIRST,o.created_at,o.id) AS position,
          max(o.sent_at) OVER(PARTITION BY j.workspace_id) AS workspace_last_sent
        FROM jobs j JOIN outbox o ON o.aggregate_kind='job' AND o.aggregate_id=j.id AND o.event_type='job.ready'
        WHERE ((j.state='queued') OR (j.state='retry_wait' AND j.next_attempt_at<=clock_timestamp())
          OR (j.state IN ('running','cancel_requested') AND j.provider_submission_state='unknown' AND j.lease_expires_at IS NULL))
          AND (o.claim_expires_at IS NULL OR o.claim_expires_at<=clock_timestamp())
      ), selected AS (
        SELECT o.id,r.job_id,r.mode,r.position,r.workspace_last_sent,r.created_at FROM runnable r JOIN outbox o ON o.id=r.id
        ORDER BY r.position,r.workspace_last_sent NULLS FIRST,r.created_at,r.id
        LIMIT $1 FOR UPDATE OF o SKIP LOCKED
      ) UPDATE outbox o SET claimed_by=$2,claim_expires_at=clock_timestamp()+interval '30 seconds',delivery_attempts=delivery_attempts+1
        FROM selected s WHERE o.id=s.id RETURNING o.id,s.job_id,s.mode,s.position,s.workspace_last_sent,s.created_at`,
          [limit, owner],
        )
      ).rows;
    });
    candidates.sort(
      (a, b) =>
        Number(a.position) - Number(b.position) ||
        (a.workspace_last_sent
          ? new Date(a.workspace_last_sent).getTime()
          : 0) -
          (b.workspace_last_sent
            ? new Date(b.workspace_last_sent).getTime()
            : 0) ||
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
        a.id.localeCompare(b.id),
    );
    let dispatched = 0;
    for (const candidate of candidates) {
      try {
        await this.scheduler.schedule(candidate.job_id, candidate.mode);
        await this.db.transaction(async (tx) => {
          await tx.query(
            "UPDATE outbox SET sent_at=clock_timestamp(),claimed_by=NULL,claim_expires_at=NULL,last_error_code=NULL WHERE id=$1 AND claimed_by=$2",
            [candidate.id, owner],
          );
        });
        dispatched++;
      } catch {
        await this.db.transaction(async (tx) => {
          await tx.query(
            "UPDATE outbox SET claimed_by=NULL,claim_expires_at=NULL,last_error_code='SCHEDULER_UNAVAILABLE' WHERE id=$1 AND claimed_by=$2",
            [candidate.id, owner],
          );
        });
      }
    }
    return dispatched;
  }
}
