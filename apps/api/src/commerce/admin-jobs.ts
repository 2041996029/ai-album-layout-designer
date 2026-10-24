import { id, fail, type Actor } from "@album/server-core";
import type { ApiRuntime } from "../http/runtime";
import type { CommerceRuntime } from "./runtime";
import { requireRoles } from "../config/secrets";
import { payloadHash, type RequestContext } from "../config/types";
import type { components } from "@album/contracts";
export async function adminJobAction(
  runtime: ApiRuntime,
  s: CommerceRuntime,
  actor: Actor,
  jobId: string,
  input: components["schemas"]["AdminJobAction"],
  request: RequestContext,
) {
  return runtime.db.transaction(async (tx) => {
    await requireRoles(tx, runtime.auth, actor, ["platform_ops"]);
    if (input.action === "reconcile_upstream")
      fail("UPSTREAM_UNCONFIGURED", 503);
    const target = (
      await tx.query("SELECT workspace_id FROM jobs WHERE id=$1", [jobId])
    ).rows[0];
    if (!target) fail("NOT_FOUND", 404);
    const key = request.idempotencyKey;
    if (!key) fail("IDEMPOTENCY_KEY_REQUIRED", 428);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `workspace:${target.workspace_id}:${key}`,
    ]);
    const hash = payloadHash({ actor: actor.userId, jobId, input }),
      old = (
        await tx.query(
          "SELECT * FROM idempotency_keys WHERE workspace_id=$1 AND principal_scope='workspace' AND idempotency_key=$2 AND expires_at>clock_timestamp()",
          [target.workspace_id, key],
        )
      ).rows[0];
    if (old) {
      if (old.operation !== "admin.job.action" || old.request_hash !== hash)
        fail("IDEMPOTENCY_CONFLICT", 409);
      return old.response_json;
    }
    await tx.query(
      "DELETE FROM idempotency_keys WHERE workspace_id=$1 AND principal_scope='workspace' AND idempotency_key=$2 AND expires_at<=clock_timestamp()",
      [target.workspace_id, key],
    );
    const before = (
      await tx.query("SELECT state,revision FROM jobs WHERE id=$1 FOR UPDATE", [
        jobId,
      ])
    ).rows[0];
    if (Number(before.revision) !== input.expectedRevision)
      fail("REVISION_CONFLICT", 409);
    await s.reauth.verifyFresh(
      actor,
      request.reauthProof ?? "",
      "admin_operations",
      tx,
    );
    await s.jobs.recoverTargetInTransaction(
      tx,
      jobId,
      input.action,
      input.expectedRevision,
    );
    const row = (
      await tx.query(
        "SELECT j.*,s.config_release_id,ARRAY(SELECT x.id::text FROM job_outputs x WHERE x.job_id=j.id AND x.workspace_id=j.workspace_id AND j.state='succeeded') AS outputs FROM jobs j JOIN job_snapshots s ON s.id=j.snapshot_id AND s.workspace_id=j.workspace_id WHERE j.id=$1",
        [jobId],
      )
    ).rows[0];
    const result: components["schemas"]["Job"] = {
      id: row.id,
      workspaceId: row.workspace_id,
      kind: row.kind,
      state: row.state,
      stage: row.stage,
      progress: row.state === "succeeded" ? 100 : Number(row.progress),
      revision: Number(row.revision),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.terminal_at ?? row.created_at).toISOString(),
      outputIds: row.outputs,
      configReleaseId: row.config_release_id,
      providerSubmissionState: row.provider_submission_state,
      ...(row.parent_job_id ? { parentJobId: row.parent_job_id } : {}),
    };
    await tx.query(
      "INSERT INTO audit_events(id,workspace_id,actor_user_id,action,target_kind,target_id,request_id,reason,redacted_details) VALUES($1,$2,$3,'commerce.job_action','job',$4,$5,$6,$7)",
      [
        id(),
        row.workspace_id,
        actor.userId,
        jobId,
        request.requestId ?? id(),
        input.reason,
        {
          action: input.action,
          before: { state: before.state, revision: Number(before.revision) },
          after: { state: row.state, revision: Number(row.revision) },
        },
      ],
    );
    await tx.query(
      "INSERT INTO idempotency_keys(id,workspace_id,principal_scope,idempotency_key,request_hash,operation,state,response_status,response_json,resource_kind,resource_id,expires_at) VALUES($1,$2,'workspace',$3,$4,'admin.job.action','completed',202,$5,'job',$6,clock_timestamp()+interval '7 days')",
      [id(), row.workspace_id, key, hash, result, jobId],
    );
    return result;
  });
}
