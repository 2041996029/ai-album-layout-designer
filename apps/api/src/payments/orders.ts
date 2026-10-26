import { digest, fail, id, type Actor } from "@album/server-core";
import type { PoolClient } from "pg";
import {
  canonical,
  deepFreeze,
  payloadHash,
  validateConfigPayload,
  type ConfigRelease,
} from "../config/types";
import type {
  CreateOrderResult,
  OrderCatalog,
  OrderOptions,
  OrderSnapshot,
  PaymentAdmissionPort,
  PaymentEvent,
  PaymentRequest,
} from "./types";

/** Read within the caller's transaction, including Task5 fulfillment. */
export async function frozenOrderSnapshot(
  tx: PoolClient,
  orderId: string,
  workspaceId?: string,
): Promise<Readonly<OrderSnapshot>> {
  const row = (
    await tx.query(
      "SELECT * FROM order_snapshots WHERE order_id=$1 AND ($2::text IS NULL OR workspace_id=$2)",
      [orderId, workspaceId ?? null],
    )
  ).rows[0];
  if (!row) fail("PAYMENT_SNAPSHOT_MISSING", 503);
  if (payloadHash(row.snapshot) !== row.snapshot_hash)
    fail("PAYMENT_SNAPSHOT_CORRUPT", 503);
  return deepFreeze(row.snapshot as OrderSnapshot);
}

/** Published release loader is ConfigService.loadRelease (or its atomic cache). */
export class PublishedOrderCatalog implements OrderCatalog {
  constructor(
    private readonly release: () => Promise<Readonly<ConfigRelease>>,
    private readonly admission: PaymentAdmissionPort,
  ) {}
  async resolve(
    tx: PoolClient,
    skuVersionId: string,
    channel: PaymentEvent["channel"],
    client: Actor["client"],
  ): Promise<OrderSnapshot> {
    const release = await this.release(),
      skuVersion = release.versions.sku,
      paymentVersion = release.versions.payment;
    if (
      skuVersion?.state !== "published" ||
      paymentVersion?.state !== "published" ||
      skuVersion.payload.kind !== "sku" ||
      paymentVersion.payload.kind !== "payment"
    )
      fail("PAYMENT_UNCONFIGURED", 503);
    const sku = skuVersion.payload,
      rootPayment = paymentVersion.payload,
      payment = [rootPayment, ...(rootPayment.additionalChannels ?? [])].find(
        (p) => p.channel === channel,
      );
    if (!payment) fail("PAYMENT_UNCONFIGURED", 503);
    validateConfigPayload("sku", sku);
    validateConfigPayload("payment", payment);
    if (
      !sku.enabled ||
      !payment.enabled ||
      payment.channel !== channel ||
      (["wechat_pay", "alipay"].includes(channel) && client !== "web") ||
      (channel === "wechat_virtual" && client !== "mini")
    )
      fail("PAYMENT_UNCONFIGURED", 503);
    const row = (
      await tx.query(
        "SELECT v.*,s.state,s.id AS billing_id FROM sku_versions v JOIN billing_skus s ON s.id=v.sku_id WHERE v.id=$1",
        [skuVersionId],
      )
    ).rows[0];
    // Task5 materialization stores the whole typed published SKU as an immutable feature.
    if (
      !row ||
      row.state !== "active" ||
      row.billing_id !== sku.skuId ||
      Number(row.price_fen) !== sku.priceFen ||
      row.currency !== sku.currency ||
      row.duration_days !== sku.durationDays ||
      Number(row.credit_grant) !== sku.credits ||
      !row.features.publishedSku ||
      canonical(row.features.publishedSku) !== canonical(sku)
    )
      fail("SKU_UNPUBLISHED", 409);
    const admitted = await this.admission.admit({
      sku,
      payment,
      client,
      release,
    });
    if (channel === "wechat_virtual" && !admitted.productId)
      fail("PAYMENT_UNCONFIGURED", 503);
    return {
      releaseId: release.releaseId,
      bindingId:
        channel === rootPayment.channel
          ? paymentVersion.id
          : `${paymentVersion.id}:${channel}`,
      skuVersionId,
      sku,
      payment,
      ...admitted,
    };
  }
}

export class OrderService {
  constructor(public readonly options: OrderOptions) {}
  private now() {
    return this.options.now?.() ?? new Date();
  }
  async createOrder(
    actor: Actor,
    wid: string,
    skuVersionId: string,
    channel: PaymentEvent["channel"],
    key: string,
  ): Promise<CreateOrderResult> {
    if (!key || key.length > 128) fail("IDEMPOTENCY_KEY_REQUIRED", 428);
    const hash = digest(
      canonical({
        method: "POST",
        path: `/v1/workspaces/${wid}/orders`,
        userId: actor.userId,
        workspaceId: wid,
        skuVersionId,
        channel,
      }),
    );
    const prepared = await this.options.db.transaction(async (tx) => {
      await this.options.workspaces.authorize(actor, wid, "purchase", tx);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `workspace:${wid}:${key}`,
      ]);
      const prior = (
        await tx.query(
          "SELECT * FROM idempotency_keys WHERE workspace_id=$1 AND principal_scope='workspace' AND idempotency_key=$2 FOR UPDATE",
          [wid, key],
        )
      ).rows[0];
      if (prior) {
        if (prior.request_hash !== hash || prior.operation !== "payment.create")
          fail("IDEMPOTENCY_CONFLICT", 409);
        return prior.response_json as CreateOrderResult;
      }
      const snapshot = structuredClone(
        await this.options.catalog.resolve(
          tx,
          skuVersionId,
          channel,
          actor.client,
        ),
      );
      this.options.adapters.get(snapshot.bindingId);
      if (
        snapshot.skuVersionId !== skuVersionId ||
        snapshot.payment.channel !== channel ||
        !snapshot.sku.enabled ||
        !snapshot.payment.enabled ||
        !Number.isSafeInteger(snapshot.sku.priceFen) ||
        snapshot.sku.priceFen < 0 ||
        snapshot.sku.priceFen > 1e12 ||
        snapshot.sku.currency !== "CNY"
      )
        fail("PAYMENT_MISMATCH", 409);
      const orderId = id(),
        attemptId = id(),
        now = this.now(),
        expires = new Date(now.getTime() + 300000);
      const result = {
        orderId,
        amountFen: snapshot.sku.priceFen,
        clientPayload: undefined,
      };
      await tx.query(
        "INSERT INTO orders(id,created_at,workspace_id,sku_version_id,buyer_user_id,amount_fen,channel,client_platform,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          orderId,
          now,
          wid,
          skuVersionId,
          actor.userId,
          result.amountFen,
          channel,
          actor.client,
          expires,
        ],
      );
      await tx.query(
        "INSERT INTO order_snapshots(order_id,workspace_id,release_id,payment_config_id,snapshot_hash,snapshot) VALUES($1,$2,$3,(SELECT id FROM config_release_items WHERE release_id=$6 AND namespace='payment'),$4,$5)",
        [
          orderId,
          wid,
          snapshot.releaseId,
          payloadHash(snapshot),
          snapshot,
          snapshot.releaseId,
        ],
      );
      await tx.query(
        "INSERT INTO payment_attempts(id,created_at,workspace_id,order_id,attempt,channel,merchant_account_ref,provider_request_id,amount_fen) VALUES($1,$2,$3,$4,1,$5,$6,$8,$7)",
        [
          attemptId,
          now,
          wid,
          orderId,
          channel,
          snapshot.payment.merchantId,
          result.amountFen,
          orderId,
        ],
      );
      await tx.query(
        "INSERT INTO outbox(id,workspace_id,event_key,aggregate_kind,aggregate_id,event_type,payload,available_at) VALUES($1,$2,$3,'order',$4,'payment.query',$5,$6)",
        [id(), wid, `payment-query-${orderId}`, orderId, { orderId }, expires],
      );
      await tx.query(
        "INSERT INTO idempotency_keys(id,workspace_id,principal_scope,idempotency_key,request_hash,operation,state,response_status,response_json,resource_kind,resource_id,expires_at) VALUES($1,$2,'workspace',$3,$4,'payment.create','completed',200,$5,'order',$6,now()+interval '7 days')",
        [id(), wid, key, hash, result, orderId],
      );
      return result;
    });
    // One committed submission intent. A crash/timeout cannot trigger a second create.
    const request = await this.options.db.transaction(async (tx) => {
      await this.options.workspaces.authorize(actor, wid, "purchase", tx);
      const claimed = (
        await tx.query(
          "UPDATE payment_attempts SET state='unknown',revision=revision+1 WHERE workspace_id=$1 AND order_id=$2 AND state='created' RETURNING provider_request_id",
          [wid, prepared.orderId],
        )
      ).rows[0];
      if (!claimed) return null;
      return {
        orderId: prepared.orderId,
        providerRequestId: claimed.provider_request_id,
        snapshot: await frozenOrderSnapshot(tx, prepared.orderId, wid),
      };
    });
    if (!request) return { ...prepared, clientPayload: prepared.clientPayload };
    try {
      const response = await this.options.adapters
        .get(request.snapshot.bindingId)
        .createPayment(request.orderId, request);
      const result = { ...prepared, clientPayload: response.clientPayload };
      await this.options.db.transaction(async (tx) => {
        await tx.query(
          "UPDATE payment_attempts SET state='submitted',revision=revision+1 WHERE workspace_id=$1 AND order_id=$2 AND state='unknown'",
          [wid, request.orderId],
        );
        await tx.query(
          "UPDATE idempotency_keys SET response_json=$3 WHERE workspace_id=$1 AND resource_id=$2 AND operation='payment.create'",
          [wid, request.orderId, result],
        );
      });
      return result;
    } catch {
      return { ...prepared, clientPayload: undefined };
    }
  }
  private async request(
    actor: Actor,
    wid: string,
    orderId: string,
  ): Promise<PaymentRequest> {
    return this.options.db.transaction(async (tx) => {
      await this.options.workspaces.authorize(actor, wid, "purchase", tx);
      const attempt = (
        await tx.query(
          "SELECT provider_request_id FROM payment_attempts WHERE workspace_id=$1 AND order_id=$2 AND attempt=1",
          [wid, orderId],
        )
      ).rows[0];
      if (!attempt) fail("NOT_FOUND", 404);
      return {
        orderId,
        providerRequestId: attempt.provider_request_id,
        snapshot: await frozenOrderSnapshot(tx, orderId, wid),
      };
    });
  }
  private async queryRequest(request: PaymentRequest) {
    if (!this.options.confirmation)
      fail("PAYMENT_CONFIRMATION_UNCONFIGURED", 503);
    const event = await this.options.adapters.query(request);
    if (event) {
      if (event.orderId !== request.orderId) fail("PAYMENT_MISMATCH", 409);
      await this.options.confirmation.confirmPayment(event);
    }
  }
  private async read(actor: Actor, wid: string, orderId: string) {
    return this.options.db.transaction(async (tx) => {
      await this.options.workspaces.authorize(actor, wid, "purchase", tx);
      const row = (
        await tx.query(
          "SELECT state,fulfillment_state FROM orders WHERE workspace_id=$1 AND id=$2",
          [wid, orderId],
        )
      ).rows[0];
      if (!row) fail("NOT_FOUND", 404);
      return {
        orderId,
        state: row.state as string,
        fulfillmentState: row.fulfillment_state as string,
      };
    });
  }
  async queryOrder(actor: Actor, wid: string, orderId: string) {
    const request = await this.request(actor, wid, orderId);
    await this.queryRequest(request);
    return this.read(actor, wid, orderId);
  }
  async closeOrder(actor: Actor, wid: string, orderId: string) {
    const request = await this.request(actor, wid, orderId);
    await this.queryRequest(request);
    const shouldClose = await this.options.db.transaction(async (tx) => {
      await this.options.workspaces.authorize(actor, wid, "purchase", tx);
      const row = (
        await tx.query(
          "SELECT state FROM orders WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
          [wid, orderId],
        )
      ).rows[0];
      if (row.state !== "pending") return false;
      // Unique durable intent is never blindly replayed; subsequent calls query only.
      const inserted = await tx.query(
        "INSERT INTO outbox(id,workspace_id,event_key,aggregate_kind,aggregate_id,event_type,payload) VALUES($1,$2,$3,'order',$4,'payment.close_intent',$5) ON CONFLICT(event_key) DO NOTHING RETURNING id",
        [id(), wid, `payment-close-${orderId}`, orderId, { orderId }],
      );
      return inserted.rowCount === 1;
    });
    if (shouldClose) {
      try {
        const event = await this.options.adapters.close(request);
        if (event) {
          if (event.orderId !== orderId) fail("PAYMENT_MISMATCH", 409);
          await this.options.confirmation!.confirmPayment(event);
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("PAYMENT_"))
          throw error;
      }
    }
    return this.read(actor, wid, orderId);
  }
  /** Runtime schedules this SQL scan; outbox/queue loss cannot lose the due query. */
  async reconcileDue(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      fail("INVALID_LIMIT", 422);
    const due = await this.options.db.transaction(async (tx) => {
      const now = this.now();
      // Rebuild missing scheduling facts after queue/outbox loss. Sent delivery does
      // not mean that a pending payment was resolved, so recovery ignores sent_at.
      await tx.query(
        "INSERT INTO outbox(id,workspace_id,event_key,aggregate_kind,aggregate_id,event_type,payload,available_at) SELECT 'payment-query-'||o.id,o.workspace_id,'payment-query-'||o.id,'order',o.id,'payment.query',jsonb_build_object('orderId',o.id),o.expires_at FROM orders o WHERE o.state='pending' AND o.expires_at<=$1 ON CONFLICT(event_key) DO NOTHING",
        [now],
      );
      const rows = (
        await tx.query(
          "SELECT o.id,o.workspace_id,p.provider_request_id,q.id AS query_id FROM outbox q JOIN orders o ON o.id=q.aggregate_id AND o.workspace_id=q.workspace_id JOIN payment_attempts p ON p.workspace_id=o.workspace_id AND p.order_id=o.id AND p.attempt=1 WHERE q.event_type='payment.query' AND q.aggregate_kind='order' AND o.state='pending' AND o.expires_at<=$1 AND q.available_at<=$1 ORDER BY q.available_at,o.expires_at,o.id LIMIT $2 FOR UPDATE OF q SKIP LOCKED",
          [now, limit],
        )
      ).rows;
      // Commit the retry schedule before any external query or snapshot read.
      // A crash, unknown result, or malformed order must yield to unvisited rows.
      if (rows.length)
        await tx.query(
          "UPDATE outbox SET available_at=$2 WHERE id=ANY($1::text[])",
          [rows.map((row) => row.query_id), new Date(now.getTime() + 30000)],
        );
      return rows;
    });
    for (const row of due) {
      try {
        const request: PaymentRequest = {
          orderId: row.id,
          providerRequestId: row.provider_request_id,
          snapshot: await this.options.db.transaction((tx) =>
            frozenOrderSnapshot(tx, row.id, row.workspace_id),
          ),
        };
        await this.queryRequest(request);
      } catch {
        /* This order remains scheduled; continue the independently claimed batch. */
      }
    }
    return { queried: due.length };
  }
}
