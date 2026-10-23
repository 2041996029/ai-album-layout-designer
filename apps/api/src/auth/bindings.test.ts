import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { testDatabase } from "../../test/database";
import { AuthService } from "./identity";
import { ReauthService, type IdentityProof } from "./reauthentication";
import { BindingService } from "./bindings";
import { id } from "@album/server-core";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "verified binding lifecycle on PostgreSQL",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>, auth: AuthService;
    beforeAll(async () => {
      db = await testDatabase();
      auth = new AuthService(db.database, {
        secret: "x".repeat(40),
        environment: "dev",
      });
    }, 60000);
    afterAll(async () => {
      await db?.close();
    });
    const adapter = (subject: string) => ({
      exchange: async () => ({
        provider: "wechat" as const,
        appId: "bindings",
        subject,
        unionId: null,
        openPlatformId: null,
      }),
    });
    const input = (purpose: "bind" | "unbind"): IdentityProof => ({
      provider: "wechat_mini",
      challengeId: id(),
      proof: id(),
      purpose,
    });
    it("requires actual configured target verification", async () => {
      const source = adapter(id()),
        login = await auth.login(source, id(), "mini"),
        reauth = new ReauthService(db.database, auth, { wechat_mini: source }),
        fresh = await reauth.verify(login.actor, input("bind"), "bind");
      await expect(
        new BindingService(db.database, auth, reauth).create(login.actor, {
          proof: input("bind"),
          reauthProof: fresh.reauthProof,
        }),
      ).rejects.toThrow("BINDING_UNCONFIGURED");
    });
    it("adds a verified unowned identity, idempotently replays, and protects the final login identity", async () => {
      const source = adapter(id()),
        login = await auth.login(source, id(), "mini"),
        reauth = new ReauthService(db.database, auth, { wechat_mini: source }),
        service = new BindingService(db.database, auth, reauth, {
          wechat_mini: adapter(id()),
        });
      const fresh = await reauth.verify(login.actor, input("bind"), "bind"),
        request = { proof: input("bind"), reauthProof: fresh.reauthProof },
        key = id();
      const binding = await service.create(login.actor, request, key);
      expect(await service.create(login.actor, request, key)).toEqual(binding);
      expect(await service.list(login.actor)).toHaveLength(2);
      const unbind = await reauth.verify(
        login.actor,
        input("unbind"),
        "unbind",
      );
      await service.remove(login.actor, binding.id, {
        reauthProof: unbind.reauthProof,
        remainingLoginMethodAcknowledged: true,
      });
      const remaining = await service.list(login.actor);
      expect(remaining).toHaveLength(1);
      const last = await reauth.verify(login.actor, input("unbind"), "unbind");
      await expect(
        service.remove(login.actor, remaining[0]!.id, {
          reauthProof: last.reauthProof,
          remainingLoginMethodAcknowledged: true,
        }),
      ).rejects.toThrow("LAST_LOGIN_METHOD");
    });
    it("rejects identity owned by another account without merging either account", async () => {
      const source = adapter(id()),
        other = adapter(id()),
        login = await auth.login(source, id(), "mini"),
        second = await auth.login(other, id(), "mini"),
        reauth = new ReauthService(db.database, auth, { wechat_mini: source }),
        service = new BindingService(db.database, auth, reauth, {
          wechat_mini: other,
        }),
        fresh = await reauth.verify(login.actor, input("bind"), "bind");
      await expect(
        service.create(login.actor, {
          proof: input("bind"),
          reauthProof: fresh.reauthProof,
        }),
      ).rejects.toThrow("BINDING_CONFLICT");
      expect(await service.list(login.actor)).toHaveLength(1);
      expect(await service.list(second.actor)).toHaveLength(1);
    });
  },
);
