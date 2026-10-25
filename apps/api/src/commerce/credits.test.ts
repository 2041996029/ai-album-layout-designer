import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { id, type Actor } from "@album/server-core";
import { createJob, JobRepository } from "@album/jobs";
import type { PoolClient } from "pg";
import { testDatabase } from "../../test/database";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
import {
  payloadHash,
  type ConfigPayload,
  type ConfigRelease,
} from "../config/types";
import type { PublishedSku, OrderSnapshot } from "../payments/types";
import {
  LocalSignedPaymentAdapter,
  PaymentAdapters,
} from "../payments/adapters";
import { PaymentConfirmation } from "../payments/confirm";
import { CreditService } from "./credits";
import { EntitlementService } from "./entitlements";
import { OrderFulfillment, PublishedSkuMaterializer } from "./fulfillment";
const hash = "a".repeat(64),
  epoch = new Date();
const features: PublishedSku["features"] = {
  storageBytes: 1000000,
  maxProjectPhotos: 500,
  maxSpreads: 50,
  exportDpis: [72, 150, 300],
  exportConcurrency: 2,
  aiConcurrency: 1,
  seatLimit: 1,
  commercialTemplateSetIds: [],
};
const free: Extract<ConfigPayload, { kind: "workspace" }> = {
  kind: "workspace",
  defaultFeatures: {
    ...features,
    storageBytes: 1234,
    maxProjectPhotos: 23,
    exportDpis: [72],
    exportConcurrency: 1,
  },
  roles: ["owner", "admin", "designer", "viewer"],
  designerCanDeleteUnusedAssets: false,
  seatInvitationEnabled: false,
  byosEnabled: false,
  byokEnabled: false,
};
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "C4 membership and atomic credit lots (PostgreSQL)",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      actor: Actor,
      wid: string,
      clock: Date,
      credits: CreditService,
      fulfillment: OrderFulfillment;
    let release: ConfigRelease,
      provider: string,
      model: string,
      route: string,
      cost: string;
    const rows = (sql: string, args: unknown[] = []) =>
      db.database.transaction(async (tx) => (await tx.query(sql, args)).rows);
    const transaction = <T>(f: (tx: PoolClient) => Promise<T>) =>
      db.database.transaction(f);
    const sku = (changes: Partial<PublishedSku> = {}): PublishedSku => ({
      kind: "sku",
      skuId: "member",
      skuKind: "membership",
      name: "Actual published membership",
      priceFen: 123,
      currency: "CNY",
      durationDays: 30,
      credits: 20,
      creditValidityDays: 30,
      features,
      refundPolicyRef: { id: "refund", version: 1 },
      enabled: true,
      ...changes,
    });
    async function publication(product = sku(), versionId = id()) {
      const releaseId = id(),
        paymentId = id(),
        itemId = id();
      const payment: OrderSnapshot["payment"] = {
        kind: "payment",
        channel: "wechat_pay",
        appId: "app",
        merchantId: "merchant",
        credential: { secretRef: "test-only", secretVersion: "v1" },
        verificationKeyRef: "verify",
        callbackUrl: "https://local.invalid/callback",
        refundEnabled: true,
        platformCapabilityRef: { id: "capability", version: 1 },
        enabled: true,
      };
      await transaction(async (tx) => {
        await tx.query(
          "INSERT INTO config_releases(id,environment,release_number,schema_version,manifest_hash,manifest,published_by) VALUES($1,'dev',(SELECT coalesce(max(release_number),0)+1 FROM config_releases),1,$2,$3,$4)",
          [
            releaseId,
            hash,
            {
              versions: { sku: { id: versionId }, payment: { id: paymentId } },
            },
            actor.userId,
          ],
        );
        await tx.query(
          "INSERT INTO config_release_items(id,release_id,namespace,schema_version,body_hash,body) VALUES($1,$2,'sku',1,$3,$4),($5,$2,'payment',1,$3,$6)",
          [id(), releaseId, hash, product, itemId, payment],
        );
      });
      return {
        input: {
          releaseId,
          skuConfigVersionId: versionId,
          sku: product,
          refundPolicy: { id: "refund", version: 1 },
        },
        payment,
        paymentId,
        itemId,
      };
    }
    async function order(product = sku(), paid = true) {
      const pub = await publication(product);
      const version = await transaction((tx) =>
        new PublishedSkuMaterializer().materialize(tx, pub.input),
      );
      const orderId = id(),
        snapshot: OrderSnapshot = {
          releaseId: pub.input.releaseId,
          skuVersionId: version.skuVersionId,
          bindingId: pub.paymentId,
          sku: product,
          payment: pub.payment,
          refundPolicy: pub.input.refundPolicy,
        };
      await transaction(async (tx) => {
        await tx.query(
          "INSERT INTO orders(id,workspace_id,sku_version_id,buyer_user_id,amount_fen,state,channel,client_platform,expires_at) VALUES($1,$2,$3,$4,$5,$6,'wechat_pay','web',clock_timestamp()+interval '1 hour')",
          [
            orderId,
            wid,
            version.skuVersionId,
            actor.userId,
            product.priceFen,
            paid ? "paid" : "pending",
          ],
        );
        await tx.query(
          "INSERT INTO order_snapshots VALUES($1,$2,$3,$4,$5,$6)",
          [
            orderId,
            wid,
            pub.input.releaseId,
            pub.itemId,
            payloadHash(snapshot),
            snapshot,
          ],
        );
      });
      return orderId;
    }
    async function grant(product = sku()) {
      const oid = await order(product);
      await transaction((tx) => fulfillment.fulfillOrder(tx, oid));
      return oid;
    }
    async function job(points = 20) {
      return transaction(async (tx) => {
        const consent = id(),
          quote = id(),
          snapshot = id(),
          releaseId = (await tx.query("SELECT id FROM config_releases LIMIT 1"))
            .rows[0].id;
        await tx.query(
          "INSERT INTO generation_consents(id,workspace_id,user_id,policy_version,purpose,consented_at,input_hash) VALUES($1,$2,$3,'v1','test',clock_timestamp(),$4)",
          [consent, wid, actor.userId, hash],
        );
        await tx.query(
          "INSERT INTO generation_quotes(id,workspace_id,config_release_id,route_version_id,model_version_id,provider_version_id,cost_rule_version_id,consent_id,input_hash,credit_cost,estimated_cost_fen,max_cost_fen,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,1,1,now()+interval '5 minutes')",
          [
            quote,
            wid,
            releaseId,
            route,
            model,
            provider,
            cost,
            consent,
            hash,
            points,
          ],
        );
        await tx.query(
          "INSERT INTO job_snapshots(id,workspace_id,kind,quote_id,config_release_id,schema_version,normalized_spec_hash,manifest_hash,manifest,entitlement_snapshot,warnings_acknowledged) VALUES($1,$2,'generation',$3,$4,1,$5,$5,'{}','{}','[]')",
          [snapshot, wid, quote, releaseId, hash],
        );
        return createJob(
          tx,
          {
            workspaceId: wid,
            kind: "generation",
            configReleaseId: releaseId,
            inputHash: hash,
            payload: {},
            createdBy: actor.userId,
            snapshotId: snapshot,
            quoteId: quote,
          },
          id(),
        );
      });
    }
    const reserve = async (points = 20) => {
      const j = await job(points);
      return transaction((tx) =>
        credits.reserveCredits(tx, wid, j.jobId, points),
      );
    };
    beforeAll(async () => {
      db = await testDatabase();
      const auth = new AuthService(db.database, {
        secret: "test-only-secret-for-credit-32-bytes",
        environment: "dev",
      });
      actor = (
        await auth.login(
          {
            exchange: async () => ({
              provider: "wechat",
              appId: "test",
              subject: "credits-owner",
              unionId: null,
              openPlatformId: null,
            }),
          },
          "code",
          "web",
        )
      ).actor;
      await transaction(async (tx) => {
        const account = id(),
          connection = id(),
          secret = id(),
          license = id(),
          report = id(),
          modelId = id(),
          routeId = id();
        provider = id();
        model = id();
        route = id();
        cost = id();
        await tx.query(
          "INSERT INTO ai_billing_accounts(id,environment,account_billing_id,provider_name,daily_budget_fen) VALUES($1,'dev',$1,'local-contract',100)",
          [account],
        );
        await tx.query(
          "INSERT INTO ai_provider_connections(id,environment,billing_account_id,name) VALUES($1,'dev',$2,'local')",
          [connection, account],
        );
        await tx.query(
          "INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose) VALUES($1,'dev','test-only','v1','test')",
          [secret],
        );
        await tx.query(
          "INSERT INTO ai_provider_versions(id,connection_id,billing_account_id,environment,version,adapter_id,adapter_version,base_url,secret_reference_id,auth_mode,max_concurrent,requests_per_minute,daily_budget_fen,allowed_data_use,capabilities) VALUES($1,$2,$3,'dev',1,'local','v1','https://local.invalid',$4,'bearer',1,1,100,'{}','{}')",
          [provider, connection, account, secret],
        );
        await tx.query(
          "INSERT INTO license_versions(id,license_key,version,source_uri,terms_hash,commercial_allowed,valid_from,territories) VALUES($1,'local',1,'https://local.invalid',$2,true,clock_timestamp(),ARRAY['CN'])",
          [license, hash],
        );
        await tx.query(
          "INSERT INTO config_tests(id,environment,subject_kind,subject_id,subject_hash,test_kind,state,report,executed_by) VALUES($1,'dev','model',$2,$3,'capability','passed','{}',$4)",
          [report, model, hash, actor.userId],
        );
        await tx.query("INSERT INTO ai_models(id,name) VALUES($1,'local')", [
          modelId,
        ]);
        await tx.query(
          "INSERT INTO ai_model_versions(id,model_id,version,provider_version_id,provider_model_id,provider_model_version,license_version_id,input_schema_version,output_schema_version,capabilities,parameter_schema,limits_json,moderation_policy_ref,label_policy_ref,test_report_id) VALUES($1,$2,1,$3,'local','v1',$4,1,1,'{}','{}','{}','local','local',$5)",
          [model, modelId, provider, license, report],
        );
        await tx.query(
          "INSERT INTO ai_routes(id,capability,name) VALUES($1,'textToImage','local')",
          [routeId],
        );
        await tx.query(
          "INSERT INTO ai_route_versions(id,route_id,version,primary_model_version_id) VALUES($1,$2,1,$3)",
          [route, routeId, model],
        );
        await tx.query(
          "INSERT INTO cost_rule_versions(id,rule_key,version,credit_cost,estimated_cost_fen,max_cost_fen,parameters) VALUES($1,'test',1,20,1,1,'{}')",
          [cost],
        );
      });
    }, 60000);
    afterAll(async () => {
      await db?.close();
    });
    beforeEach(async () => {
      clock = new Date(epoch);
      credits = new CreditService(db.database, () => clock);
      fulfillment = new OrderFulfillment(() => clock);
      wid = (
        await new WorkspaceService(
          db.database,
          new AuthService(db.database, {
            secret: "test-only-secret-for-credit-32-bytes",
            environment: "dev",
          }),
        ).createWorkspace(actor, "studio", id(), "credit test")
      ).workspaceId;
      release = {
        releaseId: id(),
        versionIds: ["free"],
        effectiveAt: clock.toISOString(),
        versions: {
          workspace: {
            id: "free",
            namespace: "workspace",
            version: 1,
            environment: "dev",
            payload: free,
            revision: 1,
            state: "published",
            payloadHash: payloadHash(free),
          },
        },
      };
    });
    it("materializes published SKU once, reuses immutable config version across releases and rejects tampering", async () => {
      const pub = await publication();
      const materializer = new PublishedSkuMaterializer();
      const a = await transaction((tx) =>
        materializer.materialize(tx, pub.input),
      );
      expect(
        await transaction((tx) => materializer.materialize(tx, pub.input)),
      ).toEqual(a);
      const next = await publication(
        pub.input.sku,
        pub.input.skuConfigVersionId,
      );
      expect(
        await transaction((tx) => materializer.materialize(tx, next.input)),
      ).toEqual(a);
      await expect(
        transaction((tx) =>
          materializer.materialize(tx, {
            ...pub.input,
            sku: { ...pub.input.sku, priceFen: 999 },
          }),
        ),
      ).rejects.toThrow();
      expect(
        (
          await rows("SELECT * FROM sku_versions WHERE id=$1", [a.skuVersionId])
        )[0].features,
      ).toEqual({
        releaseId: pub.input.releaseId,
        skuConfigVersionId: pub.input.skuConfigVersionId,
        refundPolicy: pub.input.refundPolicy,
        publishedSku: pub.input.sku,
      });
    });
    it("rejects disabled and absent published SKUs", async () => {
      const pub = await publication(sku({ enabled: false }));
      await expect(
        transaction((tx) =>
          new PublishedSkuMaterializer().materialize(tx, pub.input),
        ),
      ).rejects.toThrow();
      await expect(
        transaction((tx) =>
          new PublishedSkuMaterializer().materialize(tx, {
            ...pub.input,
            sku: sku(),
            releaseId: id(),
          }),
        ),
      ).rejects.toThrow();
    });
    it("grants frozen facts once under 100 concurrent fulfillments and uses caller rollback", async () => {
      const oid = await order();
      await expect(
        transaction(async (tx) => {
          await fulfillment.fulfillOrder(tx, oid);
          throw Error("rollback");
        }),
      ).rejects.toThrow("rollback");
      expect(
        await rows(
          "SELECT * FROM entitlement_grants WHERE source_order_id=$1",
          [oid],
        ),
      ).toHaveLength(0);
      await Promise.all(
        Array.from({ length: 100 }, () =>
          transaction((tx) => fulfillment.fulfillOrder(tx, oid)),
        ),
      );
      expect(
        await rows(
          "SELECT * FROM entitlement_grants WHERE source_order_id=$1",
          [oid],
        ),
      ).toHaveLength(2);
      expect(
        await rows(
          "SELECT * FROM credit_ledger WHERE workspace_id=$1 AND entry_type='grant'",
          [wid],
        ),
      ).toHaveLength(1);
      expect(await credits.creditBalance(wid, clock.toISOString())).toEqual({
        available: 20,
        reserved: 0,
        frozen: 0,
        expired: 0,
      });
    });
    it("refuses unpaid orders", async () => {
      const oid = await order(sku(), false);
      await expect(
        transaction((tx) => fulfillment.fulfillOrder(tx, oid)),
      ).rejects.toThrow();
      expect(
        await rows(
          "SELECT * FROM entitlement_grants WHERE source_order_id=$1",
          [oid],
        ),
      ).toHaveLength(0);
    });
    it("stacks real days for same tier and flags cross-tier without affecting other grants", async () => {
      const first = await grant(),
        second = await grant(sku({ skuId: "annual", durationDays: 365 }));
      const grants = await rows(
        "SELECT * FROM entitlement_grants WHERE workspace_id=$1 AND grant_type='membership' ORDER BY starts_at",
        [wid],
      );
      expect(grants[1].starts_at).toEqual(grants[0].ends_at);
      expect(+grants[0].ends_at - +grants[0].starts_at).toBe(30 * 86400000);
      const other = await order(
        sku({
          skuId: "other",
          features: { ...features, storageBytes: 2000000 },
        }),
      );
      await transaction((tx) => fulfillment.fulfillOrder(tx, other));
      expect(
        (
          await rows("SELECT fulfillment_state FROM orders WHERE id=$1", [
            other,
          ])
        )[0].fulfillment_state,
      ).toBe("manual_review");
      expect(
        await rows(
          "SELECT * FROM entitlement_grants WHERE source_order_id=$1",
          [other],
        ),
      ).toHaveLength(0);
      await rows(
        "UPDATE entitlement_grants SET state='revoked',revision=revision+1 WHERE source_order_id=$1",
        [first],
      );
      expect(
        (
          await rows(
            "SELECT state FROM entitlement_grants WHERE source_order_id=$1",
            [second],
          )
        ).every((r) => r.state === "active"),
      ).toBe(true);
    });
    it("retains both captured receipts when concurrent cross-tier confirmations require manual review", async () => {
      // Removing the manual-review return must roll back the losing capture and fail this test.
      const orderIds = [
        await order(sku(), false),
        await order(
          sku({
            skuId: "conflicting",
            features: { ...features, storageBytes: 2000000 },
          }),
          false,
        ),
      ];
      const adapters = new PaymentAdapters("dev"),
        secret = "local-only-cross-tier-payment-secret-32-bytes";
      const events = [];
      for (const orderId of orderIds) {
        const snapshot = (
          await rows("SELECT snapshot FROM order_snapshots WHERE order_id=$1", [
            orderId,
          ])
        )[0].snapshot as OrderSnapshot;
        await rows(
          "INSERT INTO payment_attempts(id,workspace_id,order_id,attempt,channel,merchant_account_ref,provider_request_id,amount_fen) VALUES($1,$2,$3,1,'wechat_pay','merchant',$5,$4)",
          [id(), wid, orderId, snapshot.sku.priceFen, orderId],
        );
        adapters.register(
          snapshot.bindingId,
          new LocalSignedPaymentAdapter({
            environment: "dev",
            channel: "wechat_pay",
            secret,
            now: () => clock,
            transport: {
              create: async () => ({ clientPayload: {} }),
              query: async () => null,
              close: async () => null,
            },
          }),
          { approved: true },
        );
        const raw = Buffer.from(
            JSON.stringify({
              channel: "wechat_pay",
              eventId: `event-${orderId}`,
              transactionId: `tx-${orderId}`,
              orderId,
              appId: "app",
              merchantId: "merchant",
              amountFen: 123,
              currency: "CNY",
              state: "paid",
              fulfillable: true,
            }),
          ),
          timestamp = String(+clock),
          signature = createHmac("sha256", secret)
            .update(timestamp)
            .update(".")
            .update(raw)
            .digest("hex");
        events.push(
          await adapters.verify(snapshot.bindingId, raw, {
            "x-payment-timestamp": timestamp,
            "x-payment-signature": signature,
          }),
        );
      }
      const confirmation = new PaymentConfirmation(
        db.database,
        adapters,
        fulfillment.fulfillOrder,
      );
      const results = await Promise.allSettled(
        events.map((event) => confirmation.confirmPayment(event)),
      );
      expect(results.map((result) => result.status)).toEqual([
        "fulfilled",
        "fulfilled",
      ]);
      const captured = await rows(
        "SELECT id,state,paid_at,fulfillment_state FROM orders WHERE workspace_id=$1",
        [wid],
      );
      expect(captured.map((row) => row.fulfillment_state).sort()).toEqual([
        "fulfilled",
        "manual_review",
      ]);
      expect(captured.every((row) => row.state === "paid" && row.paid_at)).toBe(
        true,
      );
      expect(
        await rows(
          "SELECT * FROM payment_events WHERE workspace_id=$1 AND event_kind='paid'",
          [wid],
        ),
      ).toHaveLength(2);
      expect(
        (
          await rows("SELECT * FROM payment_attempts WHERE workspace_id=$1", [
            wid,
          ])
        ).every((row) => row.state === "paid" && row.provider_transaction_id),
      ).toBe(true);
      const review = captured.find(
        (row) => row.fulfillment_state === "manual_review",
      )!;
      expect(
        await rows(
          "SELECT * FROM entitlement_grants WHERE source_order_id=$1",
          [review.id],
        ),
      ).toHaveLength(0);
      expect(
        await rows(
          "SELECT * FROM entitlement_grants WHERE workspace_id=$1 AND grant_type='membership'",
          [wid],
        ),
      ).toHaveLength(1);
      expect(
        await credits.creditBalance(wid, clock.toISOString()),
      ).toMatchObject({ available: 20 });
      await Promise.all(
        events.map((event) => confirmation.confirmPayment(event)),
      );
      const audits = await rows(
        "SELECT redacted_details FROM audit_events WHERE workspace_id=$1 AND target_id=$2 AND action='commerce.fulfillment_manual_review'",
        [wid, review.id],
      );
      expect(audits).toEqual([
        {
          redacted_details: {
            reasonCode: "CROSS_TIER_MEMBERSHIP_DISABLED",
            fulfillmentState: "manual_review",
          },
        },
      ]);
      expect(
        await rows(
          "SELECT * FROM payment_events WHERE workspace_id=$1 AND event_kind='paid'",
          [wid],
        ),
      ).toHaveLength(2);
      expect(
        (
          await rows("SELECT fulfillment_state FROM orders WHERE id=$1", [
            review.id,
          ])
        )[0].fulfillment_state,
      ).toBe("manual_review");
    });
    it("projects real published free policy and time-based paid grants without a cron", async () => {
      const ent = new EntitlementService(
        db.database,
        async () => release,
        () => clock,
      );
      expect(await ent.readQuota(wid)).toEqual({
        limitBytes: 1234,
        maxProjectPhotos: 23,
      });
      expect(await ent.getEntitlements(wid, clock.toISOString())).toMatchObject(
        { maxDpi: 72, brandWatermark: true, grantIds: [] },
      );
      await grant();
      expect(await ent.readQuota(wid)).toEqual({
        limitBytes: 1000000,
        maxProjectPhotos: 500,
      });
      expect(await ent.getEntitlements(wid, clock.toISOString())).toMatchObject(
        { maxDpi: 300, brandWatermark: false, maxConcurrentExports: 2 },
      );
      clock = new Date(+clock + 31 * 86400000);
      expect(await ent.readQuota(wid)).toEqual({
        limitBytes: 1234,
        maxProjectPhotos: 23,
      });
      delete (release.versions as Record<string, unknown>).workspace;
      await expect(ent.readQuota(wid)).rejects.toThrow("UNCONFIGURED");
    });
    it("accepts exactly one concurrent request with exactly enough credits", async () => {
      await grant();
      const a = await job(),
        b = await job();
      const requests = await Promise.allSettled(
        [a, b].map((j) =>
          transaction((tx) => credits.reserveCredits(tx, wid, j.jobId, 20)),
        ),
      );
      expect(requests.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(await credits.creditBalance(wid, clock.toISOString())).toEqual({
        available: 0,
        reserved: 20,
        frozen: 0,
        expired: 0,
      });
    });
    it("replays one job reservation without reallocating and rejects mismatched quote or amount", async () => {
      await grant();
      const j = await job();
      const a = await transaction((tx) =>
        credits.reserveCredits(tx, wid, j.jobId, 20),
      );
      expect(
        await transaction((tx) => credits.reserveCredits(tx, wid, j.jobId, 20)),
      ).toEqual(a);
      await expect(
        transaction((tx) => credits.reserveCredits(tx, wid, j.jobId, 19)),
      ).rejects.toThrow();
      await expect(
        transaction((tx) => credits.reserveCredits(tx, id(), j.jobId, 20)),
      ).rejects.toThrow();
      const q = await job(10);
      await expect(
        transaction((tx) => credits.reserveCredits(tx, wid, q.jobId, 11)),
      ).rejects.toThrow();
      expect(
        await rows(
          "SELECT * FROM credit_ledger WHERE workspace_id=$1 AND entry_type='reserve'",
          [wid],
        ),
      ).toHaveLength(1);
    });
    it("locks FEFO lots in stable order and releases to original lots without extending expiry", async () => {
      await grant(sku({ credits: 10, creditValidityDays: 2 }));
      await grant(sku({ credits: 10, creditValidityDays: 1 }));
      const lots = await rows(
        "SELECT * FROM credit_lots WHERE workspace_id=$1 ORDER BY expires_at,id",
        [wid],
      );
      const r = await reserve(15);
      const allocations = await rows(
        "SELECT * FROM credit_reservation_allocations WHERE reservation_id=$1 ORDER BY amount DESC",
        [r.reservationId],
      );
      expect(allocations[0].lot_id).toBe(lots[0].id);
      expect(Number(allocations[0].amount)).toBe(10);
      clock = new Date(+clock + 3 * 86400000);
      await transaction((tx) =>
        credits.releaseCredits(tx, r.reservationId, id()),
      );
      const after = await rows(
        "SELECT * FROM credit_lots WHERE workspace_id=$1 ORDER BY expires_at,id",
        [wid],
      );
      expect(after.map((l) => l.expires_at)).toEqual(
        lots.map((l) => l.expires_at),
      );
      expect(await credits.creditBalance(wid, clock.toISOString())).toEqual({
        available: 0,
        reserved: 0,
        frozen: 0,
        expired: 20,
      });
      expect(
        (
          await rows(
            "SELECT lot_id FROM credit_ledger WHERE reservation_id=$1 AND entry_type='release'",
            [r.reservationId],
          )
        )
          .map((l) => l.lot_id)
          .sort(),
      ).toEqual(lots.map((l) => l.id).sort());
    });
    it("settles once across expiry and competing terminal calls cannot double-write", async () => {
      await grant();
      const r = await reserve();
      clock = new Date(+clock + 31 * 86400000);
      await Promise.all(
        Array.from({ length: 15 }, () =>
          transaction((tx) => credits.settleCredits(tx, r.reservationId, id())),
        ),
      );
      await transaction((tx) =>
        credits.releaseCredits(tx, r.reservationId, id()),
      );
      expect(
        await rows(
          "SELECT * FROM credit_ledger WHERE reservation_id=$1 AND entry_type='settle'",
          [r.reservationId],
        ),
      ).toHaveLength(1);
      expect(
        Number(
          (
            await rows(
              "SELECT consumed FROM credit_lots WHERE workspace_id=$1",
              [wid],
            )
          )[0].consumed,
        ),
      ).toBe(20);
    });
    it("releases once in settle/release races and account remains nonnegative", async () => {
      await grant();
      const r = await reserve();
      await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          transaction((tx) =>
            i % 2
              ? credits.settleCredits(tx, r.reservationId, id())
              : credits.releaseCredits(tx, r.reservationId, id()),
          ),
        ),
      );
      expect(
        await rows(
          "SELECT * FROM credit_ledger WHERE reservation_id=$1 AND entry_type IN ('settle','release')",
          [r.reservationId],
        ),
      ).toHaveLength(1);
      const b = await credits.creditBalance(wid, clock.toISOString());
      expect(b.reserved).toBe(0);
      expect(b.available).toBeGreaterThanOrEqual(0);
    });
    it("freezes refund-source lots, prevents frozen consumption and keeps other orders available", async () => {
      const oid = await grant();
      const r = await reserve();
      await rows(
        "UPDATE orders SET state='refund_pending',revision=revision+1 WHERE id=$1",
        [oid],
      );
      await expect(
        transaction((tx) => credits.settleCredits(tx, r.reservationId, id())),
      ).rejects.toThrow("FROZEN");
      await transaction((tx) =>
        credits.releaseCredits(tx, r.reservationId, id()),
      );
      expect(await credits.creditBalance(wid, clock.toISOString())).toEqual({
        available: 0,
        reserved: 0,
        frozen: 20,
        expired: 0,
      });
      const j = await job();
      await expect(
        transaction((tx) => credits.reserveCredits(tx, wid, j.jobId, 20)),
      ).rejects.toThrow();
      await grant();
      expect(
        await credits.creditBalance(wid, clock.toISOString()),
      ).toMatchObject({ available: 20, frozen: 20 });
    });
    it("freezes inflight refunds but keeps terminal partial-refund remainder eligible", async () => {
      const oid = await grant(),
        attemptId = id(),
        refundId = id();
      await rows(
        "INSERT INTO payment_attempts(id,workspace_id,order_id,attempt,channel,merchant_account_ref,provider_request_id,amount_fen,state) VALUES($1,$2,$3,1,'wechat_pay','merchant',$4,123,'paid')",
        [attemptId, wid, oid, oid],
      );
      await rows(
        "INSERT INTO refunds(id,workspace_id,order_id,payment_attempt_id,operation_id,amount_fen,reason_code) VALUES($1,$2,$3,$4,$5,1,'local-test')",
        [refundId, wid, oid, attemptId, id()],
      );
      // Even if the order state is stale, each unresolved refund freezes its source.
      for (const state of [
        "requested",
        "submitted",
        "unknown",
        "manual_review",
      ]) {
        await rows(
          "UPDATE refunds SET state=$2,revision=revision+1 WHERE id=$1",
          [refundId, state],
        );
        expect(
          await credits.creditBalance(wid, clock.toISOString()),
        ).toMatchObject({ available: 0, frozen: 20 });
        await expect(reserve()).rejects.toThrow("CREDITS_INSUFFICIENT");
      }
      await transaction(async (tx) => {
        await tx.query(
          "UPDATE refunds SET state='succeeded',revision=revision+1 WHERE id=$1",
          [refundId],
        );
        await tx.query(
          "UPDATE orders SET state='partially_refunded',revision=revision+1 WHERE id=$1",
          [oid],
        );
      });
      // Task7 owns source reversal. A terminal status alone cannot freeze the
      // remaining unrevoked points after its source adjustment is complete.
      expect(
        await credits.creditBalance(wid, clock.toISOString()),
      ).toMatchObject({ available: 20, frozen: 0 });
      const reservation = await reserve();
      expect(reservation.state).toBe("reserved");
    });
    it("expires only spendable available points with ledger and account projection in one transaction", async () => {
      await grant();
      clock = new Date(+clock + 31 * 86400000);
      expect(await credits.creditBalance(wid, clock.toISOString())).toEqual({
        available: 0,
        reserved: 0,
        frozen: 0,
        expired: 20,
      });
      await credits.creditBalance(wid, clock.toISOString());
      expect(
        await rows(
          "SELECT * FROM credit_ledger WHERE workspace_id=$1 AND entry_type='expire'",
          [wid],
        ),
      ).toHaveLength(1);
      expect(
        Number(
          (
            await rows(
              "SELECT available FROM credit_accounts WHERE workspace_id=$1",
              [wid],
            )
          )[0].available,
        ),
      ).toBe(0);
    });
    it("composes credit terminal hook inside fenced JobRepository completion only", async () => {
      await grant();
      const j = await job(),
        r = await transaction((tx) =>
          credits.reserveCredits(tx, wid, j.jobId, 20),
        );
      const repository = new JobRepository(
        db.database,
        async () => ({
          deployment: { global: 10, workspace: 10 },
          release: { global: 10, workspace: 10 },
          entitlement: { global: 10, workspace: 10 },
          leaseSeconds: 60,
          maxAttempts: 3,
          retryBackoffSeconds: [10, 30, 90],
        }),
        credits.creditTerminalHook,
      );
      const lease = (await repository.claimJob(
        j.jobId,
        "worker",
        clock.toISOString(),
      ))!;
      expect(
        await repository.finishJob(
          { ...lease, fence: lease.fence + 1 },
          { state: "succeeded", result: {} },
        ),
      ).toBe(false);
      expect(
        await credits.creditBalance(wid, clock.toISOString()),
      ).toMatchObject({ reserved: 20 });
      expect(
        await repository.finishJob(lease, { state: "succeeded", result: {} }),
      ).toBe(true);
      expect(
        await repository.finishJob(lease, { state: "failed", result: {} }),
      ).toBe(false);
      expect(
        (
          await rows("SELECT state FROM credit_reservations WHERE id=$1", [
            r.reservationId,
          ])
        )[0].state,
      ).toBe("settled");
    });
    it("purchased credit SKU grants only its frozen lot and failed job releases through the terminal hook", async () => {
      await grant(sku({ skuKind: "credits", skuId: "purchased-points" }));
      expect(
        await rows(
          "SELECT * FROM entitlement_grants WHERE workspace_id=$1 AND grant_type='membership'",
          [wid],
        ),
      ).toHaveLength(0);
      const j = await job(),
        r = await transaction((tx) =>
          credits.reserveCredits(tx, wid, j.jobId, 20),
        );
      const repository = new JobRepository(
        db.database,
        async () => ({
          deployment: { global: 10, workspace: 10 },
          release: { global: 10, workspace: 10 },
          entitlement: { global: 10, workspace: 10 },
          leaseSeconds: 60,
          maxAttempts: 3,
          retryBackoffSeconds: [10, 30, 90],
        }),
        credits.creditTerminalHook,
      );
      const lease = (await repository.claimJob(
        j.jobId,
        "worker",
        clock.toISOString(),
      ))!;
      await rows(
        "UPDATE jobs SET lease_expires_at=clock_timestamp()-interval '1 second',revision=revision+1 WHERE id=$1",
        [j.jobId],
      );
      expect(
        await repository.finishJob(lease, { state: "failed", result: {} }),
      ).toBe(false);
      expect(
        await credits.creditBalance(wid, clock.toISOString()),
      ).toMatchObject({ reserved: 20 });
      await rows(
        "UPDATE jobs SET lease_expires_at=clock_timestamp()+interval '1 minute',revision=revision+1 WHERE id=$1",
        [j.jobId],
      );
      expect(
        await repository.finishJob(lease, { state: "failed", result: {} }),
      ).toBe(true);
      expect(
        (
          await rows("SELECT state FROM credit_reservations WHERE id=$1", [
            r.reservationId,
          ])
        )[0].state,
      ).toBe("released");
      expect(await credits.creditBalance(wid, clock.toISOString())).toEqual({
        available: 20,
        reserved: 0,
        frozen: 0,
        expired: 0,
      });
    });
  },
);
