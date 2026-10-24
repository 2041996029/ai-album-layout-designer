import { fail, id, type Database } from "@album/server-core";
import type { PaymentAdapters } from "./adapters";
import { payloadHash } from "../config/types";
import { frozenOrderSnapshot } from "./orders";
import type { FulfillmentPort, PaymentEvent } from "./types";

export class PaymentConfirmation {
  constructor(
    private readonly db: Database,
    private readonly adapters: PaymentAdapters,
    private readonly fulfillOrder: FulfillmentPort,
  ) {}
  async confirmPayment(
    event: PaymentEvent,
  ): Promise<{ accepted: boolean; fulfillmentState: string }> {
    const bindingId = this.adapters.bindingFor(event);
    return this.db.transaction(async (tx) => {
      // Serialize event and transaction identity across merchants and workspaces as well.
      for (const identity of [
        `event:${event.channel}:${event.eventId}`,
        `transaction:${event.channel}:${event.transactionId}`,
      ].sort())
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          identity,
        ]);
      const order = (
        await tx.query("SELECT * FROM orders WHERE id=$1 FOR UPDATE", [
          event.orderId,
        ])
      ).rows[0];
      if (!order) fail("PAYMENT_MISMATCH", 409);
      const snapshot = await frozenOrderSnapshot(
        tx,
        order.id,
        order.workspace_id,
      );
      const attempt = (
        await tx.query(
          "SELECT * FROM payment_attempts WHERE workspace_id=$1 AND order_id=$2 AND attempt=1 FOR UPDATE",
          [order.workspace_id, order.id],
        )
      ).rows[0];
      if (
        !attempt ||
        snapshot.bindingId !== bindingId ||
        event.channel !== order.channel ||
        event.appId !== snapshot.payment.appId ||
        event.merchantId !== snapshot.payment.merchantId ||
        event.merchantId !== attempt.merchant_account_ref ||
        event.amountFen !== Number(order.amount_fen) ||
        event.amountFen !== Number(attempt.amount_fen) ||
        event.currency !== order.currency ||
        event.productId !== snapshot.productId ||
        (event.channel === "wechat_virtual" && !event.productId)
      )
        fail("PAYMENT_MISMATCH", 409);
      const hash = payloadHash(event);
      const replay = (
        await tx.query(
          "SELECT * FROM payment_events WHERE channel=$1 AND provider_event_id=$2",
          [event.channel, event.eventId],
        )
      ).rows;
      if (
        replay.some(
          (row) =>
            row.payment_attempt_id !== attempt.id || row.body_hash !== hash,
        )
      )
        fail("PAYMENT_MISMATCH", 409);
      if (event.state !== "closed") {
        const collision = (
          await tx.query(
            "SELECT id FROM payment_attempts WHERE channel=$1 AND provider_transaction_id=$2 AND id<>$3",
            [event.channel, event.transactionId, attempt.id],
          )
        ).rows;
        if (
          collision.length ||
          (attempt.provider_transaction_id &&
            attempt.provider_transaction_id !== event.transactionId)
        )
          fail("PAYMENT_MISMATCH", 409);
      }
      if (!replay.length)
        await tx.query(
          "INSERT INTO payment_events(id,workspace_id,payment_attempt_id,channel,merchant_account_ref,provider_event_id,provider_transaction_id,body_hash,verified_at,amount_fen,currency,event_kind,redacted_event) VALUES($1,$2,$3,$4,$5,$6,$7,$8,now(),$9,$10,$11,$12)",
          [
            id(),
            order.workspace_id,
            attempt.id,
            event.channel,
            event.merchantId,
            event.eventId,
            event.transactionId,
            hash,
            event.amountFen,
            event.currency,
            event.state === "refunded" ? "refund_succeeded" : event.state,
            event,
          ],
        );
      if (event.state === "paid") {
        const review =
          order.state === "closed" ||
          !event.fulfillable ||
          order.fulfillment_state === "manual_review";
        // Refund states are paid facts too; never regress an established refund state.
        if (["pending", "closed", "paid"].includes(order.state))
          await tx.query(
            "UPDATE orders SET state='paid',paid_at=coalesce(paid_at,now()),fulfillment_state=CASE WHEN $3 AND fulfillment_state='unfulfilled' THEN 'manual_review' ELSE fulfillment_state END,revision=revision+1 WHERE workspace_id=$1 AND id=$2",
            [order.workspace_id, order.id, review],
          );
        await tx.query(
          "UPDATE payment_attempts SET state='paid',provider_transaction_id=$3,revision=revision+1 WHERE workspace_id=$1 AND id=$2",
          [order.workspace_id, attempt.id, event.transactionId],
        );
        if (
          !review &&
          order.fulfillment_state === "unfulfilled" &&
          ["pending", "paid"].includes(order.state)
        ) {
          await this.fulfillOrder(tx, order.id);
          await tx.query(
            "UPDATE orders SET fulfillment_state='fulfilled',revision=revision+1 WHERE workspace_id=$1 AND id=$2 AND fulfillment_state='unfulfilled'",
            [order.workspace_id, order.id],
          );
        }
      } else if (event.state === "closed") {
        await tx.query(
          "UPDATE orders SET state='closed',revision=revision+1 WHERE workspace_id=$1 AND id=$2 AND state='pending'",
          [order.workspace_id, order.id],
        );
        await tx.query(
          "UPDATE payment_attempts SET state='closed',revision=revision+1 WHERE workspace_id=$1 AND id=$2 AND state<>'paid'",
          [order.workspace_id, attempt.id],
        );
      } else {
        // Task7 owns refund matching/reversal. Preserve receipt and flag unresolved reversal.
        await tx.query(
          "UPDATE payment_attempts SET state='paid',provider_transaction_id=$3,revision=revision+1 WHERE workspace_id=$1 AND id=$2",
          [order.workspace_id, attempt.id, event.transactionId],
        );
        await tx.query(
          "UPDATE orders SET state=CASE WHEN state IN ('refunded','partially_refunded') THEN state ELSE 'refund_pending' END,paid_at=coalesce(paid_at,now()),fulfillment_state=CASE WHEN fulfillment_state='reversed' THEN fulfillment_state ELSE 'manual_review' END,revision=revision+1 WHERE workspace_id=$1 AND id=$2",
          [order.workspace_id, order.id],
        );
      }
      const result = (
        await tx.query(
          "SELECT fulfillment_state FROM orders WHERE workspace_id=$1 AND id=$2",
          [order.workspace_id, order.id],
        )
      ).rows[0];
      return {
        accepted: true,
        fulfillmentState: result.fulfillment_state as string,
      };
    });
  }
}
