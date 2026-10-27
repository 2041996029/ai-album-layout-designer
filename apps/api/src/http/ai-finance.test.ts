import { it, expect } from "vitest";
import { id } from "@album/server-core";
import { aiFixture } from "../../test/ai-fixture";
import { createApplication } from "../app.module";
import { bindCommerceRuntime } from "../commerce/runtime";
import { ReauthService } from "../auth/reauthentication";
import type { ApiRuntime } from "./runtime";
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "AI finance HTTP consumes real session-bound proofs and returns canonical immutable pricing and budgets",
  async () => {
    const f = await aiFixture();
    let app: any;
    try {
      const session = await f.auth.createWebSession(f.actor);
      const reauth = new ReauthService(f.database, f.auth, {
        email: {
          exchange: async () => ({
            provider: "email",
            appId: "email",
            subject: "ai-test@example.com",
            unionId: null,
            openPlatformId: null,
          }),
        },
      });
      const proof = async () =>
        (
          await reauth.verify(
            session.actor,
            {
              provider: "email",
              challengeId: id(),
              proof: id(),
              purpose: "admin_operations",
            },
            "admin_operations",
          )
        ).reauthProof;
      const runtime: ApiRuntime = {
        db: f.database,
        auth: f.auth,
        workspaces: f.workspaces,
        environment: "dev",
        allowedOrigin: "https://album.test",
      };
      await bindCommerceRuntime(runtime, reauth);
      app = await createApplication(runtime);
      const headers = {
        cookie: `album_session=${session.accessToken}`,
        origin: "https://album.test",
        "x-csrf-token": session.csrfToken,
        "idempotency-key": id(),
        "x-reauthentication-proof": await proof(),
      };
      const input = {
        name: "测试版水墨",
        creditsPerImage: 3,
        estimatedProviderCostFen: 12,
        maxCostFen: 15,
        reason: "Approve test pricing",
      };
      const created = await app.inject({
        method: "POST",
        url: "/v1/admin/ai/cost-rules",
        headers,
        payload: input,
      });
      expect(created.statusCode, created.body).toBe(201);
      expect(created.json().data).toMatchObject({
        name: input.name,
        version: 1,
        creditsPerImage: 3,
      });
      const replay = await app.inject({
        method: "POST",
        url: "/v1/admin/ai/cost-rules",
        headers,
        payload: input,
      });
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.json().data.id).toBe(created.json().data.id);
      const list = await app.inject({
        method: "GET",
        url: "/v1/admin/ai/budgets?limit=1",
        headers,
      });
      expect(list.statusCode, list.body).toBe(200);
      expect(list.json().data.items[0].dailyBudgetFen).toBe(100);
      const budgetHeaders = {
        ...headers,
        "idempotency-key": id(),
        "x-reauthentication-proof": await proof(),
        "if-match": '"1"',
      };
      const changed = await app.inject({
        method: "PUT",
        url: `/v1/admin/ai/budgets/${f.ids.account}`,
        headers: budgetHeaders,
        payload: { dailyBudgetFen: 20, state: "active", reason: "Set cap" },
      });
      expect(changed.statusCode, changed.body).toBe(200);
      expect(changed.json().data).toMatchObject({
        dailyBudgetFen: 20,
        revision: 2,
        reservedFen: 0,
        spentFen: 0,
      });
      const fractional = await app.inject({
        method: "POST",
        url: "/v1/admin/ai/cost-rules",
        headers: { ...headers, "idempotency-key": id() },
        payload: { ...input, creditsPerImage: 1.5 },
      });
      expect(fractional.statusCode).toBe(422);
    } finally {
      await app?.close();
      await f.close();
    }
  },
  60000,
);
