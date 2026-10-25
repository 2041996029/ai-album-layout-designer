import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { storageFixture } from "../../test/asset-fixtures";
import { LocalObjectStore } from "../assets/object-store";
import { RevisionService } from "../projects/revisions";
import {
  ExportService,
  type ExportPolicy,
  type EntitlementSnapshot,
} from "../exports/service";
import { preflight, authorizeExport } from "@album/export";
import type { DocumentModel } from "@album/document";
import fixture from "../../../../tests/fixtures/documents/minimal.json";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { id, type Actor } from "@album/server-core";
import { createJob, JobRepository } from "@album/jobs";
import type { PoolClient } from "pg";
import { testDatabase } from "../../test/database";
import { AuthService } from "../auth/identity";
import { ReauthService } from "../auth/reauthentication";
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
import {
  RefundService,
  RefundAdapters,
  type RefundAdapter,
  type VerifiedRefundEvent,
} from "./refunds";
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
  "C4 source refunds (PostgreSQL)",
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
          refundPolicy: { id: "refund", version: 1, automatic: "unused_only" },
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

    const secret = "refund-test-only-signature-secret-32-bytes";
    let refundService: RefundService,
      adapters: PaymentAdapters,
      refunds: RefundAdapters;
    let channel: RefundAdapter,
      queries = 0,
      submissions = 0;
    let refundJobs: JobRepository;
    let dualReviewRequired = false;
    let queryEvent: VerifiedRefundEvent | null = null;
    let reauthCalls = 0;
    beforeEach(() => {
      adapters = new PaymentAdapters("dev");
      refunds = new RefundAdapters(adapters);
      queries = 0;
      submissions = 0;
      queryEvent = null;
      reauthCalls = 0;
      dualReviewRequired = false;
      const auth = new AuthService(db.database, {
        secret: "test-only-secret-for-credit-32-bytes",
        environment: "dev",
      });
      refundJobs = new JobRepository(
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
      refundService = new RefundService(
        db.database,
        auth,
        new WorkspaceService(db.database, auth),
        adapters,
        refunds,
        {
          reauth: {
            verifyFresh: async (_a, _p, purpose) => {
              expect(["billing_refund", "admin_operations"]).toContain(purpose);
              reauthCalls++;
            },
          },
          jobs: refundJobs,
          now: () => clock,
          financePolicy: async () => ({ dualReviewRequired }),
        },
      );
    });
    async function purchase(
      product = sku({ skuKind: "credits", skuId: id() }),
    ) {
      const oid = await grant(product);
      await rows(
        "UPDATE orders SET paid_at=clock_timestamp(),fulfillment_state='fulfilled' WHERE id=$1",
        [oid],
      );
      await rows(
        "INSERT INTO payment_attempts(id,workspace_id,order_id,attempt,channel,merchant_account_ref,provider_request_id,provider_transaction_id,state,amount_fen) VALUES($1,$2,$3::text,1,'wechat_pay','merchant',$3::text,$4,'paid',123)",
        [id(), wid, oid, "txn-" + oid],
      );
      const snap = (
        await rows("SELECT snapshot FROM order_snapshots WHERE order_id=$1", [
          oid,
        ])
      )[0].snapshot as OrderSnapshot;
      class Signed extends LocalSignedPaymentAdapter implements RefundAdapter {
        async verifyRefundEvent(
          raw: Uint8Array,
          headers: Record<string, string>,
        ) {
          const base = await this.verifyEvent(raw, headers),
            extra = JSON.parse(Buffer.from(raw).toString());
          return {
            ...base,
            refundId: extra.refundId,
            providerRefundId: extra.providerRefundId,
            refundState: extra.refundState,
          };
        }
        async queryOriginalRefund() {
          queries++;
          return queryEvent;
        }
      }
      channel = new Signed({
        environment: "dev",
        channel: "wechat_pay",
        secret,
        now: () => clock,
        transport: {
          create: async () => ({ clientPayload: {} }),
          query: async () => null,
          close: async () => null,
          refund: async () => {
            submissions++;
            return { providerRefundId: "provider-" + oid, state: "unknown" };
          },
        },
      });
      adapters.register(snap.bindingId, channel, { approved: true });
      refunds.register(snap.bindingId, channel);
      return oid;
    }
    const request = (oid: string, key = id(), service = refundService) =>
      service.requestRefund(actor, wid, oid, "Customer request", key);
    function proof(
      oid: string,
      rid: string,
      extra: Partial<VerifiedRefundEvent> = {},
    ): VerifiedRefundEvent {
      return {
        channel: "wechat_pay",
        eventId: id(),
        transactionId: "txn-" + oid,
        orderId: oid,
        appId: "app",
        merchantId: "merchant",
        amountFen: 123,
        currency: "CNY",
        state: "refunded",
        fulfillable: false,
        refundId: rid,
        providerRefundId: "provider-" + oid,
        refundState: "succeeded",
        ...extra,
      };
    }
    async function confirm(e: VerifiedRefundEvent) {
      const raw = Buffer.from(JSON.stringify(e)),
        timestamp = String(+clock);
      const signature = createHmac("sha256", secret)
        .update(timestamp)
        .update(".")
        .update(raw)
        .digest("hex");
      const binding = (
        await rows(
          "SELECT snapshot->>'bindingId' AS id FROM order_snapshots WHERE order_id=$1",
          [e.orderId],
        )
      )[0].id;
      const verified = await refunds.verify(binding, raw, {
        "x-payment-timestamp": timestamp,
        "x-payment-signature": signature,
      });
      return refundService.confirmVerifiedRefund(verified, e.refundId);
    }
    it("durably rotates more than 100 pending refund obligations across recovery restart", async () => {
      const ids: string[] = [];
      for (let i = 0; i < 101; i++)
        ids.push((await request(await purchase())).refundId);
      expect(await refundService.recoverPending(100)).toBe(100);
      expect(submissions).toBe(100);
      expect(
        (await rows("SELECT state FROM refunds WHERE id=$1", [ids[100]]))[0]
          .state,
      ).toBe("requested");
      const restarted = refundService.withRequest({});
      expect(await restarted.recoverPending(100)).toBe(1);
      expect(submissions).toBe(101);
      expect(
        (await rows("SELECT state FROM refunds WHERE id=$1", [ids[100]]))[0]
          .state,
      ).toBe("unknown");
      await rows(
        "UPDATE outbox SET available_at=clock_timestamp() WHERE aggregate_kind='refund'",
      );
      await restarted.recoverPending(100);
      expect(submissions).toBe(101); // submitted intents only query; never charge/refund twice
      expect(queries).toBeGreaterThanOrEqual(100);
    }, 60000);
    it("durably rotates more than 100 verified receipts past unresolved active jobs", async () => {
      const leases: any[] = [],
        ids: string[] = [];
      const fairJobs = new JobRepository(
        db.database,
        async () => ({
          deployment: { global: 1000, workspace: 1000 },
          release: { global: 1000, workspace: 1000 },
          entitlement: { global: 1000, workspace: 1000 },
          leaseSeconds: 120,
          maxAttempts: 3,
          retryBackoffSeconds: [10, 30, 90],
        }),
        credits.creditTerminalHook,
      );
      try {
        for (let i = 0; i < 101; i++) {
          const oid = await purchase(),
            reservation = await reserve(20),
            lease = (await fairJobs.claimJob(
              reservation.jobId,
              "receipt-recovery",
              clock.toISOString(),
            ))!,
            r = await request(oid);
          leases.push(lease);
          ids.push(r.refundId);
          expect(await confirm(proof(oid, r.refundId))).toBe("manual_review");
        }
        expect(await refundService.recoverVerifiedReceipts(100)).toBe(0);
        await fairJobs.finishJob(leases[100], {
          state: "cancelled",
          result: {},
        });
        const restarted = refundService.withRequest({});
        expect(await restarted.recoverVerifiedReceipts(100)).toBe(1);
        expect(
          (await rows("SELECT state FROM refunds WHERE id=$1", [ids[100]]))[0]
            .state,
        ).toBe("succeeded");
        expect(
          (
            await rows(
              "SELECT count(*) AS n FROM refunds WHERE workspace_id=$1 AND state='manual_review'",
              [wid],
            )
          )[0].n,
        ).toBe("100");
      } finally {
        for (const lease of leases)
          if (lease)
            await fairJobs.finishJob(lease, { state: "cancelled", result: {} });
        await rows(
          "UPDATE outbox SET available_at=clock_timestamp() WHERE aggregate_kind='refund' AND workspace_id=$1",
          [wid],
        );
        await refundService.recoverVerifiedReceipts(1000);
      }
    }, 120000);
    it("freezes only source lots before submission and blocks concurrent consumption", async () => {
      const oid = await purchase();
      const r = await request(oid);
      expect(r.state).toBe("requested");
      expect(
        await credits.creditBalance(wid, clock.toISOString()),
      ).toMatchObject({ available: 0, frozen: 20 });
      const j = await job(20);
      await expect(
        transaction((tx) => credits.reserveCredits(tx, wid, j.jobId, 20)),
      ).rejects.toThrow("CREDITS_INSUFFICIENT");
    });
    it("preserves capture facts, reverses source only, and deduplicates 100 callbacks", async () => {
      const oid = await purchase();
      const other = await purchase();
      const r = await request(oid);
      const e = proof(oid, r.refundId);
      expect(
        await Promise.all(Array.from({ length: 100 }, () => confirm(e))),
      ).toEqual(Array(100).fill("succeeded"));
      expect(
        (
          await rows(
            "SELECT amount_fen,paid_at,state FROM orders WHERE id=$1",
            [oid],
          )
        )[0],
      ).toMatchObject({ amount_fen: "123", state: "refunded" });
      expect(
        (
          await rows(
            "SELECT sum(amount_fen)::text AS total FROM refunds WHERE order_id=$1 AND state='succeeded'",
            [oid],
          )
        )[0].total,
      ).toBe("123");
      expect(
        await rows(
          "SELECT state FROM entitlement_grants WHERE source_order_id=$1",
          [other],
        ),
      ).toEqual([{ state: "active" }]);
      expect(
        await rows(
          "SELECT id FROM credit_ledger WHERE workspace_id=$1 AND entry_type='revoke'",
          [wid],
        ),
      ).toHaveLength(1);
      expect(
        await credits.creditBalance(wid, clock.toISOString()),
      ).toMatchObject({ available: 20, frozen: 0 });
    });
    it("queries original unknown refund without resubmitting, including concurrent workers", async () => {
      const oid = await purchase(),
        r = await request(oid);
      expect(
        await Promise.all(
          Array.from({ length: 8 }, () =>
            refundService.processRefund(r.refundId, channel),
          ),
        ),
      ).toEqual(Array(8).fill("unknown"));
      expect(submissions).toBe(1);
      expect(queries).toBeGreaterThan(0);
      queryEvent = proof(oid, r.refundId);
      expect(await refundService.processRefund(r.refundId, channel)).toBe(
        "succeeded",
      );
      expect(submissions).toBe(1);
    });
    it("unfreezes verified failure and accepts one late success", async () => {
      const oid = await purchase(),
        r = await request(oid);
      expect(
        await confirm(proof(oid, r.refundId, { refundState: "failed" })),
      ).toBe("failed");
      expect(
        await credits.creditBalance(wid, clock.toISOString()),
      ).toMatchObject({ available: 20, frozen: 0 });
      expect(await confirm(proof(oid, r.refundId))).toBe("succeeded");
      expect(
        await rows(
          "SELECT id FROM credit_ledger WHERE workspace_id=$1 AND entry_type='revoke'",
          [wid],
        ),
      ).toHaveLength(1);
    });
    it("routes consumed credits to manual review and records forced-refund loss without negative balances", async () => {
      const oid = await purchase(),
        rsv = await reserve(8);
      await transaction((tx) =>
        credits.settleCredits(tx, rsv.reservationId, id()),
      );
      const r = await request(oid);
      expect(r.state).toBe("manual_review");
      expect(await refundService.processRefund(r.refundId, channel)).toBe(
        "manual_review",
      );
      expect(submissions).toBe(0);
      expect(await confirm(proof(oid, r.refundId))).toBe("succeeded");
      expect(
        (
          await rows(
            "SELECT available,consumed,revoked FROM credit_lots WHERE workspace_id=$1",
            [wid],
          )
        )[0],
      ).toEqual({ available: "0", consumed: "8", revoked: "12" });
      expect(
        await rows(
          "SELECT id FROM audit_events WHERE target_id=$1 AND action='commerce.refund_financial_loss'",
          [r.refundId],
        ),
      ).toHaveLength(1);
      expect(
        (
          await rows("SELECT fulfillment_state FROM orders WHERE id=$1", [oid])
        )[0].fulfillment_state,
      ).toBe("manual_review");
    });
    it("cancels held jobs outside refund locks through fenced repository hooks", async () => {
      const oid = await purchase();
      const rsv = await reserve(20);
      const r = await request(oid);
      expect(
        (await rows("SELECT state FROM jobs WHERE id=$1", [rsv.jobId]))[0]
          .state,
      ).toBe("cancelled");
      expect(
        (
          await rows("SELECT state FROM credit_reservations WHERE id=$1", [
            rsv.reservationId,
          ])
        )[0].state,
      ).toBe("released");
      expect(
        await credits.creditBalance(wid, clock.toISOString()),
      ).toMatchObject({ frozen: 20, reserved: 0 });
      await confirm(proof(oid, r.refundId));
    });
    it("rejects untrusted payment objects, tampered proofs and mismatched refund business identities", async () => {
      const oid = await purchase(),
        r = await request(oid),
        e = proof(oid, r.refundId);
      await expect(refundService.confirmRefund(e, r.refundId)).rejects.toThrow(
        "REFUND_UNVERIFIED",
      );
      for (const extra of [
        { amountFen: 122 },
        { appId: "wrong" },
        { merchantId: "wrong" },
        { transactionId: "wrong" },
        { providerRefundId: "wrong" },
        { refundId: "wrong" },
      ]) {
        if ("providerRefundId" in extra)
          await refundService.processRefund(r.refundId, channel);
        await expect(confirm(proof(oid, r.refundId, extra))).rejects.toThrow();
      }
      expect(
        await rows(
          "SELECT id FROM credit_ledger WHERE workspace_id=$1 AND entry_type='revoke'",
          [wid],
        ),
      ).toHaveLength(0);
    });
    it("keeps durable financial replay and rejects payload collisions after HTTP idempotency expiry", async () => {
      const oid = await purchase(),
        key = id(),
        r = await request(oid, key);
      await rows("DELETE FROM idempotency_keys WHERE workspace_id=$1", [wid]);
      expect((await request(oid, key)).refundId).toBe(r.refundId);
      await expect(
        refundService.requestRefund(actor, wid, oid, "different", key),
      ).rejects.toThrow("IDEMPOTENCY_MISMATCH");
      expect(
        await rows("SELECT id FROM refunds WHERE order_id=$1", [oid]),
      ).toHaveLength(1);
    });
    it("checks owner authorization, revision, amount and fresh financial proof", async () => {
      const oid = await purchase();
      await expect(
        request(
          oid,
          id(),
          refundService.withRequest({ expectedOrderRevision: 999 }),
        ),
      ).rejects.toThrow("REVISION_CONFLICT");
      await expect(
        request(oid, id(), refundService.withRequest({ amountFen: 124 })),
      ).rejects.toThrow("REFUND_AMOUNT_INVALID");
      await rows(
        "UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1",
        [wid],
      );
      await expect(request(oid)).rejects.toThrow("FORBIDDEN");
      expect(reauthCalls).toBe(2);
    });
    it("freezes membership grants while preserving unrelated membership sources", async () => {
      const oid = await purchase(sku({ skuId: id() }));
      const ent = new EntitlementService(
        db.database,
        async () => release,
        () => clock,
      );
      expect(
        (await ent.getEntitlements(wid, clock.toISOString())).grantIds,
      ).toHaveLength(1);
      await request(oid);
      expect(
        (await ent.getEntitlements(wid, clock.toISOString())).grantIds,
      ).toHaveLength(0);
    });
    it("rejects an export when a refund freezes its source after entitlement projection before acceptance", async () => {
      const oid = await purchase(
        sku({
          skuId: id(),
          features: { ...features, storageBytes: 2 * 1024 ** 3 },
        }),
      );
      const realEntitlements = new EntitlementService(
        db.database,
        async () => release,
        () => clock,
      );
      const auth = new AuthService(db.database, {
        secret: "test-only-secret-for-credit-32-bytes",
        environment: "dev",
      });
      const workspaces = new WorkspaceService(db.database, auth),
        storage = await storageFixture(db.database);
      const root = await mkdtemp(tmpdir() + "/refund-export-");
      try {
        const objects = new LocalObjectStore({
          root,
          secret: "s".repeat(40),
          environment: "dev",
          baseUrl: "http://localhost",
        });
        const revisions = new RevisionService(
            db.database,
            workspaces,
            objects,
            storage,
          ),
          doc = structuredClone(fixture) as DocumentModel;
        doc.projectId = id();
        await revisions.createInitialProject(
          actor,
          wid,
          doc,
          { assets: [], fonts: [] },
          id(),
          "Refund race",
        );
        const persisted = (
          await rows(
            "SELECT snapshot->>'releaseId' AS id FROM order_snapshots WHERE order_id=$1",
            [oid],
          )
        )[0].id;
        await rows(
          "INSERT INTO config_active_releases(id,environment,release_id) VALUES($1,'dev',$2) ON CONFLICT(environment) DO UPDATE SET release_id=excluded.release_id",
          [id(), persisted],
        );
        const payload: ExportPolicy = {
          kind: "export",
          allowedFormats: ["png"],
          allowedDpis: [72, 150, 300],
          maxSurfacePixels: 50_000_000,
          browserBudgetMiB: 768,
          workerBudgetMiB: 2048,
          ppiWarning: 200,
          ppiStrongWarning: 100,
          outputRetentionDays: 7,
          jpegQuality: 0.9,
          jpegMatte: "#FFFFFF",
        };
        let freeze = false;
        const service = new ExportService({
          db: db.database,
          authorization: workspaces,
          objects,
          storage,
          entitlements: {
            getEntitlements: (w, at) => realEntitlements.getEntitlements(w, at),
            verifyAcceptance: (
              tx: PoolClient,
              w: string,
              snapshot: EntitlementSnapshot,
            ) => realEntitlements.verifyAcceptance(tx, w, snapshot),
          },
          config: {
            loadRelease: async () => ({
              ...release,
              releaseId: persisted,
              versions: {
                ...release.versions,
                export: {
                  id: "exp",
                  namespace: "export",
                  version: 1,
                  environment: "dev",
                  payload,
                  revision: 1,
                  state: "published",
                  payloadHash: payloadHash(payload),
                },
              },
            }),
          },
          preflight: {
            check: async (snapshot, _pins, signal, ack) => {
              const report = await preflight(
                snapshot,
                {
                  read: async () => {
                    throw Error("Unexpected resource");
                  },
                },
                signal,
                { memoryBudgetBytes: 2 * 1024 ** 3 },
              );
              if (ack) authorizeExport(snapshot, report, ack);
              if (freeze) {
                freeze = false;
                await request(oid);
              }
              return report;
            },
          },
          renderer: { version: "test", imageDigest: "sha256:" + hash },
          tokenSecret: "t".repeat(40),
          clock: () => clock.toISOString(),
        });
        const p = await service.createPreflight(
          actor,
          wid,
          doc.projectId,
          {
            revision: 1,
            exportSpec: {
              format: "png",
              dpi: 150,
              view: "spread",
              pageIds: ["spread_1"],
              includeCover: false,
              bleedMm: 0,
              jpegMatte: "#FFFFFF",
            },
          },
          id(),
        );
        freeze = true;
        await expect(
          service.acceptPreflightExport(
            actor,
            {
              workspaceId: wid,
              projectId: doc.projectId,
              revision: 1,
              preflightToken: p.preflightToken!,
              normalizedSpecHash: p.normalizedSpecHash,
              warningsAcknowledged: p.issues
                .filter((i) => i.acknowledgementRequired)
                .map((i) => i.id),
            },
            id(),
          ),
        ).rejects.toThrow("PREFLIGHT_STALE");
        expect(
          await rows("SELECT id FROM jobs WHERE workspace_id=$1", [wid]),
        ).toHaveLength(0);
        expect(
          await rows("SELECT id FROM resource_pins WHERE workspace_id=$1", [
            wid,
          ]),
        ).toHaveLength(0);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
    it("keeps a running reservation frozen until fenced cancellation before honoring its verified receipt", async () => {
      const oid = await purchase(),
        rsv = await reserve(20),
        lease = (await refundJobs.claimJob(
          rsv.jobId,
          "worker",
          clock.toISOString(),
        ))!;
      const r = await request(oid),
        e = proof(oid, r.refundId);
      expect(
        (await rows("SELECT state FROM jobs WHERE id=$1", [rsv.jobId]))[0]
          .state,
      ).toBe("cancel_requested");
      expect(await refundService.processRefund(r.refundId, channel)).toBe(
        "requested",
      );
      expect(submissions).toBe(0);
      expect(await confirm(e)).toBe("manual_review");
      expect(
        (
          await rows(
            "SELECT reserved,revoked FROM credit_lots WHERE workspace_id=$1",
            [wid],
          )
        )[0],
      ).toEqual({ reserved: "20", revoked: "0" });
      expect(
        await refundJobs.finishJob(lease, { state: "succeeded", result: {} }),
      ).toBe(false);
      expect(
        await refundJobs.finishJob(lease, { state: "cancelled", result: {} }),
      ).toBe(true);
      expect(await confirm(e)).toBe("succeeded");
      expect(
        (
          await rows(
            "SELECT reserved,revoked FROM credit_lots WHERE workspace_id=$1",
            [wid],
          )
        )[0],
      ).toEqual({ reserved: "0", revoked: "20" });
    });
    it("recovers an already verified receipt after job terminal without another channel delivery", async () => {
      const oid = await purchase(),
        rsv = await reserve(20),
        lease = (await refundJobs.claimJob(
          rsv.jobId,
          "recover-worker",
          clock.toISOString(),
        ))!;
      const r = await request(oid),
        e = proof(oid, r.refundId);
      expect(await confirm(e)).toBe("manual_review");
      expect(await refundService.recoverVerifiedReceipts(100)).toBe(0);
      await refundJobs.finishJob(lease, { state: "cancelled", result: {} });
      await rows(
        "UPDATE outbox SET available_at=clock_timestamp() WHERE aggregate_kind='refund'",
      );
      expect(await refundService.recoverVerifiedReceipts(100)).toBe(1);
      expect(await refundService.recoverVerifiedReceipts(100)).toBe(0);
      expect(
        (await rows("SELECT state FROM refunds WHERE id=$1", [r.refundId]))[0]
          .state,
      ).toBe("succeeded");
      expect(
        (
          await rows(
            "SELECT reserved,revoked FROM credit_lots WHERE workspace_id=$1",
            [wid],
          )
        )[0],
      ).toEqual({ reserved: "0", revoked: "20" });
    });
    it("applies forced partial receipt proportionally and leaves terminal remainder spendable", async () => {
      const oid = await purchase();
      const r = await request(
        oid,
        id(),
        refundService.withRequest({ amountFen: 41 }),
      );
      expect(r.state).toBe("manual_review");
      expect(await confirm(proof(oid, r.refundId, { amountFen: 41 }))).toBe(
        "succeeded",
      );
      expect(
        await credits.creditBalance(wid, clock.toISOString()),
      ).toMatchObject({ available: 14, frozen: 0 });
      expect(
        (
          await rows("SELECT amount_fen,state FROM orders WHERE id=$1", [oid])
        )[0],
      ).toEqual({ amount_fen: "123", state: "partially_refunded" });
      const r2 = await request(oid);
      expect(
        await confirm(
          proof(oid, r2.refundId, {
            amountFen: 82,
            providerRefundId: "remaining-" + oid,
          }),
        ),
      ).toBe("succeeded");
      expect(
        await credits.creditBalance(wid, clock.toISOString()),
      ).toMatchObject({ available: 0, frozen: 0 });
      expect(
        (
          await rows(
            "SELECT sum(amount_fen)::text AS total FROM refunds WHERE order_id=$1 AND state='succeeded'",
            [oid],
          )
        )[0].total,
      ).toBe("123");
    });
    it("requires finance role and revision for audited approval or rejection", async () => {
      const oid = await purchase(),
        r = await request(
          oid,
          id(),
          refundService.withRequest({ amountFen: 41 }),
        );
      const decision = {
        decision: "reject" as const,
        expectedRevision: 1,
        reason: "Review found an ineligible request",
      };
      await expect(
        refundService.decideRefund(actor, r.refundId, decision, id()),
      ).rejects.toThrow("FORBIDDEN");
      await rows(
        "INSERT INTO admin_role_assignments(id,user_id,role) VALUES($1,$2,'finance') ON CONFLICT(user_id,role) DO UPDATE SET revoked_at=NULL",
        [id(), actor.userId],
      );
      const key = id();
      expect(
        await refundService.decideRefund(actor, r.refundId, decision, key),
      ).toBe("failed");
      expect(
        await refundService.decideRefund(actor, r.refundId, decision, key),
      ).toBe("failed");
      expect(
        (await refundService.getRefund(actor, wid, r.refundId)).reasonCode,
      ).toBe("REFUND_REJECTED");
      expect(
        await credits.creditBalance(wid, clock.toISOString()),
      ).toMatchObject({ available: 20, frozen: 0 });
      expect(
        await rows(
          "SELECT id FROM audit_events WHERE target_id=$1 AND action='commerce.refund_decision'",
          [r.refundId],
        ),
      ).toHaveLength(1);
    });
    it("rejects duplicate provider identity or changed signed event bodies", async () => {
      const oid = await purchase(),
        r = await request(oid),
        event = proof(oid, r.refundId);
      await confirm(event);
      await expect(
        confirm({ ...event, refundState: "failed" }),
      ).rejects.toThrow("REFUND_MISMATCH");
      const oid2 = await purchase(),
        r2 = await request(oid2);
      await expect(
        confirm(
          proof(oid2, r2.refundId, {
            providerRefundId: event.providerRefundId,
          }),
        ),
      ).rejects.toThrow("REFUND_MISMATCH");
      const raw = Buffer.from(JSON.stringify(proof(oid2, r2.refundId)));
      const binding = (
        await rows(
          "SELECT snapshot->>'bindingId' AS id FROM order_snapshots WHERE order_id=$1",
          [oid2],
        )
      )[0].id;
      await expect(
        refunds.verify(binding, raw, {
          "x-payment-timestamp": String(+clock),
          "x-payment-signature": "0".repeat(64),
        }),
      ).rejects.toThrow("PAYMENT_BAD_SIGNATURE");
    });
    it("enforces configured independent dual review and workspace-wide decision key collisions", async () => {
      dualReviewRequired = true;
      const oid = await purchase(),
        key = id(),
        r = await request(
          oid,
          key,
          refundService.withRequest({ amountFen: 41 }),
        );
      await rows(
        "INSERT INTO admin_role_assignments(id,user_id,role) VALUES($1,$2,'finance') ON CONFLICT(user_id,role) DO UPDATE SET revoked_at=NULL",
        [id(), actor.userId],
      );
      const approve = {
        decision: "approve" as const,
        expectedRevision: 1,
        reason: "Reviewed original receipt",
      };
      await expect(
        refundService.decideRefund(actor, r.refundId, approve, key),
      ).rejects.toThrow("IDEMPOTENCY_MISMATCH");
      expect(
        await refundService.decideRefund(actor, r.refundId, approve, id()),
      ).toBe("manual_review");
      await expect(
        refundService.decideRefund(
          actor,
          r.refundId,
          { ...approve, expectedRevision: 2 },
          id(),
        ),
      ).rejects.toThrow("REFUND_SECOND_REVIEWER_REQUIRED");
      const auth = new AuthService(db.database, {
        secret: "test-only-secret-for-credit-32-bytes",
        environment: "dev",
      });
      const second = (
        await auth.login(
          {
            exchange: async () => ({
              provider: "wechat",
              appId: "test",
              subject: id(),
              unionId: null,
              openPlatformId: null,
            }),
          },
          id(),
          "web",
        )
      ).actor;
      await rows(
        "INSERT INTO admin_role_assignments(id,user_id,role) VALUES($1,$2,'finance')",
        [id(), second.userId],
      );
      expect(
        await refundService.decideRefund(
          second,
          r.refundId,
          { ...approve, expectedRevision: 2 },
          id(),
        ),
      ).toBe("requested");
      expect(
        (await refundService.getRefund(actor, wid, r.refundId)).reasonCode,
      ).toBe("REFUND_APPROVED");
    });
    it("requires review for started membership without comprehensive usage proof but permits untouched future renewal", async () => {
      const active = await purchase(sku({ skuId: id() }));
      const future = await purchase(sku({ skuId: id() }));
      const futureGrant = (
        await rows(
          "SELECT starts_at FROM entitlement_grants WHERE source_order_id=$1 AND grant_type='membership'",
          [future],
        )
      )[0];
      expect(+futureGrant.starts_at).toBeGreaterThan(+clock);
      expect((await request(active)).state).toBe("manual_review");
      expect((await request(future)).state).toBe("requested");
    });
    it("resynchronizes frozen financial projections for a late success waiting on a newly held job", async () => {
      const oid = await purchase(),
        r = await request(oid);
      await confirm(proof(oid, r.refundId, { refundState: "failed" }));
      await reserve(8);
      expect(await confirm(proof(oid, r.refundId))).toBe("manual_review");
      expect(
        (await rows("SELECT state FROM orders WHERE id=$1", [oid]))[0].state,
      ).toBe("refund_pending");
      expect(
        (
          await rows(
            "SELECT available,reserved FROM credit_accounts WHERE workspace_id=$1",
            [wid],
          )
        )[0],
      ).toEqual({ available: "0", reserved: "8" });
    });
    it("replays a request with its consumed real proof and retries post-commit cancellation under live authorization", async () => {
      const oid = await purchase(),
        reservation = await reserve(20),
        key = id(),
        proof = id();
      const auth = new AuthService(db.database, {
        secret: "test-only-secret-for-credit-32-bytes",
        environment: "dev",
      });
      await rows(
        "INSERT INTO reauth_proofs(token_hash,user_id,session_id,purpose,expires_at) VALUES($1,$2,$3,'billing_refund',now()+interval '5 minutes')",
        [auth.hash(proof), actor.userId, actor.sessionId],
      );
      let cancellationAttempts = 0;
      const service = new RefundService(
        db.database,
        auth,
        new WorkspaceService(db.database, auth),
        adapters,
        refunds,
        {
          reauth: new ReauthService(db.database, auth, {}),
          now: () => clock,
          jobs: {
            requestCancel: async (a, w, j) => {
              if (++cancellationAttempts === 1) throw Error("CANCEL_RETRY");
              return refundJobs.requestCancel(a, w, j);
            },
          },
        },
      ).withRequest({ reauthProof: proof });
      await expect(request(oid, key, service)).rejects.toThrow("CANCEL_RETRY");
      expect(
        (
          await rows(
            "SELECT consumed_at FROM reauth_proofs WHERE token_hash=$1",
            [auth.hash(proof)],
          )
        )[0].consumed_at,
      ).not.toBeNull();
      const original = (
        await rows("SELECT id FROM refunds WHERE order_id=$1", [oid])
      )[0].id;
      expect(await request(oid, key, service)).toEqual({
        refundId: original,
        state: "requested",
      });
      expect(cancellationAttempts).toBe(2);
      expect(
        (
          await rows("SELECT state FROM jobs WHERE id=$1", [reservation.jobId])
        )[0].state,
      ).toBe("cancelled");
      await expect(
        service.requestRefund(actor, wid, oid, "Changed payload", key),
      ).rejects.toThrow("IDEMPOTENCY_MISMATCH");
      await rows("DELETE FROM idempotency_keys WHERE workspace_id=$1", [wid]);
      expect((await request(oid, key, service)).refundId).toBe(original);
      const other = await purchase();
      await expect(request(other, id(), service)).rejects.toThrow(
        "REAUTH_REQUIRED",
      );
      await rows(
        "UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
        [wid, actor.userId],
      );
      await expect(request(oid, key, service)).rejects.toThrow("FORBIDDEN");
      expect(
        await rows("SELECT id FROM refunds WHERE order_id=$1", [oid]),
      ).toHaveLength(1);
    });
    it("replays a finance decision with its consumed real proof while retaining conflict and revoked-role checks", async () => {
      const oid = await purchase(),
        r = await request(
          oid,
          id(),
          refundService.withRequest({ amountFen: 41 }),
        );
      await rows(
        "INSERT INTO admin_role_assignments(id,user_id,role) VALUES($1,$2,'finance') ON CONFLICT(user_id,role) DO UPDATE SET revoked_at=NULL",
        [id(), actor.userId],
      );
      const auth = new AuthService(db.database, {
          secret: "test-only-secret-for-credit-32-bytes",
          environment: "dev",
        }),
        proof = id(),
        key = id();
      await rows(
        "INSERT INTO reauth_proofs(token_hash,user_id,session_id,purpose,expires_at) VALUES($1,$2,$3,'admin_operations',now()+interval '5 minutes')",
        [auth.hash(proof), actor.userId, actor.sessionId],
      );
      const service = new RefundService(
        db.database,
        auth,
        new WorkspaceService(db.database, auth),
        adapters,
        refunds,
        {
          reauth: new ReauthService(db.database, auth, {}),
          jobs: refundJobs,
          now: () => clock,
          financePolicy: async () => ({ dualReviewRequired: false }),
        },
      ).withRequest({ reauthProof: proof });
      const decision = {
        decision: "reject" as const,
        expectedRevision: 1,
        reason: "Reviewed receipt",
      };
      expect(await service.decideRefund(actor, r.refundId, decision, key)).toBe(
        "failed",
      );
      expect(
        (
          await rows(
            "SELECT consumed_at FROM reauth_proofs WHERE token_hash=$1",
            [auth.hash(proof)],
          )
        )[0].consumed_at,
      ).not.toBeNull();
      expect(await service.decideRefund(actor, r.refundId, decision, key)).toBe(
        "failed",
      );
      await expect(
        service.decideRefund(
          actor,
          r.refundId,
          { ...decision, reason: "Changed payload" },
          key,
        ),
      ).rejects.toThrow("IDEMPOTENCY_MISMATCH");
      await rows("DELETE FROM idempotency_keys WHERE workspace_id=$1", [wid]);
      expect(await service.decideRefund(actor, r.refundId, decision, key)).toBe(
        "failed",
      );
      const next = await request(
        oid,
        id(),
        refundService.withRequest({ amountFen: 41 }),
      );
      await expect(
        service.decideRefund(actor, next.refundId, decision, id()),
      ).rejects.toThrow("REAUTH_REQUIRED");
      await rows(
        "UPDATE admin_role_assignments SET revoked_at=clock_timestamp() WHERE user_id=$1 AND role='finance'",
        [actor.userId],
      );
      await expect(
        service.decideRefund(actor, r.refundId, decision, key),
      ).rejects.toThrow("FORBIDDEN");
      expect(
        await rows(
          "SELECT id FROM audit_events WHERE target_id=$1 AND action='commerce.refund_decision'",
          [r.refundId],
        ),
      ).toHaveLength(1);
    });
  },
);
