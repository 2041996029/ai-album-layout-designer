import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { id, type Actor } from "@album/server-core";
import { testDatabase } from "../../test/database";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
import { LocalSignedPaymentAdapter, PaymentAdapters } from "./adapters";
import {
  OrderService,
  PublishedOrderCatalog,
  frozenOrderSnapshot,
} from "./orders";
import type { ConfigRelease } from "../config/types";
import { PaymentConfirmation } from "./confirm";
import type { OrderSnapshot, PaymentEvent } from "./types";

const secret = "development-payment-signing-secret-32-bytes";
const epoch = new Date("2026-10-24T12:00:00Z");
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "C4 verified payment facts (PostgreSQL)",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>;
    let actor: Actor, wid: string, sku: string, secondSku: string;
    let clock: Date, snapshot: OrderSnapshot, adapters: PaymentAdapters;
    let adapter: LocalSignedPaymentAdapter,
      orders: OrderService,
      confirmation: PaymentConfirmation;
    let failFulfillment = false;
    const facts = new Map<string, PaymentEvent | null>();
    const calls: string[] = [];
    beforeAll(async () => {
      db = await testDatabase();
      const auth = new AuthService(db.database, { secret, environment: "dev" });
      actor = (
        await auth.login(
          {
            exchange: async () => ({
              provider: "wechat",
              appId: "test-app",
              subject: "payment-owner",
              unionId: null,
              openPlatformId: null,
            }),
          },
          "owner-code",
          "web",
        )
      ).actor;
      wid = (
        await new WorkspaceService(db.database, auth).createWorkspace(
          actor,
          "personal",
          "workspace",
        )
      ).workspaceId;
      sku = id();
      secondSku = id();
      await db.database.transaction(async (tx) => {
        const billing = id();
        await tx.query(
          "INSERT INTO billing_skus(id,code,name,state) VALUES($1,$2,'Test published SKU','active')",
          [billing, billing],
        );
        for (const [index, version] of [sku, secondSku].entries())
          await tx.query(
            "INSERT INTO sku_versions(id,sku_id,version,price_fen,duration_days,credit_grant,features) VALUES($1,$2,$3,100,30,20,'{}')",
            [version, billing, index + 1],
          );
        await tx.query(
          "CREATE TABLE payment_test_fulfillments(order_id text PRIMARY KEY REFERENCES orders(id), txid bigint NOT NULL)",
        );
      });
      orders = new OrderService({
        db: db.database,
        workspaces: new WorkspaceService(db.database, auth),
        adapters: undefined as never,
        catalog: undefined as never,
        now: () => clock,
      });
    }, 60000);
    afterAll(async () => {
      await db?.close();
    });
    beforeEach(async () => {
      clock = new Date(epoch);
      facts.clear();
      calls.length = 0;
      failFulfillment = false;
      snapshot = {
        releaseId: id(),
        skuVersionId: sku,
        sku: {
          kind: "sku",
          skuId: "test-sku",
          skuKind: "membership",
          name: "Published",
          priceFen: 100,
          currency: "CNY",
          durationDays: 30,
          credits: 20,
          creditValidityDays: 30,
          features: {
            storageBytes: 1000,
            maxProjectPhotos: 500,
            maxSpreads: 50,
            exportDpis: [72],
            exportConcurrency: 1,
            aiConcurrency: 1,
            seatLimit: 1,
            commercialTemplateSetIds: [],
          },
          refundPolicyRef: { id: "refund", version: 1 },
          enabled: true,
        },
        bindingId: id(),
        payment: {
          kind: "payment",
          channel: "wechat_pay",
          appId: "app",
          merchantId: "merchant",
          credential: { secretRef: "secret", secretVersion: "v1" },
          verificationKeyRef: "verify",
          callbackUrl: "https://callback.example",
          refundEnabled: true,
          platformCapabilityRef: { id: "capability", version: 1 },
          enabled: true,
        },
        productId: "product",
        refundPolicy: { id: "refund", version: 1 },
      };
      await db.database.transaction(async (tx) => {
        const releaseNumber = Number(
          (
            await tx.query(
              "SELECT coalesce(max(release_number),0)+1 AS n FROM config_releases WHERE environment='dev'",
            )
          ).rows[0].n,
        );
        await tx.query(
          "INSERT INTO config_releases(id,environment,release_number,schema_version,manifest_hash,manifest,published_by) VALUES($1,'dev',$2,1,$3,$5,$4)",
          [
            snapshot.releaseId,
            releaseNumber,
            "a".repeat(64),
            actor.userId,
            { versions: { payment: { id: snapshot.bindingId } } },
          ],
        );
        await tx.query(
          "INSERT INTO config_release_items(id,release_id,namespace,schema_version,body_hash,body) VALUES($1,$2,'payment',1,$3,$4)",
          [id(), snapshot.releaseId, "a".repeat(64), snapshot.payment],
        );
      });
      adapter = new LocalSignedPaymentAdapter({
        environment: "dev",
        channel: "wechat_pay",
        secret,
        now: () => clock,
        transport: {
          create: async (order) => {
            calls.push(`create:${order.orderId}:${order.providerRequestId}`);
            return { clientPayload: { orderId: order.orderId } };
          },
          query: async (orderId) => {
            calls.push(`query:${orderId}`);
            return facts.get(orderId) ?? null;
          },
          close: async (orderId) => {
            calls.push(`close:${orderId}`);
            return facts.get(orderId) ?? null;
          },
        },
      });
      adapters = new PaymentAdapters("dev");
      adapters.register(snapshot.bindingId, adapter, { approved: true });
      confirmation = new PaymentConfirmation(
        db.database,
        adapters,
        async (tx, orderId) => {
          await tx.query(
            "INSERT INTO payment_test_fulfillments VALUES($1,txid_current())",
            [orderId],
          );
          if (failFulfillment) throw Error("FULFILLMENT_TEMPORARY_FAILURE");
        },
      );
      orders = new OrderService({
        db: db.database,
        workspaces: orders.options.workspaces,
        adapters,
        catalog: {
          resolve: async (_tx, version, channel, client) => {
            if (channel !== "wechat_pay" || client !== "web")
              throw Error("PAYMENT_UNCONFIGURED");
            return structuredClone({ ...snapshot, skuVersionId: version });
          },
        },
        now: () => clock,
        confirmation,
      });
    });
    async function create() {
      return orders.createOrder(actor, wid, sku, "wechat_pay", id());
    }
    function paid(
      orderId: string,
      changes: Partial<PaymentEvent> = {},
    ): PaymentEvent {
      return {
        channel: "wechat_pay",
        eventId: `event-${orderId}`,
        transactionId: `tx-${orderId}`,
        orderId,
        appId: "app",
        merchantId: "merchant",
        amountFen: 100,
        currency: "CNY",
        state: "paid",
        fulfillable: true,
        productId: "product",
        ...changes,
      };
    }
    async function verified(event: PaymentEvent) {
      const raw = Buffer.from(JSON.stringify(event));
      const timestamp = String(clock.getTime());
      const signature = createHmac("sha256", secret)
        .update(timestamp)
        .update(".")
        .update(raw)
        .digest("hex");
      return adapters.verify(snapshot.bindingId, raw, {
        "x-payment-timestamp": timestamp,
        "x-payment-signature": signature,
      });
    }
    async function row(orderId: string) {
      return (
        await db.pool.query("SELECT * FROM ai_album.orders WHERE id=$1", [
          orderId,
        ])
      ).rows[0];
    }
    async function count(orderId: string) {
      return Number(
        (
          await db.pool.query(
            "SELECT count(*) FROM ai_album.payment_test_fulfillments WHERE order_id=$1",
            [orderId],
          )
        ).rows[0].count,
      );
    }
    it("fairly recovers more than a batch after lost outbox rows, isolates bad snapshots, and revisits unknowns after restart", async () => {
      const early: string[] = [];
      for (let index = 0; index < 3; index++) {
        clock = new Date(epoch.getTime() + index * 1000);
        early.push((await create()).orderId);
      }
      const missingSnapshot = id();
      await db.database.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO orders(id,created_at,workspace_id,sku_version_id,buyer_user_id,amount_fen,channel,client_platform,expires_at) VALUES($1,$2,$3,$4,$5,100,'wechat_pay','web',$6)",
          [
            missingSnapshot,
            new Date(epoch.getTime() + 3000),
            wid,
            sku,
            actor.userId,
            new Date(epoch.getTime() + 303000),
          ],
        );
        await tx.query(
          "INSERT INTO payment_attempts(id,workspace_id,order_id,attempt,channel,merchant_account_ref,provider_request_id,amount_fen) VALUES($1,$2,$3,1,'wechat_pay','merchant',$4,100)",
          [id(), wid, missingSnapshot, missingSnapshot],
        );
      });
      clock = new Date(epoch.getTime() + 4000);
      const late = await create();
      facts.set(late.orderId, paid(late.orderId));
      const query = adapter.options.transport.query;
      adapter.options.transport.query = async (orderId, request) => {
        if (orderId === early[1]) {
          calls.push(`query:${orderId}`);
          throw Error("PROVIDER_QUERY_UNKNOWN");
        }
        return query(orderId, request);
      };
      await db.pool.query(
        "DELETE FROM ai_album.outbox WHERE event_type='payment.query' AND aggregate_id=ANY($1::text[])",
        [[...early, missingSnapshot, late.orderId]],
      );
      clock = new Date(epoch.getTime() + 600000);
      // Each invocation has a fresh service instance: fairness must survive process loss.
      for (let index = 0; index < 4; index++)
        await new OrderService(orders.options).reconcileDue(2);
      expect((await row(late.orderId)).state).toBe("paid");
      expect(await count(late.orderId)).toBe(1);
      expect(calls.filter((call) => call === `query:${early[0]}`)).toHaveLength(
        1,
      );
      expect(calls.filter((call) => call === `query:${early[1]}`)).toHaveLength(
        1,
      );
      expect((await row(missingSnapshot)).state).toBe("pending");
      clock = new Date(clock.getTime() + 30001);
      for (let index = 0; index < 3; index++)
        await new OrderService(orders.options).reconcileDue(2);
      expect(calls.filter((call) => call === `query:${early[0]}`)).toHaveLength(
        2,
      );
      expect(calls.filter((call) => call === `query:${early[1]}`)).toHaveLength(
        2,
      );
      expect(await count(late.orderId)).toBe(1);
    });
    it("replays 100 verified callbacks and concurrent authenticated query once in one SQL transaction", async () => {
      const order = await create();
      const event = paid(order.orderId);
      facts.set(order.orderId, event);
      const callback = await verified(event);
      await Promise.all([
        ...Array.from({ length: 100 }, () =>
          confirmation.confirmPayment(callback),
        ),
        orders.queryOrder(actor, wid, order.orderId),
      ]);
      expect(await count(order.orderId)).toBe(1);
      expect(await row(order.orderId)).toMatchObject({
        state: "paid",
        fulfillment_state: "fulfilled",
      });
      const ledger = await db.pool.query(
        "SELECT p.txid = e.xmin::text::bigint AS same_tx FROM ai_album.payment_test_fulfillments p JOIN ai_album.payment_events e ON e.redacted_event->>'orderId'=p.order_id WHERE p.order_id=$1",
        [order.orderId],
      );
      expect(ledger.rows.every((r) => r.same_tx)).toBe(true);
    });
    it.each([
      { amountFen: 99 },
      { appId: "wrong-app" },
      { merchantId: "wrong-merchant" },
      { productId: "wrong-product" },
      { currency: "USD" as "CNY" },
      { channel: "wechat_virtual" as const },
    ])(
      "rejects mismatched signed facts %j without any fulfillment",
      async (changes) => {
        const order = await create();
        await expect(
          verified(paid(order.orderId, changes)).then((e) =>
            confirmation.confirmPayment(e),
          ),
        ).rejects.toThrow(/PAYMENT_(MISMATCH|INVALID_EVENT)/);
        expect(await count(order.orderId)).toBe(0);
        expect((await row(order.orderId)).state).toBe("pending");
      },
    );
    it("does not trust client success or normalization or an edited verified event", async () => {
      const order = await create();
      await expect(
        confirmation.confirmPayment(paid(order.orderId)),
      ).rejects.toThrow("PAYMENT_UNVERIFIED");
      await expect(
        confirmation.confirmPayment(
          adapter.normalizeStatus(paid(order.orderId)),
        ),
      ).rejects.toThrow("PAYMENT_UNVERIFIED");
      expect((await row(order.orderId)).state).toBe("pending");
      const result = await orders.queryOrder(actor, wid, order.orderId);
      expect(result.state).toBe("pending");
      const e = await verified(paid(order.orderId));
      await expect(
        confirmation.confirmPayment({ ...e, amountFen: 1 }),
      ).rejects.toThrow("PAYMENT_UNVERIFIED");
    });
    it("verifies the raw bytes and freshness before parsing", async () => {
      await expect(
        adapters.verify(snapshot.bindingId, Buffer.from("not json"), {}),
      ).rejects.toThrow("PAYMENT_BAD_SIGNATURE");
      const order = await create();
      const raw = Buffer.from(JSON.stringify(paid(order.orderId)));
      const timestamp = String(epoch.getTime() - 300001);
      const signature = createHmac("sha256", secret)
        .update(timestamp)
        .update(".")
        .update(raw)
        .digest("hex");
      await expect(
        adapters.verify(snapshot.bindingId, raw, {
          "x-payment-timestamp": timestamp,
          "x-payment-signature": signature,
        }),
      ).rejects.toThrow("PAYMENT_BAD_SIGNATURE");
      await expect(
        adapters.verify(
          snapshot.bindingId,
          Buffer.concat([raw, Buffer.from(" ")]),
          {
            "x-payment-timestamp": String(epoch.getTime()),
            "x-payment-signature": signature,
          },
        ),
      ).rejects.toThrow("PAYMENT_BAD_SIGNATURE");
    });
    it("rolls back event, paid state, and SQL fulfillment together and retries", async () => {
      const order = await create();
      const event = await verified(paid(order.orderId));
      failFulfillment = true;
      await expect(confirmation.confirmPayment(event)).rejects.toThrow(
        "FULFILLMENT_TEMPORARY_FAILURE",
      );
      expect(await count(order.orderId)).toBe(0);
      expect((await row(order.orderId)).state).toBe("pending");
      expect(
        (
          await db.pool.query(
            "SELECT * FROM ai_album.payment_events WHERE provider_event_id=$1",
            [event.eventId],
          )
        ).rows,
      ).toHaveLength(0);
      failFulfillment = false;
      await confirmation.confirmPayment(event);
      expect(await count(order.orderId)).toBe(1);
    });
    it("rejects event and transaction rebinding across orders and changed replay bodies", async () => {
      const a = await create(),
        b = await create();
      const event = paid(a.orderId);
      await confirmation.confirmPayment(await verified(event));
      await expect(
        confirmation.confirmPayment(
          await verified(paid(b.orderId, { eventId: event.eventId })),
        ),
      ).rejects.toThrow("PAYMENT_MISMATCH");
      await expect(
        confirmation.confirmPayment(
          await verified(
            paid(b.orderId, { transactionId: event.transactionId }),
          ),
        ),
      ).rejects.toThrow("PAYMENT_MISMATCH");
      await expect(
        confirmation.confirmPayment(
          await verified({ ...event, fulfillable: false }),
        ),
      ).rejects.toThrow("PAYMENT_MISMATCH");
      expect(await count(b.orderId)).toBe(0);
    });
    it("freezes server price and bindings across release refresh and replays creation without resubmitting", async () => {
      const key = id();
      const a = await orders.createOrder(actor, wid, sku, "wechat_pay", key);
      snapshot.sku.priceFen = 999;
      snapshot.payment.appId = "new-app";
      const b = await orders.createOrder(actor, wid, sku, "wechat_pay", key);
      expect(b).toEqual(a);
      expect(calls.filter((c) => c.startsWith("create:"))).toHaveLength(1);
      await confirmation.confirmPayment(await verified(paid(a.orderId)));
      expect(await count(a.orderId)).toBe(1);
      await expect(
        orders.createOrder(actor, wid, secondSku, "wechat_pay", key),
      ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
      const record = (
        await db.pool.query(
          "SELECT * FROM ai_album.idempotency_keys WHERE workspace_id=$1 AND idempotency_key=$2",
          [wid, key],
        )
      ).rows[0];
      expect(record.principal_scope).toBe("workspace");
      expect(record.resource_id).toBe(a.orderId);
    });
    it("keeps a stable attempt after external create ambiguity and never resubmits", async () => {
      adapter.options.transport.create = async () => {
        calls.push("ambiguous-create");
        throw Error("NETWORK_UNKNOWN");
      };
      const key = id();
      const a = await orders.createOrder(actor, wid, sku, "wechat_pay", key);
      const b = await orders.createOrder(actor, wid, sku, "wechat_pay", key);
      expect(a.orderId).toBe(b.orderId);
      expect(a.clientPayload).toBeUndefined();
      expect(calls.filter((c) => c === "ambiguous-create")).toHaveLength(1);
      expect(
        (
          await db.pool.query(
            "SELECT state FROM ai_album.payment_attempts WHERE order_id=$1",
            [a.orderId],
          )
        ).rows[0].state,
      ).toBe("unknown");
    });
    it("rejects unavailable mini eligibility without payload or order and never enables simulator in production", async () => {
      await expect(
        orders.createOrder(actor, wid, sku, "wechat_virtual", id()),
      ).rejects.toThrow("PAYMENT_UNCONFIGURED");
      expect(adapters.capability("missing")).toEqual({ state: "unconfigured" });
      expect(
        () =>
          new LocalSignedPaymentAdapter({
            ...adapter.options,
            environment: "prod",
          }),
      ).toThrow("LOCAL_PAYMENT_DEV_ONLY");
      expect(() =>
        new PaymentAdapters("prod").register("sim", adapter, {
          approved: true,
        }),
      ).toThrow("LOCAL_PAYMENT_DEV_ONLY");
    });
    it("queries unknown payments after five minutes with persistent stable scheduling", async () => {
      const order = await create();
      clock = new Date(epoch.getTime() + 300001);
      await orders.reconcileDue();
      expect(calls).toContain(`query:${order.orderId}`);
      expect((await row(order.orderId)).state).toBe("pending");
      facts.set(
        order.orderId,
        paid(order.orderId, { eventId: `query-paid-${order.orderId}` }),
      );
      clock = new Date(clock.getTime() + 30001);
      await orders.reconcileDue();
      expect((await row(order.orderId)).state).toBe("paid");
      expect(await count(order.orderId)).toBe(1);
    });
    it("queries before close and preserves late captured money in manual review", async () => {
      const order = await create();
      facts.set(order.orderId, paid(order.orderId));
      await orders.closeOrder(actor, wid, order.orderId);
      expect(calls.filter((c) => c.startsWith("close:"))).toHaveLength(0);
      const b = await create();
      facts.set(b.orderId, null);
      await orders.closeOrder(actor, wid, b.orderId);
      expect((await row(b.orderId)).state).toBe("pending");
      const closed = paid(b.orderId, {
        state: "closed",
        eventId: `closed-${b.orderId}`,
      });
      await confirmation.confirmPayment(await verified(closed));
      await confirmation.confirmPayment(await verified(paid(b.orderId)));
      expect(await row(b.orderId)).toMatchObject({
        state: "paid",
        fulfillment_state: "manual_review",
      });
      expect(await count(b.orderId)).toBe(0);
      await confirmation.confirmPayment(
        await verified({ ...closed, eventId: `closed-again-${b.orderId}` }),
      );
      expect((await row(b.orderId)).state).toBe("paid");
    });
    it("retains verified nonfulfillable receipt for review without grants", async () => {
      const order = await create();
      await confirmation.confirmPayment(
        await verified(paid(order.orderId, { fulfillable: false })),
      );
      expect(await row(order.orderId)).toMatchObject({
        state: "paid",
        fulfillment_state: "manual_review",
      });
      expect(await count(order.orderId)).toBe(0);
    });
    it("keeps immutable business snapshot after idempotency cleanup and rejects mismatched insertion", async () => {
      const order = await create();
      await db.pool.query(
        "DELETE FROM ai_album.idempotency_keys WHERE workspace_id=$1 AND resource_id=$2",
        [wid, order.orderId],
      );
      const frozen = await db.database.transaction((tx) =>
        frozenOrderSnapshot(tx, order.orderId, wid),
      );
      expect(frozen.payment.appId).toBe("app");
      await expect(
        db.pool.query(
          "UPDATE ai_album.order_snapshots SET snapshot_hash=$2 WHERE order_id=$1",
          [order.orderId, "b".repeat(64)],
        ),
      ).rejects.toThrow(/append-only/i);
      const other = await create();
      // The new row must pass the SQL guard before the duplicate primary key check.
      await expect(
        db.pool.query(
          "INSERT INTO ai_album.order_snapshots SELECT order_id,workspace_id,release_id,payment_config_id,snapshot_hash,jsonb_set(snapshot,'{sku,priceFen}','1') FROM ai_album.order_snapshots WHERE order_id=$1",
          [other.orderId],
        ),
      ).rejects.toThrow("order snapshot does not match");
      await confirmation.confirmPayment(await verified(paid(order.orderId)));
      expect(await count(order.orderId)).toBe(1);
    });
    it("reads immutable SQL SKU and published typed release with independent approved admission", async () => {
      const publishedSku = structuredClone(snapshot.sku);
      publishedSku.skuId = id();
      const version = id();
      await db.database.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO billing_skus(id,code,name,state) VALUES($1,$2,'Published','active')",
          [publishedSku.skuId, publishedSku.skuId],
        );
        await tx.query(
          "INSERT INTO sku_versions(id,sku_id,version,price_fen,duration_days,credit_grant,features) VALUES($1,$2,1,100,30,20,$3)",
          [version, publishedSku.skuId, { publishedSku }],
        );
      });
      const release: ConfigRelease = {
        releaseId: snapshot.releaseId,
        effectiveAt: epoch.toISOString(),
        versionIds: ["sku-config", snapshot.bindingId],
        versions: {
          sku: {
            id: "sku-config",
            namespace: "sku",
            version: 1,
            environment: "dev",
            payload: publishedSku,
            revision: 1,
            state: "published",
            payloadHash: "a".repeat(64),
          },
          payment: {
            id: snapshot.bindingId,
            namespace: "payment",
            version: 1,
            environment: "dev",
            payload: snapshot.payment,
            revision: 1,
            state: "published",
            payloadHash: "a".repeat(64),
          },
        },
      };
      const catalog = new PublishedOrderCatalog(async () => release, {
        admit: async () => ({
          productId: "approved-product",
          refundPolicy: { id: "refund", version: 1 },
        }),
      });
      const resolved = await db.database.transaction((tx) =>
        catalog.resolve(tx, version, "wechat_pay", "web"),
      );
      expect(resolved.sku.priceFen).toBe(100);
      expect(resolved.productId).toBe("approved-product");
      await expect(
        db.database.transaction((tx) =>
          catalog.resolve(tx, version, "wechat_virtual", "mini"),
        ),
      ).rejects.toThrow("PAYMENT_UNCONFIGURED");
      release.versions.sku.payload = { ...publishedSku, priceFen: 101 };
      await expect(
        db.database.transaction((tx) =>
          catalog.resolve(tx, version, "wechat_pay", "web"),
        ),
      ).rejects.toThrow("SKU_UNPUBLISHED");
    });
  },
);
