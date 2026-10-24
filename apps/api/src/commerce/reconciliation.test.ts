import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { id } from "@album/server-core";
import { testDatabase } from "../../test/database";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
import { ReconciliationService } from "./reconciliation";
import { loadContracts } from "../http/contracts";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "C4 reconciliation integration",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      service: ReconciliationService,
      orderId: string,
      wid: string;
    beforeAll(async () => {
      db = await testDatabase();
      const auth = new AuthService(db.database, {
        secret: "local-reconciliation-test-secret-32-characters",
        environment: "dev",
      });
      const login = await auth.login(
        {
          exchange: async () => ({
            provider: "wechat",
            appId: "reconcile",
            subject: "finance",
            unionId: null,
            openPlatformId: null,
          }),
        },
        id(),
        "mini",
      );
      wid = (
        await new WorkspaceService(db.database, auth).createWorkspace(
          login.actor,
          "personal",
          id(),
        )
      ).workspaceId;
      orderId = id();
      const sku = id(),
        version = id();
      await db.database.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO billing_skus(id,code,name) VALUES($1::text,$1::text,'test')",
          [sku],
        );
        await tx.query(
          "INSERT INTO sku_versions(id,sku_id,version,price_fen,duration_days,credit_grant,features) VALUES($1,$2,1,123,30,0,'{}')",
          [version, sku],
        );
        await tx.query(
          "INSERT INTO orders(id,workspace_id,sku_version_id,buyer_user_id,amount_fen,state,channel,client_platform,expires_at) VALUES($1,$2,$3,$4,123,'closed','wechat_pay','web',now()+interval '1 hour')",
          [orderId, wid, version, login.actor.userId],
        );
      });
      service = new ReconciliationService(db.database);
    });
    afterAll(async () => {
      await db?.close();
    });
    it("records one daily review for provider paid/local closed and never grants on repeated concurrent reconciliation", async () => {
      const line = {
        channel: "wechat_pay",
        transactionId: "transaction",
        orderId,
        paidFen: 123,
        refundedFen: 0,
      };
      const before = await db.pool.query(
        "SELECT count(*) FROM ai_album.entitlement_grants",
      );
      const reports = await Promise.all(
        Array.from({ length: 10 }, () =>
          service.reconcileStatement("2026-10-24", [line]),
        ),
      );
      expect(reports[0].reviewIds).toHaveLength(1);
      expect(new Set(reports.flatMap((r) => r.reviewIds)).size).toBe(1);
      expect(
        (
          await db.pool.query(
            "SELECT count(*) FROM ai_album.audit_events WHERE action='commerce.reconciliation_review'",
          )
        ).rows[0].count,
      ).toBe("1");
      expect(
        (
          await db.pool.query(
            "SELECT count(*) FROM ai_album.entitlement_grants",
          )
        ).rows,
      ).toEqual(before.rows);
    });
    it("rejects malformed Shanghai business dates and unsafe statement amounts", async () => {
      await expect(
        service.reconcileStatement("2026-02-30", []),
      ).rejects.toMatchObject({ code: "INVALID_BUSINESS_DATE" });
      await expect(
        service.reconcileStatement("2026-10-24", [
          {
            channel: "wechat_pay",
            transactionId: "x",
            orderId,
            paidFen: -1,
            refundedFen: 0,
          },
        ]),
      ).rejects.toMatchObject({ code: "INVALID_STATEMENT" });
    });
  },
);
it("has explicit authenticated adjustment contract requiring source, reason and ticket", async () => {
  const { contract, resolve } = await loadContracts();
  const op =
    contract.paths["/admin/workspaces/{workspaceId}/adjustments"]?.post;
  expect(op?.operationId).toBe("createFinancialAdjustment");
  expect(op.security).toBeDefined();
  const schema = resolve(op.requestBody.content["application/json"].schema);
  expect(schema.required).toEqual(
    expect.arrayContaining(["sourceGrantId", "reason", "ticketId", "kind"]),
  );
});
it("allows synchronous completed config tests without fabricated jobs and requires jobs while running", async () => {
  const { validate } = await loadContracts();
  const value = {
    id: id(),
    draftId: id(),
    configHash: "a".repeat(64),
    credentialVersionIds: [],
    level: "schema",
    state: "passed",
    verifiedChecks: [],
    expiresAt: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  expect(() =>
    validate({ $ref: "#/components/schemas/ConfigTest" }, value),
  ).not.toThrow();
  for (const state of ["queued", "running"])
    expect(() =>
      validate(
        { $ref: "#/components/schemas/ConfigTest" },
        { ...value, state },
      ),
    ).toThrow();
});

it("carries redacted durable differences in reconciliation results without raw content", async () => {
  const { validate } = await loadContracts();
  const result = {
    id: id(),
    scope: "payments",
    scannedCount: 1,
    discrepancyCount: 1,
    state: "completed",
    reviews: [
      {
        id: id(),
        orderId: id(),
        paidFen: 123,
        refundedFen: 0,
        localState: "closed",
        localFulfillmentState: "unfulfilled",
      },
    ],
  };
  expect(() =>
    validate({ $ref: "#/components/schemas/ReconcileResult" }, result),
  ).not.toThrow();
  expect(() =>
    validate(
      { $ref: "#/components/schemas/ReconcileResult" },
      { ...result, reviews: [{ ...result.reviews[0], rawPhoto: "private" }] },
    ),
  ).toThrow();
});
