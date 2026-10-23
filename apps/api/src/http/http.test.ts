import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { testDatabase } from "../../test/database";
import { createApplication } from "../app.module";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "C3 real contract HTTP",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      app: any,
      auth: AuthService,
      session: any;
    beforeAll(async () => {
      db = await testDatabase();
      auth = new AuthService(db.database, {
        secret: "local-test-signing-secret-at-least-32-characters",
        environment: "dev",
      });
      session = await auth.login(
        {
          exchange: async () => ({
            provider: "wechat",
            appId: "http",
            subject: "http-user",
            unionId: null,
            openPlatformId: null,
          }),
        },
        "http-code",
        "mini",
      );
      app = await createApplication({
        db: db.database,
        auth,
        workspaces: new WorkspaceService(db.database, auth),
        environment: "dev",
        allowedOrigin: "https://album.test",
        qrPayload: async (qid, token) =>
          "https://album.test/confirm/" + qid + "?scene=" + token,
      });
    }, 60000);
    afterAll(async () => {
      await app?.close();
      await db?.close();
    });
    it("reports unavailable integrations without exposing credentials", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/v1/capabilities?platform=web",
      });
      expect(r.statusCode).toBe(200);
      expect(
        r
          .json()
          .data.capabilities.some(
            (c: any) => c.key === "wechatLogin" && c.status === "unconfigured",
          ),
      ).toBe(true);
      expect(r.body).not.toContain("secret");
    });
    it("authenticates bearer writes and enforces strict contract payloads", async () => {
      const headers = {
        authorization: `Bearer ${session.accessToken}`,
        "idempotency-key": "http-workspace-key-at-least-16",
      };
      const r = await app.inject({
        method: "POST",
        url: "/v1/workspaces",
        headers,
        payload: { kind: "personal", name: "云相册" },
      });
      expect(r.statusCode, r.body).toBe(201);
      expect(r.json().data).toMatchObject({ name: "云相册", role: "owner" });
      const bad = await app.inject({
        method: "POST",
        url: "/v1/workspaces",
        headers,
        payload: { kind: "personal", name: "云相册", env: "prod" },
      });
      expect(bad.statusCode).toBe(422);
    });
    it("rejects unauthenticated and csrf-less cookie mutations", async () => {
      expect(
        (await app.inject({ method: "GET", url: "/v1/workspaces" })).statusCode,
      ).toBe(401);
      const web = await auth.createWebSession(session.actor);
      const r = await app.inject({
        method: "POST",
        url: "/v1/workspaces",
        headers: {
          cookie: `album_session=${web.accessToken}`,
          origin: "https://album.test",
          "idempotency-key": "csrf-test-key-at-least-16",
        },
        payload: { kind: "studio", name: "影楼" },
      });
      expect(r.statusCode).toBe(403);
      const okay = await app.inject({
        method: "POST",
        url: "/v1/workspaces",
        headers: {
          cookie: `album_session=${web.accessToken}`,
          origin: "https://album.test",
          "x-csrf-token": web.csrfToken,
          "idempotency-key": "csrf-test-key-at-least-16",
        },
        payload: { kind: "studio", name: "影楼" },
      });
      expect(okay.statusCode, okay.body).toBe(201);
    });
    it("binds QR exchange to original browser cookie, nonce and one-use proof", async () => {
      const nonce = "original-browser-nonce-32-characters-12345",
        headers = {
          origin: "https://album.test",
          "idempotency-key": "create-qr-at-least-16-characters",
        };
      const created = await app.inject({
        method: "POST",
        url: "/v1/auth/web/qr-sessions",
        headers,
        payload: { browserNonce: nonce },
      });
      expect(created.statusCode, created.body).toBe(201);
      const qr = created.json().data,
        cookie = created.cookies
          .map((c: any) => c.name + "=" + c.value)
          .join("; "),
        sceneToken = new URL(qr.qrPayload).searchParams.get("scene");
      const confirmed = await app.inject({
        method: "POST",
        url: `/v1/auth/web/qr-sessions/${qr.id}/confirm`,
        headers: {
          authorization: `Bearer ${session.accessToken}`,
          "idempotency-key": "confirm-qr-at-least-16-characters",
        },
        payload: { sceneToken, confirmation: true },
      });
      expect(confirmed.statusCode, confirmed.body).toBe(200);
      const polled = await app.inject({
        method: "GET",
        url: `/v1/auth/web/qr-sessions/${qr.id}`,
        headers: {
          cookie,
          "x-qr-poll-token": qr.pollToken,
          "x-browser-nonce": nonce,
        },
      });
      expect(polled.statusCode, polled.body).toBe(200);
      const proof = polled.json().data.consumeProof;
      const request = {
        method: "POST",
        url: `/v1/auth/web/qr-sessions/${qr.id}/consume`,
        headers: {
          cookie,
          origin: "https://album.test",
          "x-qr-poll-token": qr.pollToken,
          "idempotency-key": "consume-qr-at-least-16-chars",
        },
        payload: { browserNonce: nonce, consumeProof: proof },
      };
      const wrong = await app.inject({
        ...request,
        headers: { ...request.headers, cookie: "" },
      });
      expect(wrong.statusCode).toBe(403);
      const consumed = await app.inject(request);
      expect(consumed.statusCode, consumed.body).toBe(200);
      expect(
        consumed.cookies.find((c: any) => c.name === "album_session"),
      ).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax" });
      expect((await app.inject(request)).statusCode).toBe(200);
      expect(
        (
          await app.inject({
            ...request,
            headers: {
              ...request.headers,
              "idempotency-key": "different-consume-key-16",
            },
          })
        ).statusCode,
      ).toBe(409);
    });
  },
);
