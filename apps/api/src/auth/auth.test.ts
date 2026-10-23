import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { testDatabase } from "../../test/database";
import { AuthService } from "./identity";
const enabled = Boolean(process.env.C3_TEST_DATABASE_URL);
describe.skipIf(!enabled)("C3 verified identities and sessions", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>, auth: AuthService;
  const identity = (
    appId: string,
    subject: string,
    unionId: string | null = null,
  ) => ({
    exchange: async () => ({
      provider: "wechat" as const,
      appId,
      subject,
      unionId,
      openPlatformId: unionId ? "trusted-platform" : null,
    }),
  });
  beforeAll(async () => {
    db = await testDatabase();
    auth = new AuthService(db.database, {
      secret: "local-test-signing-secret-at-least-32-characters",
      environment: "dev",
    });
  }, 60000);
  afterAll(async () => {
    await db?.close();
  });
  it("separates same openid across apps; matches trusted scoped UnionID only", async () => {
    const a = await auth.login(identity("app-a", "open"), "code-a", "mini");
    const b = await auth.login(identity("app-b", "open"), "code-b", "mini");
    expect(a.actor.userId).not.toBe(b.actor.userId);
    const c = await auth.login(
      identity("app-a", "union-a", "union"),
      "code-c",
      "mini",
    );
    const d = await auth.login(
      identity("app-b", "union-b", "union"),
      "code-d",
      "mini",
    );
    expect(c.actor.userId).toBe(d.actor.userId);
    await expect(
      auth.login(identity("app-a", "open"), "code-a", "mini"),
    ).rejects.toThrow("LOGIN_CODE_REPLAY");
  });
  it("revokes the refresh family on replay, including the newly issued session", async () => {
    const a = await auth.login(
      identity("app-a", "refresh"),
      "refresh-code",
      "mini",
    );
    const b = await auth.rotateRefresh(a.refreshToken);
    await expect(auth.rotateRefresh(a.refreshToken)).rejects.toThrow(
      "REFRESH_REUSE",
    );
    await expect(auth.authenticate(b.accessToken, "mini")).rejects.toThrow(
      "UNAUTHORIZED",
    );
  });
  it("binds QR consumption to original browser nonce and consumes once", async () => {
    const a = await auth.login(identity("app-a", "qr-user"), "qr-code", "mini");
    const nonce = "browser-nonce-with-32-characters-12345",
      qr = await auth.beginWebLogin(nonce);
    await auth.confirmWebLogin(a.actor, qr.loginId, qr.confirmToken);
    await expect(
      auth.consumeWebLogin(qr.loginId, "wrong-nonce"),
    ).rejects.toThrow("LOGIN_BROWSER_MISMATCH");
    expect((await auth.consumeWebLogin(qr.loginId, nonce)).userId).toBe(
      a.actor.userId,
    );
    await expect(auth.consumeWebLogin(qr.loginId, nonce)).rejects.toThrow(
      "LOGIN_ALREADY_CONSUMED",
    );
  });
  it("does not bind an identity already owned by another user", async () => {
    const a = await auth.login(
      identity("app-a", "bind-a"),
      "bind-code-a",
      "mini",
    );
    await auth.login(identity("app-a", "bind-b"), "bind-code-b", "mini");
    await expect(
      auth.bind(a.actor, {
        provider: "wechat",
        appId: "app-a",
        subject: "bind-b",
        unionId: null,
        openPlatformId: null,
      }),
    ).rejects.toThrow("BINDING_CONFLICT");
  });
});
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "deletion-only recovery sessions",
  () => {
    it("lets verified deleting identity cancel without granting ordinary resource access", async () => {
      const db = await testDatabase();
      try {
        const auth = new AuthService(db.database, {
            secret: "local-test-signing-secret-at-least-32-characters",
            environment: "dev",
          }),
          adapter = {
            exchange: async () => ({
              provider: "wechat" as const,
              appId: "recover",
              subject: "user",
              unionId: null,
              openPlatformId: null,
            }),
          };
        const first = await auth.login(adapter, "first", "mini");
        await db.database.transaction((tx) =>
          tx.query("UPDATE users SET status='deleting' WHERE id=$1", [
            first.actor.userId,
          ]),
        );
        const recovery = await auth.login(adapter, "second", "mini");
        await expect(
          auth.authenticate(recovery.accessToken, "mini"),
        ).rejects.toThrow("UNAUTHORIZED");
        expect(
          (await auth.authenticateRecovery(recovery.accessToken, "mini"))
            .userId,
        ).toBe(first.actor.userId);
      } finally {
        await db.close();
      }
    });
  },
);
