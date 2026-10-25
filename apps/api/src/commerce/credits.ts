import { fail, id, type Database } from "@album/server-core";
import type { PoolClient } from "pg";
import type { TerminalCommit } from "@album/jobs";

export type CreditReservation = {
  reservationId: string;
  workspaceId: string;
  jobId: string;
  points: number;
  state: "reserved" | "settled" | "released";
};
/** Shared with refunds: acquire this before changing a source's eligibility or balances.
 * No frozen SQL bucket exists. Inflight refunds freeze their source lots in place. */
export async function lockCreditAccount(
  tx: PoolClient,
  wid: string,
): Promise<void> {
  await tx.query(
    "INSERT INTO credit_accounts(id,workspace_id) VALUES($1,$2) ON CONFLICT(workspace_id) DO NOTHING",
    [id(), wid],
  );
  await tx.query(
    "SELECT id FROM credit_accounts WHERE workspace_id=$1 FOR UPDATE",
    [wid],
  );
}
/** g is an entitlement_grants alias. Terminal refunds revoke their exact source
 * balances; partial-success status alone must not strand the remaining credits. */
export const sourceCreditFrozenSql = (g = "g") =>
  `(${g}.state='revoked' OR EXISTS(SELECT 1 FROM orders co WHERE co.workspace_id=${g}.workspace_id AND co.id=${g}.source_order_id AND co.state='refund_pending') OR EXISTS(SELECT 1 FROM refunds cr WHERE cr.workspace_id=${g}.workspace_id AND cr.order_id=${g}.source_order_id AND cr.state IN ('requested','submitted','unknown','manual_review')))`;
export async function syncCreditAccount(
  tx: PoolClient,
  wid: string,
  at: Date,
): Promise<void> {
  await tx.query(
    `UPDATE credit_accounts SET available=(SELECT coalesce(sum(l.available),0) FROM credit_lots l JOIN entitlement_grants g ON g.workspace_id=l.workspace_id AND g.id=l.source_grant_id WHERE l.workspace_id=$1 AND l.expires_at>$2 AND NOT ${sourceCreditFrozenSql()}),reserved=(SELECT coalesce(sum(reserved),0) FROM credit_lots WHERE workspace_id=$1),revision=revision+1 WHERE workspace_id=$1`,
    [wid, at],
  );
}
type Lot = {
  id: string;
  available: string;
  reserved: string;
  expires_at: Date;
  frozen: boolean;
};
export async function creditLedgerLine(
  tx: PoolClient,
  input: {
    wid: string;
    lotId: string;
    reservationId?: string;
    groupId: string;
    line: number;
    type: "grant" | "reserve" | "settle" | "release" | "expire" | "revoke";
    amount: number;
    from: "external" | "available" | "reserved";
    to: "available" | "reserved" | "consumed" | "expired" | "revoked";
    balanceAfter: number;
    reason: string;
  },
) {
  const v = input;
  await tx.query(
    "INSERT INTO credit_ledger(id,workspace_id,operation_id,operation_group_id,operation_line,lot_id,reservation_id,entry_type,amount,from_bucket,to_bucket,balance_after,reason_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
    [
      id(),
      v.wid,
      id(),
      v.groupId,
      v.line,
      v.lotId,
      v.reservationId ?? null,
      v.type,
      v.amount,
      v.from,
      v.to,
      v.balanceAfter,
      v.reason,
    ],
  );
}
const reservation = (r: Record<string, unknown>): CreditReservation => ({
  reservationId: r.id as string,
  workspaceId: r.workspace_id as string,
  jobId: r.job_id as string,
  points: Number(r.amount),
  state:
    r.state === "held"
      ? "reserved"
      : r.state === "settled"
        ? "settled"
        : "released",
});
const checkPoints = (points: number) => {
  if (!Number.isSafeInteger(points) || points < 0)
    fail("CREDIT_AMOUNT_INVALID", 422);
};
export class CreditService {
  constructor(
    readonly db: Database,
    readonly now: () => Date = () => new Date(),
  ) {}
  private async expireAvailable(tx: PoolClient, wid: string, at: Date) {
    const lots = (
      await tx.query<Lot>(
        "SELECT id,available,expires_at FROM credit_lots WHERE workspace_id=$1 AND expires_at<=$2 AND available>0 ORDER BY expires_at,id FOR UPDATE",
        [wid, at],
      )
    ).rows;
    const group = id();
    let line = 0;
    for (const lot of lots) {
      const amount = Number(lot.available);
      await tx.query(
        "UPDATE credit_lots SET expired=expired+available,available=0,revision=revision+1 WHERE id=$1",
        [lot.id],
      );
      await creditLedgerLine(tx, {
        wid,
        lotId: lot.id,
        groupId: group,
        line: ++line,
        type: "expire",
        amount,
        from: "available",
        to: "expired",
        balanceAfter: 0,
        reason: "original_expiry",
      });
    }
  }
  /** Trusted server admission only, after createJob in the SAME transaction. The
   * persisted generation quote/job/snapshot bind amount, workspace and input;
   * no quote may be synthesized by this service. */
  async reserveCredits(
    tx: PoolClient,
    wid: string,
    jobId: string,
    points: number,
  ): Promise<CreditReservation> {
    checkPoints(points);
    // Job first is the same order used by JobRepository's guarded terminal hook.
    const job = (
      await tx.query(
        "SELECT j.*,q.credit_cost,q.expires_at AS quote_expires,q.input_hash,q.config_release_id,s.normalized_spec_hash,s.quote_id AS snapshot_quote,s.config_release_id AS snapshot_release FROM jobs j JOIN generation_quotes q ON q.workspace_id=j.workspace_id AND q.id=j.quote_id JOIN job_snapshots s ON s.workspace_id=j.workspace_id AND s.id=j.snapshot_id WHERE j.workspace_id=$1 AND j.id=$2 FOR UPDATE OF j",
        [wid, jobId],
      )
    ).rows[0];
    if (!job || job.kind !== "generation")
      fail("CREDIT_QUOTED_JOB_REQUIRED", 409);
    await lockCreditAccount(tx, wid);
    const existing = (
      await tx.query(
        "SELECT * FROM credit_reservations WHERE workspace_id=$1 AND job_id=$2",
        [wid, jobId],
      )
    ).rows[0];
    if (existing) {
      if (Number(existing.amount) !== points)
        fail("CREDIT_RESERVATION_MISMATCH", 409);
      return reservation(existing);
    }
    const at = this.now();
    if (
      job.state !== "queued" ||
      Number(job.credit_cost) !== points ||
      job.quote_expires <= at ||
      job.snapshot_quote !== job.quote_id ||
      job.snapshot_release !== job.config_release_id ||
      job.normalized_spec_hash !== job.input_hash
    )
      fail("CREDIT_QUOTE_MISMATCH", 409);
    await this.expireAvailable(tx, wid, at);
    const lots = (
      await tx.query<Lot>(
        `SELECT l.*,${sourceCreditFrozenSql()} AS frozen FROM credit_lots l JOIN entitlement_grants g ON g.workspace_id=l.workspace_id AND g.id=l.source_grant_id WHERE l.workspace_id=$1 AND l.available>0 AND l.expires_at>$2 ORDER BY l.expires_at,l.id FOR UPDATE OF l`,
        [wid, at],
      )
    ).rows.filter((l) => !l.frozen);
    if (lots.reduce((sum, l) => sum + Number(l.available), 0) < points)
      fail("CREDITS_INSUFFICIENT", 409);
    const rid = id();
    const row = (
      await tx.query(
        "INSERT INTO credit_reservations(id,created_at,workspace_id,job_id,quote_id,amount,expires_at) VALUES($1,$2,$3,$4,$5,$6,$2::timestamptz+interval '30 minutes') RETURNING *",
        [rid, at, wid, jobId, job.quote_id, points],
      )
    ).rows[0];
    let remaining = points,
      line = 0;
    for (const lot of lots) {
      if (!remaining) break;
      const amount = Math.min(remaining, Number(lot.available));
      remaining -= amount;
      await tx.query(
        "UPDATE credit_lots SET available=available-$2,reserved=reserved+$2,revision=revision+1 WHERE id=$1",
        [lot.id, amount],
      );
      await tx.query(
        "INSERT INTO credit_reservation_allocations(id,workspace_id,reservation_id,lot_id,amount) VALUES($1,$2,$3,$4,$5)",
        [id(), wid, rid, lot.id, amount],
      );
      await creditLedgerLine(tx, {
        wid,
        lotId: lot.id,
        reservationId: rid,
        groupId: rid,
        line: ++line,
        type: "reserve",
        amount,
        from: "available",
        to: "reserved",
        balanceAfter: Number(lot.available) - amount,
        reason: "job_acceptance",
      });
    }
    await syncCreditAccount(tx, wid, at);
    return reservation(row);
  }
  private async terminal(
    tx: PoolClient,
    rid: string,
    eventId: string,
    settle: boolean,
  ) {
    // Lookup only, then lock account before reservation/lot to match refund ordering.
    const context = (
      await tx.query(
        "SELECT workspace_id FROM credit_reservations WHERE id=$1",
        [rid],
      )
    ).rows[0];
    if (!context) fail("CREDIT_RESERVATION_NOT_FOUND", 404);
    const wid = context.workspace_id;
    await lockCreditAccount(tx, wid);
    const r = (
      await tx.query(
        "SELECT * FROM credit_reservations WHERE id=$1 FOR UPDATE",
        [rid],
      )
    ).rows[0];
    if (r.state !== "held") return;
    const at = this.now(),
      lots = (
        await tx.query<Lot & { amount: string }>(
          `SELECT l.*,a.amount,${sourceCreditFrozenSql()} AS frozen FROM credit_reservation_allocations a JOIN credit_lots l ON l.workspace_id=a.workspace_id AND l.id=a.lot_id JOIN entitlement_grants g ON g.workspace_id=l.workspace_id AND g.id=l.source_grant_id WHERE a.workspace_id=$1 AND a.reservation_id=$2 ORDER BY l.expires_at,l.id FOR UPDATE OF l`,
          [wid, rid],
        )
      ).rows;
    if (settle && lots.some((l) => l.frozen)) fail("CREDITS_FROZEN", 409);
    const changed = await tx.query(
      "UPDATE credit_reservations SET state=$2,settled_at=$3,revision=revision+1 WHERE id=$1 AND state='held'",
      [rid, settle ? "settled" : "released", at],
    );
    if (!changed.rowCount) return;
    let line = 0;
    for (const lot of lots) {
      const amount = Number(lot.amount),
        to = settle
          ? "consumed"
          : lot.expires_at <= at
            ? "expired"
            : "available";
      if (Number(lot.reserved) < amount) fail("CREDIT_ALLOCATION_CORRUPT", 409);
      const updated = (
        await tx.query(
          `UPDATE credit_lots SET reserved=reserved-$2,${to}=${to}+$2,revision=revision+1 WHERE id=$1 RETURNING ${to} AS balance`,
          [lot.id, amount],
        )
      ).rows[0];
      await creditLedgerLine(tx, {
        wid,
        lotId: lot.id,
        reservationId: rid,
        groupId: eventId,
        line: ++line,
        type: settle ? "settle" : "release",
        amount,
        from: "reserved",
        to,
        balanceAfter: Number(updated.balance),
        reason: settle ? "job_success" : "job_terminal_release",
      });
    }
    await this.expireAvailable(tx, wid, at);
    await syncCreditAccount(tx, wid, at);
  }
  settleCredits(tx: PoolClient, rid: string, eventId: string) {
    return this.terminal(tx, rid, eventId, true);
  }
  releaseCredits(tx: PoolClient, rid: string, eventId: string) {
    return this.terminal(tx, rid, eventId, false);
  }
  async creditBalance(
    wid: string,
    at: string,
  ): Promise<{
    available: number;
    reserved: number;
    frozen: number;
    expired: number;
  }> {
    const time = new Date(at);
    if (!Number.isFinite(+time)) fail("INVALID_TIME", 422);
    return this.db.transaction(async (tx) => {
      await lockCreditAccount(tx, wid);
      await this.expireAvailable(tx, wid, time);
      await syncCreditAccount(tx, wid, time);
      const row = (
        await tx.query(
          `SELECT coalesce(sum(CASE WHEN NOT ${sourceCreditFrozenSql()} AND l.expires_at>$2 THEN l.available ELSE 0 END),0) AS available,coalesce(sum(l.reserved),0) AS reserved,coalesce(sum(CASE WHEN ${sourceCreditFrozenSql()} AND l.expires_at>$2 THEN l.available ELSE 0 END),0) AS frozen,coalesce(sum(l.expired),0) AS expired FROM credit_lots l JOIN entitlement_grants g ON g.workspace_id=l.workspace_id AND g.id=l.source_grant_id WHERE l.workspace_id=$1`,
          [wid, time],
        )
      ).rows[0];
      return {
        available: Number(row.available),
        reserved: Number(row.reserved),
        frozen: Number(row.frozen),
        expired: Number(row.expired),
      };
    });
  }
  /** Compose with exportTerminalHook when constructing JobRepository. Never call
   * from an unfenced worker callback: the repository owns terminal authority. */
  readonly creditTerminalHook: TerminalCommit = async (tx, job, outcome) => {
    const row = (
      await tx.query(
        "SELECT id FROM credit_reservations WHERE workspace_id=$1 AND job_id=$2",
        [job.workspaceId, job.jobId],
      )
    ).rows[0];
    if (row)
      await this.terminal(tx, row.id, id(), outcome.state === "succeeded");
  };
}
