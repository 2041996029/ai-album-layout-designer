import {
  fail,
  id,
  digest,
  type Actor,
  type Database,
} from "@album/server-core";
import type { PoolClient } from "pg";
import type { JobRepository } from "@album/jobs";
import type { components } from "../../../../packages/contracts/src/api";
import type { AuthService } from "../auth/identity";
import type { ReauthService } from "../auth/reauthentication";
import type { WorkspaceService } from "../workspaces/service";
import { audit, requireRoles } from "../config/secrets";
import { deepFreeze, payloadHash } from "../config/types";
import { PaymentAdapters, validatePaymentEvent } from "../payments/adapters";
import { frozenOrderSnapshot } from "../payments/orders";
import type {
  PaymentAdapter,
  PaymentEvent,
  PaymentRequest,
} from "../payments/types";
import {
  creditLedgerLine,
  lockCreditAccount,
  syncCreditAccount,
} from "./credits";

export type RefundState = components["schemas"]["Refund"]["state"];
/** Internal normalized proof: PaymentEvent alone cannot identify a refund. */
export type VerifiedRefundEvent = PaymentEvent & {
  refundId: string;
  providerRefundId: string;
  refundState: "succeeded" | "failed";
};
export type OriginalRefundRequest = PaymentRequest & {
  refundId: string;
  providerRefundId: string | null;
  amountFen: number;
};
/** Approved channel implementations must authenticate original-refund queries and
 * verify raw refund callbacks independently. null means pending/unknown. */
export interface RefundAdapter extends PaymentAdapter {
  verifyRefundEvent(
    raw: Uint8Array,
    headers: Record<string, string>,
  ): Promise<VerifiedRefundEvent>;
  queryOriginalRefund(
    request: OriginalRefundRequest,
  ): Promise<VerifiedRefundEvent | null>;
}
export class RefundAdapters {
  private readonly entries = new Map<string, RefundAdapter>();
  private readonly trusted = new WeakMap<object, string>();
  constructor(private readonly payments: PaymentAdapters) {}
  register(binding: string, adapter: RefundAdapter) {
    if (this.payments.get(binding) !== adapter)
      fail("REFUND_ADAPTER_MISMATCH", 409);
    if (this.entries.has(binding)) fail("PAYMENT_BINDING_IMMUTABLE", 409);
    this.entries.set(binding, adapter);
  }
  get(binding: string) {
    const adapter = this.entries.get(binding);
    if (!adapter) fail("REFUND_UNCONFIGURED", 503);
    if (adapter !== this.payments.get(binding))
      fail("REFUND_ADAPTER_MISMATCH", 409);
    return adapter;
  }
  private trust(binding: string, raw: VerifiedRefundEvent) {
    const event = validatePaymentEvent(raw);
    for (const value of [raw.refundId, raw.providerRefundId])
      if (typeof value !== "string" || value.length < 1 || value.length > 128)
        fail("REFUND_INVALID_EVENT", 422);
    if (
      event.state !== "refunded" ||
      !["succeeded", "failed"].includes(raw.refundState) ||
      event.channel !== this.get(binding).channel
    )
      fail("REFUND_INVALID_EVENT", 422);
    const verified = deepFreeze({
      ...event,
      refundId: raw.refundId,
      providerRefundId: raw.providerRefundId,
      refundState: raw.refundState,
    });
    this.trusted.set(verified, binding);
    return verified;
  }
  bindingFor(event: PaymentEvent) {
    const binding = this.trusted.get(event);
    if (!binding) fail("REFUND_UNVERIFIED", 401);
    return binding;
  }
  async verify(
    binding: string,
    raw: Uint8Array,
    headers: Record<string, string>,
  ) {
    return this.trust(
      binding,
      await this.get(binding).verifyRefundEvent(raw, headers),
    );
  }
  async query(request: OriginalRefundRequest) {
    const event = await this.get(
      request.snapshot.bindingId,
    ).queryOriginalRefund(request);
    return event === null
      ? null
      : this.trust(request.snapshot.bindingId, event);
  }
}
export type RefundRequestContext = {
  amountFen?: number;
  expectedOrderRevision?: number;
  reauthProof?: string;
  requestId?: string;
};
export type RefundOptions = {
  reauth: Pick<ReauthService, "verifyFresh">;
  jobs: Pick<JobRepository, "requestCancel">;
  now?: () => Date;
  /** Published finance policy supplied by trusted server composition; absent policy blocks decisions. */
  financePolicy?: () => Promise<{ dualReviewRequired: boolean }>;
};
type Row = Record<string, any>;
export class RefundService {
  constructor(
    private readonly db: Database,
    private readonly auth: Pick<AuthService, "assertActor">,
    private readonly workspaces: Pick<WorkspaceService, "authorize">,
    private readonly payments: PaymentAdapters,
    private readonly adapters: RefundAdapters,
    private readonly options: RefundOptions,
    private readonly request: RefundRequestContext = {},
  ) {}
  withRequest(request: RefundRequestContext) {
    return new RefundService(
      this.db,
      this.auth,
      this.workspaces,
      this.payments,
      this.adapters,
      this.options,
      request,
    );
  }
  private at() {
    return this.options.now?.() ?? new Date();
  }
  private reason(reason: string) {
    if (typeof reason !== "string" || !reason.trim() || reason.length > 1000)
      fail("REASON_REQUIRED", 422);
  }
  private async audit(
    tx: PoolClient,
    actor: Actor,
    action: string,
    rid: string,
    reason: string,
    details: Record<string, unknown> = {},
  ) {
    await audit(
      tx,
      actor,
      this.request,
      action,
      "refund",
      rid,
      reason,
      details,
    );
  }
  private async systemAudit(
    tx: PoolClient,
    action: string,
    rid: string,
    details: Record<string, unknown>,
  ) {
    await tx.query(
      "INSERT INTO audit_events(id,action,target_kind,target_id,request_id,reason,redacted_details) VALUES($1,$2,'refund',$3,$4,$2,$5)",
      [id(), action, rid, id(), details],
    );
  }
  private async sourceLots(tx: PoolClient, wid: string, oid: string) {
    return (
      await tx.query(
        "SELECT l.* FROM credit_lots l JOIN entitlement_grants g ON g.workspace_id=l.workspace_id AND g.id=l.source_grant_id WHERE g.workspace_id=$1 AND g.source_order_id=$2 ORDER BY l.expires_at,l.id FOR UPDATE OF l",
        [wid, oid],
      )
    ).rows;
  }
  /** No job locks are acquired while holding order/account. Cancellation happens
   * in separate repository transactions, whose order is job -> account. */
  private async activeJobs(
    tx: PoolClient,
    wid: string,
    oid: string,
  ): Promise<string[]> {
    return (
      await tx.query(
        `SELECT DISTINCT j.id FROM jobs j JOIN job_snapshots s ON s.workspace_id=j.workspace_id AND s.id=j.snapshot_id WHERE j.workspace_id=$1 AND j.state NOT IN ('succeeded','failed','cancelled') AND (
      EXISTS(SELECT 1 FROM credit_reservations r JOIN credit_reservation_allocations a ON a.workspace_id=r.workspace_id AND a.reservation_id=r.id JOIN credit_lots l ON l.workspace_id=a.workspace_id AND l.id=a.lot_id JOIN entitlement_grants g ON g.workspace_id=l.workspace_id AND g.id=l.source_grant_id WHERE r.workspace_id=j.workspace_id AND r.job_id=j.id AND r.state='held' AND g.source_order_id=$2)
      OR EXISTS(SELECT 1 FROM entitlement_grants g WHERE g.workspace_id=j.workspace_id AND g.source_order_id=$2 AND g.grant_type='membership' AND s.entitlement_snapshot->'grantIds' ? g.id::text)) ORDER BY j.id`,
        [wid, oid],
      )
    ).rows.map((r) => r.id);
  }
  private async unused(tx: PoolClient, wid: string, oid: string) {
    const lots = await this.sourceLots(tx, wid, oid);
    if (lots.some((l) => Number(l.consumed) > 0 || Number(l.revoked) > 0))
      return false;
    // No canonical comprehensive feature-usage ledger exists. Once membership
    // started, lack of successful export jobs cannot prove storage/template use
    // never happened. Only untouched not-yet-effective renewals qualify.
    if (
      (
        await tx.query(
          "SELECT 1 FROM entitlement_grants WHERE workspace_id=$1 AND source_order_id=$2 AND grant_type='membership' AND starts_at<=$3 LIMIT 1",
          [wid, oid, this.at()],
        )
      ).rows.length
    )
      return false;
    const used = (
      await tx.query(
        `SELECT 1 FROM jobs j JOIN job_snapshots s ON s.workspace_id=j.workspace_id AND s.id=j.snapshot_id JOIN entitlement_grants g ON g.workspace_id=j.workspace_id AND g.source_order_id=$2 AND g.grant_type='membership' WHERE j.workspace_id=$1 AND j.state='succeeded' AND s.entitlement_snapshot->'grantIds' ? g.id::text LIMIT 1`,
        [wid, oid],
      )
    ).rows.length;
    return !used;
  }
  private async restoreOrder(tx: PoolClient, order: Row) {
    const totals = (
      await tx.query(
        "SELECT coalesce(sum(amount_fen) FILTER(WHERE state='succeeded'),0) AS refunded,count(*) FILTER(WHERE state IN ('requested','submitted','unknown','manual_review')) AS active FROM refunds WHERE workspace_id=$1 AND order_id=$2",
        [order.workspace_id, order.id],
      )
    ).rows[0];
    const state =
      Number(totals.active) > 0
        ? "refund_pending"
        : Number(totals.refunded) >= Number(order.amount_fen)
          ? "refunded"
          : Number(totals.refunded) > 0
            ? "partially_refunded"
            : "paid";
    await tx.query(
      "UPDATE orders SET state=$2,revision=revision+1 WHERE id=$1",
      [order.id, state],
    );
  }
  async requestRefund(
    actor: Actor,
    wid: string,
    orderId: string,
    reason: string,
    key: string,
  ): Promise<{ refundId: string; state: RefundState }> {
    this.reason(reason);
    if (!/^[\x21-\x7e]{16,128}$/.test(key ?? ""))
      fail("IDEMPOTENCY_KEY_REQUIRED", 428);
    const result = await this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "purchase", tx);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `workspace:${wid}:${key}`,
      ]);
      const hash = payloadHash({
        operation: "refund.request",
        actor: actor.userId,
        orderId,
        reason,
        amountFen: this.request.amountFen ?? null,
        expectedOrderRevision: this.request.expectedOrderRevision ?? null,
      });
      const prior = (
        await tx.query(
          "SELECT * FROM idempotency_keys WHERE workspace_id=$1 AND principal_scope='workspace' AND idempotency_key=$2 FOR UPDATE",
          [wid, key],
        )
      ).rows[0];
      if (prior && prior.expires_at > this.at()) {
        if (prior.operation !== "refund.request" || prior.request_hash !== hash)
          fail("IDEMPOTENCY_MISMATCH", 409);
        return prior.response_json as { refundId: string; state: RefundState };
      }
      const operationId = digest(`refund:${wid}:${key}`);
      const durable = (
        await tx.query(
          "SELECT r.*,a.redacted_details->>'requestHash' AS request_hash FROM refunds r JOIN audit_events a ON a.target_id=r.id AND a.action='commerce.refund_requested' WHERE r.workspace_id=$1 AND r.operation_id=$2",
          [wid, operationId],
        )
      ).rows[0];
      if (durable) {
        if (durable.request_hash !== hash) fail("IDEMPOTENCY_MISMATCH", 409);
        return { refundId: durable.id, state: durable.state as RefundState };
      }
      // Current authorization applies to replay too; a one-use proof is consumed
      // only after both completed replay records have been ruled out.
      await this.options.reauth.verifyFresh(
        actor,
        this.request.reauthProof ?? "",
        "billing_refund",
        tx,
      );
      const order = (
        await tx.query(
          "SELECT * FROM orders WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [wid, orderId],
        )
      ).rows[0];
      if (!order) fail("NOT_FOUND", 404);
      if (
        this.request.expectedOrderRevision !== undefined &&
        this.request.expectedOrderRevision !== Number(order.revision)
      )
        fail("REVISION_CONFLICT", 409);
      const snapshot = await frozenOrderSnapshot(tx, orderId, wid);
      const attempt = (
        await tx.query(
          "SELECT * FROM payment_attempts WHERE workspace_id=$1 AND order_id=$2 AND state='paid' ORDER BY attempt DESC LIMIT 1 FOR UPDATE",
          [wid, orderId],
        )
      ).rows[0];
      if (
        !order.paid_at ||
        !attempt ||
        !attempt.provider_transaction_id ||
        ["pending", "closed"].includes(order.state)
      )
        fail("REFUND_NOT_PAID", 409);
      const reserved = Number(
        (
          await tx.query(
            "SELECT coalesce(sum(amount_fen),0) AS amount FROM refunds WHERE workspace_id=$1 AND order_id=$2 AND state<>'failed'",
            [wid, orderId],
          )
        ).rows[0].amount,
      );
      const amount =
        this.request.amountFen ?? Number(order.amount_fen) - reserved;
      if (
        !Number.isSafeInteger(amount) ||
        amount <= 0 ||
        amount + reserved > Number(order.amount_fen)
      )
        fail("REFUND_AMOUNT_INVALID", 422);
      await lockCreditAccount(tx, wid);
      const automatic =
        snapshot.refundPolicy.automatic === "unused_only" &&
        snapshot.payment.refundEnabled &&
        amount === Number(order.amount_fen) &&
        (await this.unused(tx, wid, orderId));
      const state: RefundState = automatic ? "requested" : "manual_review",
        rid = id();
      await tx.query(
        "INSERT INTO refunds(id,workspace_id,order_id,payment_attempt_id,operation_id,amount_fen,state,reason_code) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        [
          rid,
          wid,
          orderId,
          attempt.id,
          operationId,
          amount,
          state,
          automatic ? "UNUSED_SOURCE" : "REFUND_REVIEW_REQUIRED",
        ],
      );
      await tx.query(
        "UPDATE orders SET state='refund_pending',revision=revision+1 WHERE id=$1",
        [orderId],
      );
      await this.audit(tx, actor, "commerce.refund_requested", rid, reason, {
        requestHash: hash,
        reason,
      });
      await syncCreditAccount(tx, wid, this.at());
      const response = { refundId: rid, state };
      if (prior)
        await tx.query("DELETE FROM idempotency_keys WHERE id=$1", [prior.id]);
      await tx.query(
        "INSERT INTO idempotency_keys(id,workspace_id,principal_scope,idempotency_key,request_hash,operation,state,response_status,response_json,expires_at) VALUES($1,$2,'workspace',$3,$4,'refund.request','completed',200,$5,clock_timestamp()+interval '7 days')",
        [id(), wid, key, hash, response],
      );
      return response;
    });
    const jobs = await this.db.transaction((tx) =>
      this.activeJobs(tx, wid, orderId),
    );
    for (const jobId of jobs)
      await this.options.jobs.requestCancel(actor, wid, jobId);
    return result;
  }
  private async context(tx: PoolClient, rid: string) {
    const found = (
      await tx.query("SELECT workspace_id,order_id FROM refunds WHERE id=$1", [
        rid,
      ])
    ).rows[0];
    if (!found) fail("NOT_FOUND", 404);
    const order = (
      await tx.query(
        "SELECT * FROM orders WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [found.workspace_id, found.order_id],
      )
    ).rows[0];
    await lockCreditAccount(tx, found.workspace_id);
    const refund = (
      await tx.query("SELECT * FROM refunds WHERE id=$1 FOR UPDATE", [rid])
    ).rows[0];
    const snapshot = await frozenOrderSnapshot(
      tx,
      order.id,
      order.workspace_id,
    );
    return { order, refund, snapshot };
  }
  async processRefund(
    refundId: string,
    adapter: PaymentAdapter,
  ): Promise<RefundState> {
    const decision = await this.db.transaction(async (tx) => {
      const { order, refund: r, snapshot } = await this.context(tx, refundId);
      if (
        this.payments.get(snapshot.bindingId) !== adapter ||
        this.adapters.get(snapshot.bindingId) !== adapter
      )
        fail("REFUND_ADAPTER_MISMATCH", 409);
      if (["succeeded", "failed"].includes(r.state))
        return { state: r.state as RefundState };
      const request: OriginalRefundRequest = {
        orderId: order.id,
        providerRequestId: refundId,
        snapshot,
        refundId,
        providerRefundId: r.provider_refund_id,
        amountFen: Number(r.amount_fen),
      };
      if (r.state === "manual_review") return { state: r.state as RefundState };
      if (r.state === "requested") {
        if (
          (await this.activeJobs(tx, order.workspace_id, order.id)).length ||
          (await this.sourceLots(tx, order.workspace_id, order.id)).some(
            (l) => Number(l.reserved) > 0,
          )
        )
          return { state: "requested" as const };
        const approved = (
          await tx.query(
            "SELECT 1 FROM audit_events WHERE action='commerce.refund_approved' AND target_id=$1 LIMIT 1",
            [refundId],
          )
        ).rows.length;
        if (
          !approved &&
          (!snapshot.payment.refundEnabled ||
            snapshot.refundPolicy.automatic !== "unused_only" ||
            Number(r.amount_fen) !== Number(order.amount_fen) ||
            !(await this.unused(tx, order.workspace_id, order.id)))
        ) {
          await tx.query(
            "UPDATE refunds SET state='manual_review',reason_code='REFUND_REVIEW_REQUIRED',revision=revision+1 WHERE id=$1",
            [refundId],
          );
          return { state: "manual_review" as const };
        }
        // Persist intent BEFORE external call. A crash/timeout is query-only forever.
        await tx.query(
          "UPDATE refunds SET state='submitted',revision=revision+1 WHERE id=$1",
          [refundId],
        );
        return { request, submit: true };
      }
      return { request, submit: false };
    });
    if ("state" in decision) return decision.state!;
    if (decision.submit) {
      try {
        const receipt = await adapter.refund(
          decision.request!.orderId,
          refundId,
          decision.request!.amountFen,
        );
        if (
          typeof receipt.providerRefundId !== "string" ||
          !receipt.providerRefundId ||
          receipt.providerRefundId.length > 128 ||
          !["submitted", "succeeded", "unknown"].includes(receipt.state)
        )
          fail("REFUND_INVALID_EVENT", 422);
        await this.db.transaction(async (tx) => {
          const { refund: r } = await this.context(tx, refundId);
          if (
            r.provider_refund_id &&
            r.provider_refund_id !== receipt.providerRefundId
          )
            fail("REFUND_MISMATCH", 409);
          await tx.query(
            "UPDATE refunds SET provider_refund_id=$2,state=CASE WHEN state IN ('submitted','unknown') THEN $3 ELSE state END,revision=revision+1 WHERE id=$1",
            [
              refundId,
              receipt.providerRefundId,
              receipt.state === "submitted" ? "submitted" : "unknown",
            ],
          );
        });
      } catch {
        await this.db.transaction(async (tx) => {
          await this.context(tx, refundId);
          await tx.query(
            "UPDATE refunds SET state='unknown',revision=revision+1 WHERE id=$1 AND state IN ('submitted','unknown')",
            [refundId],
          );
        });
      }
    }
    const current = await this.db.transaction(async (tx) => {
      const { refund: r, snapshot } = await this.context(tx, refundId);
      return {
        request: {
          ...decision.request!,
          snapshot,
          providerRefundId: r.provider_refund_id,
        },
        state: r.state as RefundState,
      };
    });
    if (["succeeded", "failed", "manual_review"].includes(current.state))
      return current.state;
    try {
      const event = await this.adapters.query(current.request);
      if (event) return this.confirmVerifiedRefund(event, refundId);
    } catch {
      // Query failures cannot establish terminal state or authorize resubmission.
    }
    return this.db.transaction(async (tx) => {
      const { refund: r } = await this.context(tx, refundId);
      if (["submitted", "unknown"].includes(r.state)) {
        await tx.query(
          "UPDATE refunds SET state='unknown',revision=revision+1 WHERE id=$1",
          [refundId],
        );
        return "unknown";
      }
      return r.state as RefundState;
    });
  }
  /** Compatibility signature: only the RefundAdapters proof registry has authority. */
  confirmRefund(event: PaymentEvent, refundId: string): Promise<RefundState> {
    return this.confirmVerifiedRefund(event as VerifiedRefundEvent, refundId);
  }
  async confirmVerifiedRefund(
    event: VerifiedRefundEvent,
    refundId: string,
  ): Promise<RefundState> {
    return this.applyVerifiedReceipt(
      event,
      refundId,
      this.adapters.bindingFor(event),
    );
  }
  /** Persist recency before any provider/read work. Outbox is the restart-safe
   * scheduler; job dispatch ignores these refund-specific event types. */
  async claimRecovery(kind: "pending" | "receipt", limit: number) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      fail("INVALID_LIMIT", 422);
    return this.db.transaction(async (tx) => {
      const eventType = "refund.recover." + kind;
      const predicate =
        kind === "pending"
          ? "r.state IN ('requested','submitted','unknown')"
          : "r.state='manual_review' AND r.reason_code='VERIFIED_RECEIPT_REVIEW' AND EXISTS(SELECT 1 FROM payment_events e WHERE e.payment_attempt_id=r.payment_attempt_id AND e.redacted_event->>'refundId'=r.id AND e.event_kind='refund_succeeded' AND e.verified_at IS NOT NULL)";
      await tx.query(
        `INSERT INTO outbox(id,created_at,workspace_id,event_key,aggregate_kind,aggregate_id,event_type,payload)
        SELECT md5($1||r.id),r.created_at,r.workspace_id,md5($1||r.id),'refund',r.id,$1,'{}' FROM refunds r WHERE ${predicate} ON CONFLICT(event_key) DO NOTHING`,
        [eventType],
      );
      return (
        await tx.query(
          `WITH selected AS (
        SELECT o.id,r.id AS refund_id,r.order_id,r.workspace_id FROM outbox o JOIN refunds r ON r.id=o.aggregate_id
        WHERE o.aggregate_kind='refund' AND o.event_type=$1 AND o.available_at<=clock_timestamp() AND ${predicate}
        ORDER BY o.available_at,o.created_at,o.id LIMIT $2 FOR UPDATE OF o SKIP LOCKED
      ) UPDATE outbox o SET available_at=clock_timestamp()+interval '30 seconds',sent_at=clock_timestamp(),delivery_attempts=least(o.delivery_attempts+1,1000000)
        FROM selected s WHERE o.id=s.id RETURNING s.refund_id AS id,s.order_id,s.workspace_id`,
          [eventType, limit],
        )
      ).rows;
    });
  }
  async recoverPending(limit: number) {
    const rows = await this.claimRecovery("pending", limit);
    for (const row of rows) {
      try {
        const snapshot = await this.db.transaction((tx) =>
          frozenOrderSnapshot(tx, row.order_id, row.workspace_id),
        );
        await this.processRefund(row.id, this.payments.get(snapshot.bindingId));
      } catch {
        /* Original binding or query may be unavailable; the durable due time advances. */
      }
    }
    return rows.length;
  }
  /** Replay only durable receipts that passed signature and complete business validation.
   * The process never recreates registry proof from caller-supplied JSON. */
  async recoverVerifiedReceipts(limit: number): Promise<number> {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      fail("INVALID_LIMIT", 422);
    const claims = await this.claimRecovery("receipt", limit);
    let completed = 0;
    for (const claim of claims) {
      try {
        const receipt = await this.db.transaction(
          async (tx) =>
            (
              await tx.query(
                "SELECT e.redacted_event,e.body_hash FROM payment_events e WHERE e.redacted_event->>'refundId'=$1 AND e.event_kind='refund_succeeded' AND e.verified_at IS NOT NULL ORDER BY e.created_at DESC LIMIT 1",
                [claim.id],
              )
            ).rows[0],
        );
        if (!receipt) continue;
        const event = receipt.redacted_event as VerifiedRefundEvent;
        if (payloadHash(event) !== receipt.body_hash)
          fail("REFUND_RECEIPT_CORRUPT", 500);
        const snapshot = await this.db.transaction((tx) =>
          frozenOrderSnapshot(tx, event.orderId),
        );
        if (
          (await this.applyVerifiedReceipt(
            event,
            claim.id,
            snapshot.bindingId,
          )) === "succeeded"
        )
          completed++;
      } catch {
        /* Preserve the obligation, continue the fair batch, retry later. */
      }
    }
    return completed;
  }
  private async applyVerifiedReceipt(
    event: VerifiedRefundEvent,
    refundId: string,
    binding: string,
  ): Promise<RefundState> {
    return this.db.transaction(async (tx) => {
      for (const identity of [
        `refund-event:${event.channel}:${event.merchantId}:${event.eventId}`,
        `refund-provider:${event.channel}:${event.merchantId}:${event.providerRefundId}`,
      ].sort())
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          identity,
        ]);
      const { order, refund: r, snapshot } = await this.context(tx, refundId);
      const attempt = (
        await tx.query("SELECT * FROM payment_attempts WHERE id=$1", [
          r.payment_attempt_id,
        ])
      ).rows[0];
      if (
        event.refundId !== refundId ||
        event.orderId !== order.id ||
        event.channel !== order.channel ||
        event.appId !== snapshot.payment.appId ||
        event.merchantId !== snapshot.payment.merchantId ||
        event.merchantId !== attempt.merchant_account_ref ||
        event.amountFen !== Number(r.amount_fen) ||
        event.currency !== order.currency ||
        event.transactionId !== attempt.provider_transaction_id ||
        event.productId !== snapshot.productId ||
        snapshot.bindingId !== binding ||
        (r.provider_refund_id &&
          event.providerRefundId !== r.provider_refund_id)
      )
        fail("REFUND_MISMATCH", 409);
      const collisions = (
        await tx.query(
          "SELECT r.id FROM refunds r JOIN payment_attempts a ON a.id=r.payment_attempt_id WHERE r.id<>$1 AND r.provider_refund_id=$2 AND a.channel=$3 AND a.merchant_account_ref=$4",
          [refundId, event.providerRefundId, event.channel, event.merchantId],
        )
      ).rows;
      if (collisions.length) fail("REFUND_MISMATCH", 409);
      const hash = payloadHash(event);
      const prior = (
        await tx.query(
          "SELECT * FROM payment_events WHERE channel=$1 AND merchant_account_ref=$2 AND provider_event_id=$3",
          [event.channel, event.merchantId, event.eventId],
        )
      ).rows[0];
      if (
        prior &&
        (prior.body_hash !== hash || prior.payment_attempt_id !== attempt.id)
      )
        fail("REFUND_MISMATCH", 409);
      if (!prior)
        await tx.query(
          "INSERT INTO payment_events(id,workspace_id,payment_attempt_id,channel,merchant_account_ref,provider_event_id,provider_transaction_id,body_hash,verified_at,amount_fen,currency,event_kind,redacted_event) VALUES($1,$2,$3,$4,$5,$6,$7,$8,clock_timestamp(),$9,$10,$11,$12)",
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
            event.refundState === "succeeded"
              ? "refund_succeeded"
              : "refund_failed",
            event,
          ],
        );
      if (r.state === "succeeded") return "succeeded";
      await tx.query(
        "UPDATE refunds SET provider_refund_id=$2,revision=revision+1 WHERE id=$1",
        [refundId, event.providerRefundId],
      );
      if (event.refundState === "failed") {
        // A later failure cannot erase a verified success awaiting safe job termination.
        const success = (
          await tx.query(
            "SELECT 1 FROM payment_events WHERE payment_attempt_id=$1 AND event_kind='refund_succeeded' AND redacted_event->>'refundId'=$2 LIMIT 1",
            [attempt.id, refundId],
          )
        ).rows.length;
        if (success) return r.state as RefundState;
        await tx.query(
          "UPDATE refunds SET state='failed',reason_code='CHANNEL_REFUND_FAILED',revision=revision+1 WHERE id=$1",
          [refundId],
        );
        await this.restoreOrder(tx, order);
        await syncCreditAccount(tx, order.workspace_id, this.at());
        return "failed";
      }
      const priorTotal = Number(
        (
          await tx.query(
            "SELECT coalesce(sum(amount_fen),0) AS amount FROM refunds WHERE workspace_id=$1 AND order_id=$2 AND state='succeeded' AND id<>$3",
            [order.workspace_id, order.id, refundId],
          )
        ).rows[0].amount,
      );
      const total = priorTotal + Number(r.amount_fen);
      const lots = await this.sourceLots(tx, order.workspace_id, order.id);
      if (
        total > Number(order.amount_fen) ||
        lots.some((l) => Number(l.reserved) > 0) ||
        (await this.activeJobs(tx, order.workspace_id, order.id)).length
      ) {
        await tx.query(
          "UPDATE refunds SET state='manual_review',reason_code='VERIFIED_RECEIPT_REVIEW',revision=revision+1 WHERE id=$1",
          [refundId],
        );
        await this.restoreOrder(tx, order);
        await syncCreditAccount(tx, order.workspace_id, this.at());
        await this.systemAudit(tx, "commerce.refund_receipt_review", refundId, {
          amountFen: event.amountFen,
        });
        return "manual_review";
      }
      let line = 0,
        loss = 0;
      for (const lot of lots) {
        const target = Number(
          (BigInt(lot.granted) * BigInt(total)) / BigInt(order.amount_fen),
        );
        const desired = Math.max(0, target - Number(lot.revoked));
        const amount = Math.min(desired, Number(lot.available));
        // Expired credits were never consumed; only consumed shortfall is loss.
        loss += Math.min(Math.max(0, desired - amount), Number(lot.consumed));
        if (amount) {
          await tx.query(
            "UPDATE credit_lots SET available=available-$2,revoked=revoked+$2,revision=revision+1 WHERE id=$1",
            [lot.id, amount],
          );
          await creditLedgerLine(tx, {
            wid: order.workspace_id,
            lotId: lot.id,
            groupId: refundId,
            line: ++line,
            type: "revoke",
            amount,
            from: "available",
            to: "revoked",
            balanceAfter: Number(lot.available) - amount,
            reason: "refund_source_reversal",
          });
        }
      }
      const full = total === Number(order.amount_fen);
      if (full) {
        await tx.query(
          "UPDATE entitlement_grants SET state='revoked',revision=revision+1 WHERE workspace_id=$1 AND source_order_id=$2 AND state<>'revoked'",
          [order.workspace_id, order.id],
        );
        await tx.query(
          "UPDATE subscriptions SET state='revoked' WHERE workspace_id=$1 AND source_order_id=$2 AND state<>'revoked'",
          [order.workspace_id, order.id],
        );
      }
      const membershipUsed =
        (
          await tx.query(
            "SELECT 1 FROM jobs j JOIN job_snapshots s ON s.workspace_id=j.workspace_id AND s.id=j.snapshot_id JOIN entitlement_grants g ON g.workspace_id=j.workspace_id AND g.source_order_id=$2 AND g.grant_type='membership' WHERE j.workspace_id=$1 AND j.state='succeeded' AND s.entitlement_snapshot->'grantIds' ? g.id::text LIMIT 1",
            [order.workspace_id, order.id],
          )
        ).rows.length > 0;
      const membershipStarted =
        (
          await tx.query(
            "SELECT 1 FROM entitlement_grants WHERE workspace_id=$1 AND source_order_id=$2 AND grant_type='membership' AND starts_at<=$3 LIMIT 1",
            [order.workspace_id, order.id, this.at()],
          )
        ).rows.length > 0;
      const membershipUsageUnknown = membershipStarted && !membershipUsed;
      if (loss > 0 || membershipUsed || membershipUsageUnknown)
        await this.systemAudit(tx, "commerce.refund_financial_loss", refundId, {
          amountFen: event.amountFen,
          consumedPoints: loss,
          membershipUsed,
          membershipUsageUnknown,
        });
      await tx.query(
        "UPDATE refunds SET state='succeeded',reason_code=$2,revision=revision+1 WHERE id=$1",
        [
          refundId,
          loss > 0 || membershipUsed || membershipUsageUnknown
            ? "FORCED_REFUND_LOSS_REVIEW"
            : "CHANNEL_REFUND_SUCCEEDED",
        ],
      );
      await tx.query(
        "UPDATE orders SET fulfillment_state=$2,revision=revision+1 WHERE id=$1",
        [
          order.id,
          loss > 0 || membershipUsed || membershipUsageUnknown
            ? "manual_review"
            : full
              ? "reversed"
              : order.fulfillment_state,
        ],
      );
      await this.restoreOrder(tx, order);
      await syncCreditAccount(tx, order.workspace_id, this.at());
      await this.systemAudit(tx, "commerce.refund_succeeded", refundId, {
        amountFen: event.amountFen,
        sourceOrderId: order.id,
      });
      return "succeeded";
    });
  }
  async getRefund(
    actor: Actor,
    wid: string,
    refundId: string,
  ): Promise<components["schemas"]["Refund"]> {
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "purchase", tx);
      const r = (
        await tx.query(
          "SELECT r.*,a.reason FROM refunds r LEFT JOIN audit_events a ON a.target_id=r.id AND a.action='commerce.refund_requested' WHERE r.workspace_id=$1 AND r.id=$2",
          [wid, refundId],
        )
      ).rows[0];
      if (!r) fail("NOT_FOUND", 404);
      return {
        id: r.id,
        orderId: r.order_id,
        amountFen: Number(r.amount_fen),
        state: r.state,
        reason: r.reason ?? r.reason_code,
        createdAt: r.created_at.toISOString(),
        revision: Number(r.revision),
        reasonCode: r.reason_code,
      };
    });
  }
  async decideRefund(
    actor: Actor,
    refundId: string,
    decision: components["schemas"]["AdminDecision"],
    key: string,
  ): Promise<RefundState> {
    this.reason(decision.reason);
    if (!/^[\x21-\x7e]{16,128}$/.test(key ?? ""))
      fail("IDEMPOTENCY_KEY_REQUIRED", 428);
    const policy = await this.options.financePolicy?.();
    if (!policy || typeof policy.dualReviewRequired !== "boolean")
      fail("REFUND_POLICY_UNCONFIGURED", 503);
    return this.db.transaction(async (tx) => {
      await requireRoles(tx, this.auth, actor, ["finance"]);
      const target = (
        await tx.query("SELECT workspace_id FROM refunds WHERE id=$1", [
          refundId,
        ])
      ).rows[0];
      if (!target) fail("NOT_FOUND", 404);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `workspace:${target.workspace_id}:${key}`,
      ]);
      const requestHash = payloadHash({
        actor: actor.userId,
        refundId,
        decision,
      });
      const keyRow = (
        await tx.query(
          "SELECT * FROM idempotency_keys WHERE workspace_id=$1 AND principal_scope='workspace' AND idempotency_key=$2 FOR UPDATE",
          [target.workspace_id, key],
        )
      ).rows[0];
      if (
        keyRow &&
        keyRow.expires_at > this.at() &&
        (keyRow.operation !== "refund.decision" ||
          keyRow.request_hash !== requestHash)
      )
        fail("IDEMPOTENCY_MISMATCH", 409);
      const { order, refund: r } = await this.context(tx, refundId);
      const replay = (
        await tx.query(
          "SELECT redacted_details FROM audit_events WHERE target_id=$1 AND action='commerce.refund_decision' AND redacted_details->>'key'=$2",
          [refundId, key],
        )
      ).rows[0];
      if (replay) {
        if (replay.redacted_details.requestHash !== requestHash)
          fail("IDEMPOTENCY_MISMATCH", 409);
        return r.state as RefundState;
      }
      // Replaying an authorized completed decision must not consume another proof.
      await this.options.reauth.verifyFresh(
        actor,
        this.request.reauthProof ?? "",
        "admin_operations",
        tx,
      );
      if (Number(r.revision) !== decision.expectedRevision)
        fail("REVISION_CONFLICT", 409);
      if (r.state !== "manual_review") fail("REFUND_DECISION_INVALID", 409);
      if (!["approve", "reject"].includes(decision.decision))
        fail("REFUND_DECISION_INVALID", 422);
      if (
        (
          await tx.query(
            "SELECT 1 FROM payment_events WHERE payment_attempt_id=$1 AND event_kind='refund_succeeded' AND redacted_event->>'refundId'=$2",
            [r.payment_attempt_id, refundId],
          )
        ).rows.length
      )
        fail("REFUND_RECEIPT_ALREADY_CONFIRMED", 409);
      let state: RefundState = "failed";
      if (decision.decision === "approve") {
        const approvals = (
          await tx.query(
            "SELECT DISTINCT actor_user_id FROM audit_events WHERE target_id=$1 AND action='commerce.refund_approval'",
            [refundId],
          )
        ).rows;
        if (approvals.some((a) => a.actor_user_id === actor.userId))
          fail("REFUND_SECOND_REVIEWER_REQUIRED", 409);
        await this.audit(
          tx,
          actor,
          "commerce.refund_approval",
          refundId,
          decision.reason,
        );
        state =
          policy.dualReviewRequired && approvals.length === 0
            ? "manual_review"
            : "requested";
        if (state === "requested")
          await this.audit(
            tx,
            actor,
            "commerce.refund_approved",
            refundId,
            decision.reason,
          );
      }
      await tx.query(
        "UPDATE refunds SET state=$2,reason_code=$3,revision=revision+1 WHERE id=$1",
        [
          refundId,
          state,
          decision.decision === "reject"
            ? "REFUND_REJECTED"
            : state === "requested"
              ? "REFUND_APPROVED"
              : "SECOND_REVIEW_REQUIRED",
        ],
      );
      await this.audit(
        tx,
        actor,
        "commerce.refund_decision",
        refundId,
        decision.reason,
        { key, requestHash, decision: decision.decision },
      );
      await this.restoreOrder(tx, order);
      await syncCreditAccount(tx, order.workspace_id, this.at());
      if (keyRow)
        await tx.query("DELETE FROM idempotency_keys WHERE id=$1", [keyRow.id]);
      await tx.query(
        "INSERT INTO idempotency_keys(id,workspace_id,principal_scope,idempotency_key,request_hash,operation,state,response_status,response_json,expires_at) VALUES($1,$2,'workspace',$3,$4,'refund.decision','completed',200,$5,clock_timestamp()+interval '7 days')",
        [id(), order.workspace_id, key, requestHash, { state }],
      );
      return state;
    });
  }
}
