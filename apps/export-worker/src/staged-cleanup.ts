import { id, type Database } from "@album/server-core";
import type { JobLease } from "@album/jobs";
import type { ObjectStore, StorageLocator } from "../../api/src/assets/types";
export type StageIdentity = {
  jobId: string;
  fence: number;
  leaseOwner: string;
  objectId: string;
  artifactId: string;
  profileVersionId: string;
  locator: StorageLocator;
  byteLength: number;
  mime: string;
  putSettled: boolean;
  unsettledUntil: string;
};
/** Exact attempt identity is durable before the first PUT byte can be sent. */
export async function persistStage(
  db: Database,
  lease: JobLease,
  input: Omit<
    StageIdentity,
    "jobId" | "fence" | "leaseOwner" | "putSettled" | "unsettledUntil"
  >,
) {
  return db.transaction(async (tx) => {
    const live = (
      await tx.query(
        "SELECT id,clock_timestamp()+interval '7 days' AS unsettled_until FROM jobs WHERE workspace_id=$1 AND id=$2 AND fence=$3 AND lease_owner=$4 AND lease_expires_at>clock_timestamp() AND state IN ('running','packaging') FOR SHARE",
        [lease.job.workspaceId, lease.job.jobId, lease.fence, lease.leaseOwner],
      )
    ).rows[0];
    if (!live) throw Error("JOB_LEASE_LOST");
    const eventId = id(),
      payload: StageIdentity = {
        ...input,
        jobId: lease.job.jobId,
        fence: lease.fence,
        leaseOwner: lease.leaseOwner,
        putSettled: false,
        unsettledUntil: new Date(live.unsettled_until).toISOString(),
      };
    await tx.query(
      "INSERT INTO outbox(id,workspace_id,event_key,aggregate_kind,aggregate_id,event_type,payload) VALUES($1,$2,$1,'job',$3,'export.staged',$4)",
      [
        eventId,
        lease.job.workspaceId,
        lease.job.jobId,
        JSON.stringify(payload),
      ],
    );
    return eventId;
  });
}
export async function markPutSettled(db: Database, eventId: string) {
  await db.transaction(async (tx) => {
    await tx.query(
      "UPDATE outbox SET payload=jsonb_set(payload,'{putSettled}','true'::jsonb) WHERE id=$1 AND event_type='export.staged'",
      [eventId],
    );
  });
}
/** Restart-safe retry consumer. Job lock precedes intent lock; no network call occurs while either is held. */
export async function recoverStagedArtifacts(
  db: Database,
  objects: ObjectStore,
  limit = 100,
  jobId?: string,
) {
  const candidates = await db.transaction(
    async (tx) =>
      (
        await tx.query(
          "SELECT id,workspace_id,aggregate_id FROM outbox WHERE event_type='export.staged' AND sent_at IS NULL AND ($2::text IS NULL OR aggregate_id=$2) AND ($2::text IS NOT NULL OR available_at<=clock_timestamp()) AND (claim_expires_at IS NULL OR claim_expires_at<=clock_timestamp()) ORDER BY created_at,id LIMIT $1",
          [Math.max(1, Math.min(1000, limit)), jobId ?? null],
        )
      ).rows,
  );
  let completed = 0;
  for (const candidate of candidates) {
    const claimed = await db.transaction(async (tx) => {
      const job = (
        await tx.query(
          "SELECT * FROM jobs WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [candidate.workspace_id, candidate.aggregate_id],
        )
      ).rows[0];
      const event = (
        await tx.query(
          "SELECT * FROM outbox WHERE id=$1 AND sent_at IS NULL AND (claim_expires_at IS NULL OR claim_expires_at<=clock_timestamp()) FOR UPDATE",
          [candidate.id],
        )
      ).rows[0];
      if (!job || !event) return;
      const stage = event.payload as StageIdentity;
      const published = (
        await tx.query(
          "SELECT 1 FROM job_outputs x JOIN storage_objects o ON o.workspace_id=x.workspace_id AND o.id=x.storage_object_id JOIN storage_profile_versions p ON p.id=o.profile_version_id WHERE x.workspace_id=$1 AND x.job_id=$2 AND x.id=$3 AND x.storage_object_id=$4 AND x.committed_fence=$5 AND o.profile_version_id=$6 AND p.profile_id=$7 AND p.version=$8 AND o.bucket=$9 AND o.object_key=$10 AND o.object_version_id IS NOT DISTINCT FROM $11::text AND o.sha256=$12 AND o.byte_size=$13",
          [
            candidate.workspace_id,
            stage.jobId,
            stage.artifactId,
            stage.objectId,
            stage.fence,
            stage.profileVersionId,
            stage.locator.storageProfileId,
            stage.locator.profileVersion,
            stage.locator.bucket,
            stage.locator.key,
            stage.locator.objectVersionId,
            stage.locator.sha256,
            stage.byteLength,
          ],
        )
      ).rows[0];
      if (
        published &&
        job.state === "succeeded" &&
        Number(job.fence) === stage.fence
      ) {
        await tx.query(
          "UPDATE outbox SET sent_at=clock_timestamp(),last_error_code=NULL,claimed_by=NULL,claim_expires_at=NULL WHERE id=$1",
          [event.id],
        );
        return { published: true as const };
      }
      const live = (
        await tx.query(
          "SELECT $1::bigint=fence AND $2::text=lease_owner AND lease_expires_at>clock_timestamp() AND state IN ('running','packaging','cancel_requested') AS live FROM jobs WHERE id=$3",
          [stage.fence, stage.leaseOwner, job.id],
        )
      ).rows[0].live;
      if (live) {
        await tx.query("UPDATE outbox SET available_at=$2 WHERE id=$1", [
          event.id,
          job.lease_expires_at,
        ]);
        return;
      }
      // A crash may leave a PUT in flight even after its job becomes terminal. Retain that
      // exact private key through the full seven-day quarantine unless the caller records settlement.
      if (!stage.putSettled) {
        const wait = (
          await tx.query(
            "SELECT $1::timestamptz>clock_timestamp() AS waiting",
            [
              stage.unsettledUntil ??
                new Date(
                  new Date(event.created_at).getTime() + 7 * 86400000,
                ).toISOString(),
            ],
          )
        ).rows[0].waiting;
        if (wait) {
          await tx.query("UPDATE outbox SET available_at=$2 WHERE id=$1", [
            event.id,
            stage.unsettledUntil,
          ]);
          return;
        }
      }
      const owner = id();
      await tx.query(
        "UPDATE outbox SET claimed_by=$2,claim_expires_at=clock_timestamp()+interval '30 seconds',delivery_attempts=delivery_attempts+1 WHERE id=$1",
        [event.id, owner],
      );
      return { published: false as const, stage, owner };
    });
    if (!claimed) continue;
    if (claimed.published) {
      completed++;
      continue;
    }
    let error: string | undefined;
    try {
      await objects.remove(claimed.stage.locator);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        error = "STORAGE_CLEANUP_UNAVAILABLE";
    }
    await db.transaction(async (tx) => {
      await tx.query(
        "UPDATE outbox SET sent_at=CASE WHEN $3::text IS NULL THEN clock_timestamp() ELSE NULL END,last_error_code=$3,available_at=clock_timestamp()+interval '10 seconds',claimed_by=NULL,claim_expires_at=NULL WHERE id=$1 AND claimed_by=$2",
        [candidate.id, claimed.owner, error ?? null],
      );
    });
    if (!error) completed++;
  }
  return completed;
}
