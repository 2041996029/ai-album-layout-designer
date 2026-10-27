import { it, expect } from "vitest";
import { aiFixture } from "../../test/ai-fixture";
import { createApplication } from "../app.module";
import { bindCommerceRuntime } from "../commerce/runtime";
import { ReauthService } from "../auth/reauthentication";
import type { ApiRuntime } from "./runtime";
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "license HTTP endpoints enforce contracts, CSRF, roles and stable registration",
  async () => {
    const f = await aiFixture();
    let app: any;
    try {
      const session = await f.auth.createWebSession(f.actor);
      const runtime: ApiRuntime = {
        db: f.database,
        auth: f.auth,
        workspaces: f.workspaces,
        environment: "dev",
        allowedOrigin: "https://album.test",
      };
      await bindCommerceRuntime(
        runtime,
        new ReauthService(f.database, f.auth, {}),
      );
      app = await createApplication(runtime);
      const headers = {
        cookie: `album_session=${session.accessToken}`,
        origin: "https://album.test",
        "x-csrf-token": session.csrfToken,
        "idempotency-key": "license-http-once",
      };
      const input = {
        name: "原创图案",
        source: "original:studio",
        termsVersion: "1",
        commercialAllowed: true,
        embeddingAllowed: false,
        referenceImageAllowed: false,
        territories: ["CN"],
        reason: "登记原创条款",
      };
      const first = await app.inject({
        method: "POST",
        url: "/v1/admin/licenses",
        headers,
        payload: input,
      });
      expect(first.statusCode, first.body).toBe(201);
      expect(first.json().data).toMatchObject({
        name: input.name,
        revision: 1,
      });
      const replay = await app.inject({
        method: "POST",
        url: "/v1/admin/licenses",
        headers,
        payload: input,
      });
      expect(replay.statusCode, replay.body).toBe(201);
      expect(replay.json().data.id).toBe(first.json().data.id);
      const bad = await app.inject({
        method: "POST",
        url: "/v1/admin/licenses",
        headers,
        payload: { ...input, secret: "never-allowed" },
      });
      expect(bad.statusCode).toBe(422);
      const csrf = await app.inject({
        method: "POST",
        url: "/v1/admin/licenses",
        headers: { ...headers, "x-csrf-token": "wrong" },
        payload: input,
      });
      expect(csrf.statusCode).toBe(403);
      const list = await app.inject({
        method: "GET",
        url: "/v1/admin/licenses?limit=1",
        headers,
      });
      expect(list.statusCode, list.body).toBe(200);
      expect(list.json().data.items).toHaveLength(1);
      await f.pool.query(
        "UPDATE ai_album.admin_role_assignments SET revoked_at=clock_timestamp()",
      );
      const denied = await app.inject({
        method: "POST",
        url: "/v1/admin/licenses",
        headers,
        payload: input,
      });
      expect(denied.statusCode).toBe(403);
    } finally {
      await app?.close();
      await f.close();
    }
  },
  60000,
);
