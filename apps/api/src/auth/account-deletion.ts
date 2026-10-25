import { type Actor, type Database, id, fail } from "@album/server-core";
import type { PoolClient } from "pg";
export type DeletionRequest = {
  reauthProof: string;
  confirm: "DELETE_ACCOUNT";
  reason?: string;
};
export interface FreshProofVerifier {
  verify(
    actor: Actor,
    proof: string,
    purpose: "account_deletion" | "privacy_export",
    tx: PoolClient,
  ): Promise<void>;
}
export interface DeletionAuthorization {
  assertActor(tx: PoolClient, actor: Actor): Promise<void>;
}
/** Restricted, freshly verified recovery identity. Never authorize ordinary workspace requests with it. */
export interface DeletionRecoveryAuthorization {
  assertActor(tx: PoolClient, actor: Actor): Promise<void>;
}
export interface AccountCleanup {
  cleanup(input: {
    userId: string;
    requestId: string;
    idempotencyKey: string;
  }): Promise<void>;
}
export class AccountDeletionService {
  constructor(
    private db: Database,
    private auth: DeletionAuthorization,
    private verifyProof?: FreshProofVerifier,
    private recovery?: DeletionRecoveryAuthorization,
    private cleanup?: AccountCleanup,
  ) {}
  private async blockers(tx: PoolClient, userId: string) {
    const { rows } = await tx.query(
      `SELECT 'owned_studio' AS blocker WHERE EXISTS(SELECT 1 FROM workspaces WHERE owner_user_id=$1 AND kind='studio' AND state<>'deleted') UNION ALL SELECT 'pending_payment' WHERE EXISTS(SELECT 1 FROM orders WHERE buyer_user_id=$1 AND state='pending') UNION ALL SELECT 'pending_refund' WHERE EXISTS(SELECT 1 FROM refunds r JOIN orders o ON o.workspace_id=r.workspace_id AND o.id=r.order_id WHERE o.buyer_user_id=$1 AND r.state IN ('requested','submitted','unknown','manual_review')) UNION ALL SELECT 'active_job' WHERE EXISTS(SELECT 1 FROM jobs WHERE created_by=$1 AND state IN ('queued','running','packaging','retry_wait','cancel_requested')) UNION ALL SELECT 'legal_retention' WHERE EXISTS(SELECT 1 FROM orders WHERE buyer_user_id=$1 AND state IN ('paid','refund_pending','partially_refunded','refunded'))`,
      [userId],
    );
    return rows.map((r) => r.blocker as string);
  }
  private async shape(tx: PoolClient, row: any) {
    return {
      id: row.id,
      state: row.state,
      requestedAt: new Date(row.created_at).toISOString(),
      eligibleAt: new Date(row.not_before).toISOString(),
      blockers: await this.blockers(tx, row.user_id),
    };
  }
  async requestAccountDeletion(actor: Actor, input: DeletionRequest) {
    if (
      input.confirm !== "DELETE_ACCOUNT" ||
      !input.reauthProof ||
      input.reauthProof.length < 16 ||
      input.reauthProof.length > 4096 ||
      (input.reason?.length ?? 0) > 500
    )
      fail("INVALID_DELETION_REQUEST", 422);
    if (!this.verifyProof) fail("REAUTH_UNCONFIGURED", 503);
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "account-deletion:" + actor.userId,
      ]);
      await this.auth.assertActor(tx, actor);
      await this.verifyProof!.verify(
        actor,
        input.reauthProof,
        "account_deletion",
        tx,
      );
      await tx.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [
        actor.userId,
      ]);
      const existing = await tx.query(
        "SELECT * FROM account_deletion_requests WHERE user_id=$1 AND state NOT IN ('cancelled','completed') ORDER BY created_at DESC LIMIT 1",
        [actor.userId],
      );
      if (existing.rows[0]) return this.shape(tx, existing.rows[0]);
      const requestId = id();
      await tx.query(
        "INSERT INTO account_deletion_requests(id,user_id,state,not_before,reason_code) VALUES($1,$2,'requested',now()+interval '7 days','user_requested')",
        [requestId, actor.userId],
      );
      const blockers = await this.blockers(tx, actor.userId);
      const { rows } = await tx.query(
        "UPDATE account_deletion_requests SET state=$2,confirmed_at=now(),revision=revision+1 WHERE id=$1 RETURNING *",
        [requestId, blockers.length ? "blocked" : "confirmed"],
      );
      await tx.query(
        "UPDATE users SET status='deleting',revision=revision+1 WHERE id=$1",
        [actor.userId],
      );
      await tx.query(
        "UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1",
        [actor.userId],
      );
      await tx.query(
        "UPDATE share_links SET state='revoked',revoked_at=COALESCE(revoked_at,now()),revision=revision+1 WHERE created_by=$1 AND state='active'",
        [actor.userId],
      );
      return this.shape(tx, rows[0]);
    });
  }
  private async recoveryActor(tx: PoolClient, actor: Actor) {
    if (!this.recovery) fail("DELETION_REAUTH_REQUIRED", 401);
    await this.recovery.assertActor(tx, actor);
  }
  async get(actor: Actor) {
    return this.db.transaction(async (tx) => {
      await this.recoveryActor(tx, actor);
      const { rows } = await tx.query(
        "SELECT * FROM account_deletion_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1",
        [actor.userId],
      );
      if (!rows[0]) fail("NOT_FOUND", 404);
      return this.shape(tx, rows[0]);
    });
  }
  async cancelAccountDeletion(actor: Actor) {
    return this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "account-deletion:" + actor.userId,
      ]);
      await this.recoveryActor(tx, actor);
      const { rows } = await tx.query(
        "SELECT * FROM account_deletion_requests WHERE user_id=$1 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
        [actor.userId],
      );
      const row = rows[0];
      if (!row) fail("NOT_FOUND", 404);
      if (
        !["requested", "confirmed", "blocked", "cancelled"].includes(row.state)
      )
        fail("DELETION_NOT_CANCELLABLE", 409);
      const result = await tx.query(
        "UPDATE account_deletion_requests SET state='cancelled',revision=revision+1 WHERE id=$1 RETURNING *",
        [row.id],
      );
      await tx.query(
        "UPDATE users SET status='active',revision=revision+1 WHERE id=$1 AND status='deleting'",
        [actor.userId],
      );
      await tx.query(
        "UPDATE auth_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1",
        [actor.userId],
      );
      return this.shape(tx, result.rows[0]);
    });
  }
  /** Worker-only port; no completed state is recorded without actual cleanup. */
  async execute(requestId: string) {
    if (!this.cleanup) fail("CLEANUP_UNCONFIGURED", 503);
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        "SELECT * FROM account_deletion_requests WHERE id=$1 FOR UPDATE",
        [requestId],
      );
      const row = rows[0];
      if (!row) fail("NOT_FOUND", 404);
      if (!["confirmed", "blocked"].includes(row.state))
        fail("DELETION_NOT_EXECUTABLE", 409);
      const blockers = await this.blockers(tx, row.user_id);
      if (blockers.length) {
        await tx.query(
          "UPDATE account_deletion_requests SET state='blocked',revision=revision+1 WHERE id=$1",
          [requestId],
        );
        return { ...(await this.shape(tx, row)), state: "blocked", blockers };
      }
      if (new Date(row.not_before) > new Date())
        fail("DELETION_NOT_ELIGIBLE", 409);
      await tx.query(
        "UPDATE account_deletion_requests SET state='executing',revision=revision+1 WHERE id=$1",
        [requestId],
      );
      await this.cleanup!.cleanup({
        userId: row.user_id,
        requestId,
        idempotencyKey: requestId,
      });
      await tx.query(
        "UPDATE users SET status='deleted',deleted_at=now(),revision=revision+1 WHERE id=$1",
        [row.user_id],
      );
      const result = await tx.query(
        "UPDATE account_deletion_requests SET state='completed',completed_at=now(),revision=revision+1 WHERE id=$1 RETURNING *",
        [requestId],
      );
      return this.shape(tx, result.rows[0]);
    });
  }
}
