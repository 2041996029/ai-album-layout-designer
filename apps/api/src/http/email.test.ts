import { it, expect } from "vitest";
import { testDatabase } from "../../test/database";
import { AuthService } from "../auth/identity";
import { EmailIdentityService } from "../auth/email";
import { WorkspaceService } from "../workspaces/service";
import { createApplication } from "../app.module";
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "email HTTP login sets a secure session and rejects cross-origin sends",
  async () => {
    const db = await testDatabase();
    let code = "";
    const auth = new AuthService(db.database, {
      secret: "email-http-secret-at-least-thirty-two-characters",
      environment: "dev",
    });
    const email = new EmailIdentityService(db.database, auth, {
      secret: "email-http-encryption-at-least-thirty-two-characters",
      sender: {
        send: async (m) => {
          code = m.code;
        },
      },
    });
    const app = await createApplication({
      db: db.database,
      auth,
      email,
      workspaces: new WorkspaceService(db.database, auth),
      environment: "dev",
      allowedOrigin: "https://album.test",
    });
    try {
      const f = app.getHttpAdapter().getInstance();
      const start = await f.inject({
        method: "POST",
        url: "/v1/auth/email/challenges",
        headers: { origin: "https://album.test" },
        payload: { email: "person@example.com", purpose: "login" },
      });
      expect(start.statusCode).toBe(200);
      const login = await f.inject({
        method: "POST",
        url: "/v1/auth/email/login",
        headers: { origin: "https://album.test" },
        payload: { challengeId: start.json().data.id, verificationCode: code },
      });
      expect(login.statusCode).toBe(200);
      expect(login.headers["set-cookie"]).toContain("HttpOnly");
      expect(login.headers["set-cookie"]).toContain("Secure");
      expect(login.json().data.csrfToken).toBeTruthy();
      expect(login.json().data.user.id).toBeTruthy();
      const denied = await f.inject({
        method: "POST",
        url: "/v1/auth/email/challenges",
        headers: { origin: "https://evil.test" },
        payload: { email: "other@example.com", purpose: "login" },
      });
      expect(denied.statusCode).toBe(403);
      const bind = await f.inject({
        method: "POST",
        url: "/v1/auth/email/challenges",
        headers: { origin: "https://album.test" },
        payload: { email: "other@example.com", purpose: "bind" },
      });
      expect(bind.statusCode).toBe(401);
    } finally {
      await app.close();
      await db.close();
    }
  },
  60000,
);
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "explicit mini email linking shares the verified Web account and refuses existing-account merges",
  async () => {
    const db = await testDatabase();
    let code = "";
    const auth = new AuthService(db.database, {
        secret: "link-http-test-secret-at-least-thirty-two",
        environment: "dev",
      }),
      email = new EmailIdentityService(db.database, auth, {
        secret: "link-http-encryption-at-least-thirty-two",
        sender: {
          send: async (m) => {
            code = m.code;
          },
        },
      });
    const wechat = {
      exchange: async (c: string) => ({
        provider: "wechat" as const,
        appId: "mini-app",
        subject: c,
        unionId: null,
        openPlatformId: null,
      }),
    };
    const app = await createApplication({
      db: db.database,
      auth,
      email,
      wechatMini: wechat,
      workspaces: new WorkspaceService(db.database, auth),
      environment: "dev",
      allowedOrigin: "https://album.test",
    });
    try {
      const f = app.getHttpAdapter().getInstance();
      const web = await auth.login(
        {
          exchange: async () => ({
            provider: "email",
            appId: "email",
            subject: "web@example.com",
            unionId: null,
            openPlatformId: null,
          }),
        },
        "web-proof",
        "web",
      );
      const q = await f.inject({
        method: "POST",
        url: "/v1/auth/wechat/mini/email-challenges",
        payload: { email: "web@example.com" },
      });
      expect(q.statusCode).toBe(200);
      const r = await f.inject({
        method: "POST",
        url: "/v1/auth/wechat/mini/link-email",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        payload: {
          challengeId: q.json().data.id,
          verificationCode: code,
          wechatCode: "new-wechat",
        },
      });
      expect(r.statusCode, r.body).toBe(200);
      expect(r.json().data.user.id).toBe(web.actor.userId);
      const replay = await f.inject({
        method: "POST",
        url: "/v1/auth/wechat/mini/link-email",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        payload: {
          challengeId: q.json().data.id,
          verificationCode: code,
          wechatCode: "new-wechat",
        },
      });
      expect(replay.statusCode).toBe(401);
      await auth.login(wechat, "owned-wechat", "mini");
      const other = await f.inject({
        method: "POST",
        url: "/v1/auth/wechat/mini/email-challenges",
        payload: { email: "other@example.com" },
      });
      const conflict = await f.inject({
        method: "POST",
        url: "/v1/auth/wechat/mini/link-email",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        payload: {
          challengeId: other.json().data.id,
          verificationCode: code,
          wechatCode: "owned-wechat",
        },
      });
      expect(conflict.statusCode, conflict.body).toBe(409);
      expect(conflict.json().error.code).toBe("BINDING_CONFLICT");
    } finally {
      await app.close();
      await db.close();
    }
  },
  60000,
);
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "existing mini account binds a new email through actual contract routes with fresh identity and idempotency",
  async () => {
    const { MiniApi } = await import("../../../mini/src/api");
    const { ReauthService } = await import("../auth/reauthentication");
    const { BindingService } = await import("../auth/bindings");
    const db = await testDatabase();
    let code = "",
      sequence = 0;
    const auth = new AuthService(db.database, {
        secret: "mini-binding-http-at-least-thirty-two-characters",
        environment: "dev",
      }),
      email = new EmailIdentityService(db.database, auth, {
        secret: "mini-binding-encryption-at-least-thirty-two",
        sender: {
          send: async (m) => {
            code = m.code;
          },
        },
      });
    const wechat = {
      exchange: async () => ({
        provider: "wechat" as const,
        appId: "mini-app",
        subject: "existing-wx",
        unionId: null,
        openPlatformId: null,
      }),
    };
    const reauth = new ReauthService(db.database, auth, {
      wechat_mini: wechat,
    });
    const app = await createApplication({
      db: db.database,
      auth,
      email,
      wechatMini: wechat,
      proofAdapter: reauth,
      bindings: new BindingService(db.database, auth, reauth, {
        email: email.adapter("bind"),
      }),
      workspaces: new WorkspaceService(db.database, auth),
      environment: "dev",
      allowedOrigin: "https://album.test",
    });
    try {
      const f = app.getHttpAdapter().getInstance(),
        api = new MiniApi({
          baseUrl: "https://album.test/v1",
          workspaceId: "w",
          key: () => `native-binding-test-key-${++sequence}`,
          loginCode: async () => `wx-${++sequence}`,
          transport: async (r) => {
            const response = await f.inject({
              method: r.method,
              url: "/v1" + r.path,
              headers: r.headers,
              ...(r.body ? { payload: r.body } : {}),
            });
            return { status: response.statusCode, body: response.json() };
          },
        });
      const q = await api.currentEmailChallenge("new-binding@example.com");
      await api.bindCurrentEmail(q.id, code);
      const identities = (
        await db.pool.query(
          "SELECT user_id,provider FROM ai_album.auth_identities ORDER BY provider",
        )
      ).rows;
      expect(identities.map((i) => i.provider)).toEqual([
        "email",
        "wechat_mini",
      ]);
      expect(new Set(identities.map((i) => i.user_id)).size).toBe(1);
    } finally {
      await app.close();
      await db.close();
    }
  },
  60000,
);
