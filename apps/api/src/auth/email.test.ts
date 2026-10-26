import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { testDatabase } from "../../test/database";
import { AuthService } from "./identity";
import { EmailIdentityService } from "./email";
import { WechatMiniAdapter } from "./wechat";
describe("official WeChat identity", () => {
  it("exchanges only server-owned app credentials and discards session key", async () => {
    let requested = "";
    const adapter = new WechatMiniAdapter({
      appId: "wx-app",
      appSecret: "server-secret",
      fetch: async (url: any) => {
        requested = String(url);
        return new Response(
          JSON.stringify({
            openid: "verified-open",
            session_key: "never-return",
          }),
        );
      },
    });
    expect(await adapter.exchange("one-use-code", null)).toEqual({
      provider: "wechat",
      appId: "wx-app",
      subject: "verified-open",
      unionId: null,
      openPlatformId: null,
    });
    expect(new URL(requested).searchParams.get("js_code")).toBe("one-use-code");
  });
  it("rejects provider error and transport failures without leaking provider data", async () => {
    const a = new WechatMiniAdapter({
      appId: "wx",
      appSecret: "secret",
      fetch: async () =>
        new Response(JSON.stringify({ errcode: 40029, errmsg: "private" })),
    });
    await expect(a.exchange("bad", null)).rejects.toThrow(
      "WECHAT_LOGIN_FAILED",
    );
  });
});
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "verified email challenges",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      auth: AuthService,
      service: EmailIdentityService;
    const sent: Array<{ to: string; code: string }> = [];
    let now = Date.now();
    beforeAll(async () => {
      db = await testDatabase();
      auth = new AuthService(db.database, {
        secret: "test-email-secret-at-least-thirty-two-characters",
        environment: "dev",
      });
      service = new EmailIdentityService(db.database, auth, {
        secret: "test-encryption-secret-at-least-thirty-two-characters",
        sender: {
          send: async (m) => {
            sent.push(m);
          },
        },
        now: () => now,
      });
    }, 60000);
    afterAll(async () => {
      await db?.close();
    });
    it("logs in with a normalized verified mailbox; stores ciphertext and consumes once concurrently", async () => {
      const q = await service.start(
        " User@Example.com ",
        "login",
        undefined,
        "ip-a",
      );
      const code = sent.at(-1)!.code;
      const proof = JSON.stringify({ challengeId: q.id, code });
      const results = await Promise.allSettled([
        auth.login(service.adapter("login"), proof, "web"),
        auth.login(service.adapter("login"), proof, "web"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const row = (
        await db.pool.query("SELECT provider FROM ai_album.auth_identities")
      ).rows[0];
      expect(row.provider).toBe("email");
      const stored = (
        await db.pool.query(
          "SELECT destination_cipher FROM ai_album.email_challenges WHERE id=$1",
          [q.id],
        )
      ).rows[0];
      expect(stored.destination_cipher).not.toContain("example.com");
    });
    it("retains failed attempts and rejects correct code after five guesses", async () => {
      const q = await service.start(
        "guess@example.com",
        "login",
        undefined,
        "ip-b",
      );
      for (let i = 0; i < 5; i++)
        await expect(
          service
            .adapter("login")
            .exchange(
              JSON.stringify({ challengeId: q.id, code: "invalid" }),
              null,
            ),
        ).rejects.toThrow("EMAIL_CODE_INVALID");
      await expect(
        service
          .adapter("login")
          .exchange(
            JSON.stringify({ challengeId: q.id, code: sent.at(-1)!.code }),
            null,
          ),
      ).rejects.toThrow("EMAIL_CODE_INVALID");
      expect(
        Number(
          (
            await db.pool.query(
              "SELECT attempts FROM ai_album.email_challenges WHERE id=$1",
              [q.id],
            )
          ).rows[0].attempts,
        ),
      ).toBe(5);
    });
    it("enforces expiry, purpose and mailbox cooldown", async () => {
      const q = await service.start(
        "expiry@example.com",
        "login",
        undefined,
        "ip-c",
      );
      const proof = JSON.stringify({
        challengeId: q.id,
        code: sent.at(-1)!.code,
      });
      await expect(
        service.start("expiry@example.com", "login", undefined, "ip-d"),
      ).rejects.toThrow("EMAIL_RATE_LIMITED");
      await expect(
        service.adapter("bind").exchange(proof, null),
      ).rejects.toThrow("EMAIL_CODE_INVALID");
      now += 300001;
      await expect(
        service.adapter("login").exchange(proof, null),
      ).rejects.toThrow("EMAIL_CODE_INVALID");
    });
    it("requires authenticated session context for binding challenges", async () => {
      await expect(
        service.start("bind@example.com", "bind", undefined, "ip-e"),
      ).rejects.toThrow("UNAUTHORIZED");
    });
  },
);
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "active email/WeChat linking",
  () => {
    it("retains one account across email Web and newly verified mini identity; conflicts never merge", async () => {
      const db = await testDatabase();
      try {
        const auth = new AuthService(db.database, {
          secret: "active-link-test-secret-at-least-thirty-two",
          environment: "dev",
        });
        const a = await auth.login(
          {
            exchange: async () => ({
              provider: "email",
              appId: "email",
              subject: "a@example.com",
              unionId: null,
              openPlatformId: null,
            }),
          },
          "email-proof-a",
          "mini",
        );
        await auth.bind(a.actor, {
          provider: "wechat",
          appId: "mini",
          subject: "new-openid",
          unionId: null,
          openPlatformId: null,
        });
        const mini = await auth.login(
          {
            exchange: async () => ({
              provider: "wechat",
              appId: "mini",
              subject: "new-openid",
              unionId: null,
              openPlatformId: null,
            }),
          },
          "wechat-code-a",
          "mini",
        );
        expect(mini.actor.userId).toBe(a.actor.userId);
        const other = await auth.login(
          {
            exchange: async () => ({
              provider: "email",
              appId: "email",
              subject: "b@example.com",
              unionId: null,
              openPlatformId: null,
            }),
          },
          "email-proof-b",
          "mini",
        );
        await expect(
          auth.bind(other.actor, {
            provider: "wechat",
            appId: "mini",
            subject: "new-openid",
            unionId: null,
            openPlatformId: null,
          }),
        ).rejects.toThrow("BINDING_CONFLICT");
      } finally {
        await db.close();
      }
    });
  },
);
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "fresh dual identity binding restores only a revoked identity owned by the same account",
  async () => {
    const db = await testDatabase();
    try {
      const auth = new AuthService(db.database, {
          secret: "restore-binding-thirty-two-character-secret",
          environment: "dev",
        }),
        v = {
          provider: "wechat" as const,
          appId: "mini",
          subject: "restore-openid",
          unionId: null,
          openPlatformId: null,
        };
      const a = await auth.login(
        {
          exchange: async () => ({
            provider: "email",
            appId: "email",
            subject: "restore@example.com",
            unionId: null,
            openPlatformId: null,
          }),
        },
        "restore-email",
        "mini",
      );
      await auth.bind(a.actor, v);
      await db.pool.query(
        "UPDATE ai_album.auth_identities SET revoked_at=now() WHERE provider='wechat_mini'",
      );
      await auth.bind(a.actor, v);
      expect(
        (
          await db.pool.query(
            "SELECT revoked_at FROM ai_album.auth_identities WHERE provider='wechat_mini'",
          )
        ).rows[0].revoked_at,
      ).toBeNull();
      const b = await auth.login(
        {
          exchange: async () => ({
            provider: "email",
            appId: "email",
            subject: "other-restore@example.com",
            unionId: null,
            openPlatformId: null,
          }),
        },
        "other-restore-email",
        "mini",
      );
      await db.pool.query(
        "UPDATE ai_album.auth_identities SET revoked_at=now() WHERE provider='wechat_mini'",
      );
      await expect(auth.bind(b.actor, v)).rejects.toThrow("BINDING_CONFLICT");
    } finally {
      await db.close();
    }
  },
);
