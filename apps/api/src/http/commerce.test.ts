import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { id } from "@album/server-core";
import { testDatabase } from "../../test/database";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
import { ReauthService } from "../auth/reauthentication";
import { createApplication } from "../app.module";
import { bindCommerceRuntime } from "../commerce/runtime";
import type { ApiRuntime } from "./runtime";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "C4 real HTTP operations",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      runtime: ApiRuntime,
      app: any,
      session: any,
      wid: string;
    const call = (
      method: string,
      url: string,
      payload?: unknown,
      headers: Record<string, string> = {},
    ) =>
      app.inject({
        method,
        url,
        payload,
        headers: {
          cookie: `album_session=${session.accessToken}`,
          origin: "https://album.test",
          "x-csrf-token": session.csrfToken,
          "x-workspace-id": wid,
          "idempotency-key": id(),
          ...headers,
        },
      });
    beforeAll(async () => {
      db = await testDatabase();
      const auth = new AuthService(db.database, {
        secret: "local-commerce-http-secret-32-characters",
        environment: "dev",
      });
      const login = await auth.login(
        {
          exchange: async () => ({
            provider: "wechat",
            appId: "commerce",
            subject: "owner",
            unionId: null,
            openPlatformId: null,
          }),
        },
        id(),
        "mini",
      );
      session = await auth.createWebSession(login.actor);
      const workspaces = new WorkspaceService(db.database, auth);
      wid = (await workspaces.createWorkspace(session.actor, "personal", id()))
        .workspaceId;
      runtime = {
        db: db.database,
        auth,
        workspaces,
        environment: "dev",
        allowedOrigin: "https://album.test",
      };
      await bindCommerceRuntime(
        runtime,
        new ReauthService(db.database, auth, {}),
        {
          statements: {
            read: async () => [
              {
                channel: "wechat_pay",
                transactionId: "statement-capture",
                orderId: "missing-local-order",
                paidFen: 123,
                refundedFen: 0,
              },
            ],
          },
        },
      );
      app = await createApplication(runtime);
    }, 60000);
    afterAll(async () => {
      await app?.close();
      await db?.close();
    });
    it("lists no invented prices and durable empty orders/tasks/redemptions", async () => {
      for (const url of [
        "/v1/skus?platform=web",
        `/v1/workspaces/${wid}/orders`,
        `/v1/workspaces/${wid}/jobs`,
        `/v1/workspaces/${wid}/redemptions`,
      ]) {
        const r = await call("GET", url);
        expect(r.statusCode, r.body).toBe(200);
        expect(r.json().data).toEqual({
          items: [],
          nextCursor: null,
          hasMore: false,
        });
      }
    });
    it("classifies signed callbacks publicly while unconfigured channels fail closed", async () => {
      for (const endpoint of ["payment-callbacks", "refund-callbacks"]) {
        const r = await app.inject({
          method: "POST",
          url: `/v1/${endpoint}/wechat_pay`,
          payload: '{ "ciphertext": "raw" }',
          headers: { "content-type": "application/json" },
        });
        expect(r.statusCode, r.body).toBe(503);
      }
    });
    it("requires a live finance role for admin read/adjustment and ops for secrets", async () => {
      for (const url of [
        "/v1/admin/orders",
        "/v1/admin/orders/unknown/source-grants",
        "/v1/admin/redemption-batches",
        "/v1/admin/secrets",
      ]) {
        const r = await call("GET", url);
        expect(r.statusCode, r.body).toBe(403);
      }
      const r = await call(
        "POST",
        `/v1/admin/workspaces/${wid}/adjustments`,
        {
          kind: "credits",
          sourceGrantId: id(),
          creditDelta: 5,
          reason: "工单复核",
          ticketId: "ticket-1",
        },
        {
          "X-Reauthentication-Proof":
            "proof-valid-length-but-not-real-0000000000",
        },
      );
      expect(r.statusCode, r.body).toBe(403);
    });
    it("requires finance proof and records immutable adjustment provenance with replay", async () => {
      const source = id(),
        oid = id(),
        sv = id(),
        sku = id(),
        proof = "proof-" + id(),
        operation = id();
      await db.database.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO admin_role_assignments(id,user_id,role) VALUES($1,$2,'finance')",
          [id(), session.actor.userId],
        );
        await tx.query(
          "INSERT INTO reauth_proofs(token_hash,user_id,session_id,purpose,expires_at) VALUES($1,$2,$3,'admin_operations',now()+interval '5 minutes')",
          [
            runtime.auth.hash(proof),
            session.actor.userId,
            session.actor.sessionId,
          ],
        );
        await tx.query(
          "INSERT INTO billing_skus(id,code,name) VALUES($1::text,$1::text,'test')",
          [sku],
        );
        await tx.query(
          "INSERT INTO sku_versions(id,sku_id,version,price_fen,duration_days,credit_grant,features) VALUES($1,$2,1,1,0,10,'{}')",
          [sv, sku],
        );
        await tx.query(
          "INSERT INTO orders(id,workspace_id,sku_version_id,buyer_user_id,amount_fen,channel,client_platform,expires_at) VALUES($1,$2,$3,$4,1,'wechat_pay','web',now()+interval '1 day')",
          [oid, wid, sv, session.actor.userId],
        );
        await tx.query(
          "INSERT INTO entitlement_grants(id,workspace_id,source_order_id,grant_type,starts_at,ends_at,features) VALUES($1,$2,$3,'credits',now(),now()+interval '30 days','{\"creditGrant\":10}')",
          [source, wid, oid],
        );
      });
      const discovery = await call(
        "GET",
        `/v1/admin/orders/${oid}/source-grants`,
      );
      expect(discovery.statusCode, discovery.body).toBe(200);
      expect(discovery.json().data).toMatchObject({
        orderId: oid,
        workspaceId: wid,
        items: [{ id: source, kind: "credits", eligible: true, frozen: false }],
      });
      expect(JSON.stringify(discovery.json())).not.toMatch(
        /secret|locator|original|object_key/,
      );
      expect(
        (await call("GET", `/v1/admin/orders/${id()}/source-grants`))
          .statusCode,
      ).toBe(404);
      const body = {
          kind: "credits",
          sourceGrantId: discovery.json().data.items[0].id,
          creditDelta: 5,
          reason: "工单复核",
          ticketId: "ticket-42",
        },
        headers = {
          "X-Reauthentication-Proof": proof,
          "idempotency-key": operation,
        };
      const a = await call(
        "POST",
        `/v1/admin/workspaces/${wid}/adjustments`,
        body,
        headers,
      );
      expect(a.statusCode, a.body).toBe(201);
      const b = await call(
        "POST",
        `/v1/admin/workspaces/${wid}/adjustments`,
        body,
        headers,
      );
      expect(b.statusCode, b.body).toBe(201);
      expect(b.json().data).toEqual(a.json().data);
      const rows = await db.pool.query(
        "SELECT * FROM ai_album.financial_adjustments",
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]).toMatchObject({
        reason: "工单复核",
        ticket_id: "ticket-42",
      });
      expect(
        (
          await db.pool.query(
            "SELECT source_adjustment_id,source_order_id FROM ai_album.entitlement_grants WHERE id=$1",
            [a.json().data.grantId],
          )
        ).rows[0],
      ).toEqual({
        source_adjustment_id: a.json().data.id,
        source_order_id: null,
      });
      await expect(
        db.pool.query(
          "UPDATE ai_album.financial_adjustments SET reason='changed'",
        ),
      ).rejects.toThrow();
      await db.pool.query(
        "UPDATE ai_album.admin_role_assignments SET revoked_at=now() WHERE user_id=$1",
        [session.actor.userId],
      );
      expect(
        (
          await call(
            "POST",
            `/v1/admin/workspaces/${wid}/adjustments`,
            body,
            headers,
          )
        ).statusCode,
      ).toBe(403);
    });
    it("returns a retrievable redacted difference report under live finance authorization", async () => {
      const proof = "finance-report-proof-" + id();
      await db.database.transaction(async (tx) => {
        await tx.query(
          "UPDATE admin_role_assignments SET revoked_at=NULL WHERE user_id=$1 AND role='finance'",
          [session.actor.userId],
        );
        await tx.query(
          "INSERT INTO reauth_proofs(token_hash,user_id,session_id,purpose,expires_at) VALUES($1,$2,$3,'admin_operations',now()+interval '5 minutes')",
          [
            runtime.auth.hash(proof),
            session.actor.userId,
            session.actor.sessionId,
          ],
        );
      });
      const result = await call(
        "POST",
        "/v1/admin/operations/reconciliations",
        {
          scope: "payments",
          from: "2026-10-24T00:00:00+08:00",
          to: "2026-10-24T23:59:59+08:00",
          reason: "工单 ticket-reconcile 复核",
        },
        { "X-Reauthentication-Proof": proof },
      );
      expect(result.statusCode, result.body).toBe(202);
      expect(result.json().data.reviews).toEqual([
        {
          id: expect.any(String),
          orderId: "missing-local-order",
          paidFen: 123,
          refundedFen: 0,
          localState: "missing",
          localFulfillmentState: "missing",
        },
      ]);
      const fetched = await call(
        "GET",
        `/v1/admin/operations/reconciliations/${result.json().data.id}`,
      );
      expect(fetched.statusCode, fetched.body).toBe(200);
      expect(fetched.json().data).toEqual(result.json().data);
    });
    it("paginates more than 100 SQL rows with stable ties, filters and scoped signed cursors", async () => {
      const foreign = (
        await runtime.workspaces.createWorkspace(session.actor, "studio", id())
      ).workspaceId;
      const sku = (
        await db.pool.query("SELECT id FROM ai_album.sku_versions LIMIT 1")
      ).rows[0].id;
      await db.database.transaction(async (tx) => {
        for (const [space, count, prefix] of [
          [wid, 105, "page-order-"],
          [foreign, 3, "foreign-order-"],
        ] as const)
          await tx.query(
            "INSERT INTO orders(id,workspace_id,sku_version_id,buyer_user_id,amount_fen,state,channel,client_platform,expires_at,created_at) SELECT $1::text||lpad(n::text,3,'0'),$2,$3,$4,123,'pending','wechat_pay','web','2026-10-25T00:00:00Z','2026-10-20T00:00:00Z' FROM generate_series(1,$5) n",
            [prefix, space, sku, session.actor.userId, count],
          );
      });
      const filter = `workspaceId=${wid}&state=pending&from=2026-10-19T00:00:00Z&to=2026-10-21T00:00:00Z&limit=100`;
      const first = await call("GET", `/v1/admin/orders?${filter}`);
      expect(first.statusCode, first.body).toBe(200);
      expect(first.json().data.items).toHaveLength(100);
      expect(first.json().data.hasMore).toBe(true);
      const cursor = first.json().data.nextCursor;
      expect(cursor).toBeTypeOf("string");
      const second = await call(
        "GET",
        `/v1/admin/orders?${filter}&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(second.statusCode, second.body).toBe(200);
      expect(second.json().data.items).toHaveLength(5);
      expect(second.json().data).toMatchObject({
        hasMore: false,
        nextCursor: null,
      });
      const ids = [...first.json().data.items, ...second.json().data.items].map(
        (x) => x.id,
      );
      expect(new Set(ids).size).toBe(105);
      expect(ids.every((x) => x.startsWith("page-order-"))).toBe(true);
      expect(
        (
          await call(
            "GET",
            `/v1/admin/orders?${filter.replace("state=pending", "state=closed")}&cursor=${encodeURIComponent(cursor)}`,
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (await call("GET", `/v1/admin/orders?${filter}&cursor=malformed`))
          .statusCode,
      ).toBe(400);
      const workspacePage = await call(
        "GET",
        `/v1/workspaces/${wid}/orders?limit=100`,
      );
      expect(workspacePage.json().data.hasMore).toBe(true);
      expect(
        workspacePage
          .json()
          .data.items.every((x: any) => x.workspaceId === wid),
      ).toBe(true);
      expect(
        (
          await call(
            "GET",
            `/v1/workspaces/${foreign}/orders?cursor=${encodeURIComponent(workspacePage.json().data.nextCursor)}`,
            undefined,
            { "x-workspace-id": foreign },
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await call(
            "GET",
            `/v1/workspaces/${wid}/jobs?cursor=${encodeURIComponent(workspacePage.json().data.nextCursor)}`,
          )
        ).statusCode,
      ).toBe(400);
    });
  },
);
