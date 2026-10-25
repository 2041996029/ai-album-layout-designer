import { digest, fail, id, type Database } from "@album/server-core";
import { canonical } from "../config/types";
export type StatementLine = {
  channel: string;
  transactionId: string;
  orderId: string;
  paidFen: number;
  refundedFen: number;
};
export interface StatementPort {
  read(businessDate: string): Promise<StatementLine[]>;
}
/** Read-only financial comparison. Differences are immutable daily review facts, never fulfillment commands. */
export class ReconciliationService {
  constructor(readonly db: Database) {}
  async reconcileStatement(
    businessDate: string,
    lines: StatementLine[],
  ): Promise<{ matched: number; reviewIds: string[] }> {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(businessDate) ||
      new Date(businessDate + "T00:00:00Z").toISOString().slice(0, 10) !==
        businessDate
    )
      fail("INVALID_BUSINESS_DATE", 422);
    if (
      lines.some(
        (l) =>
          !["wechat_pay", "wechat_virtual"].includes(l.channel) ||
          !l.orderId ||
          !l.transactionId ||
          ![l.paidFen, l.refundedFen].every(
            (n) => Number.isSafeInteger(n) && n >= 0,
          ) ||
          l.refundedFen > l.paidFen,
      )
    )
      fail("INVALID_STATEMENT", 422);
    return this.db.transaction(async (tx) => {
      let matched = 0;
      const reviewIds: string[] = [];
      for (const line of lines) {
        const local = (
          await tx.query(
            `SELECT o.id,o.workspace_id,o.state,o.fulfillment_state,o.amount_fen,o.paid_at,
      EXISTS(SELECT 1 FROM payment_attempts p WHERE p.order_id=o.id AND p.provider_transaction_id=$2 AND p.state='paid') AS capture,
      (SELECT coalesce(sum(r.amount_fen),0) FROM refunds r WHERE r.order_id=o.id AND r.state='succeeded') AS refunded
      FROM orders o WHERE o.id=$1 AND o.channel=$3`,
            [line.orderId, line.transactionId, line.channel],
          )
        ).rows[0];
        const equal =
          local &&
          local.capture &&
          local.paid_at &&
          Number(local.amount_fen) === line.paidFen &&
          Number(local.refunded) === line.refundedFen &&
          local.state !== "closed" &&
          ["fulfilled", "reversed"].includes(local.fulfillment_state);
        if (equal) {
          matched++;
          continue;
        }
        const reviewId =
          "review_" +
          digest(
            canonical({
              businessDate,
              channel: line.channel,
              transactionId: line.transactionId,
              orderId: line.orderId,
            }),
          );
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          reviewId,
        ]);
        await tx.query(
          `INSERT INTO audit_events(id,actor_user_id,action,target_kind,target_id,request_id,reason,redacted_details)
      SELECT $1::text,NULL,'commerce.reconciliation_review','order',$2,$3,'渠道与本地财务事实存在差异',$4 WHERE NOT EXISTS(SELECT 1 FROM audit_events WHERE id=$1::text)`,
          [
            reviewId,
            line.orderId,
            id(),
            {
              businessDate,
              timezone: "Asia/Shanghai",
              statement: line,
              local: local ?? null,
            },
          ],
        );
        reviewIds.push(reviewId);
      }
      return { matched, reviewIds: [...new Set(reviewIds)] };
    });
  }
}
