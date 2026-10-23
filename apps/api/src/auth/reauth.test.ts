import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { testDatabase } from "../../test/database";
import { AuthService } from "./identity";
import { ReauthService, type IdentityProof } from "./reauthentication";
import { id } from "@album/server-core";
describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "fresh identity proof lifecycle in PostgreSQL",
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
    const adapter = (subject: string, appId = "reauth-app") => ({
      exchange: async () => ({
        provider: "wechat" as const,
        appId,
        subject,
        unionId: null,
        openPlatformId: null,
      }),
    });
    const proof = (code = id()): IdentityProof => ({
      provider: "wechat_mini",
      challengeId: id(),
      proof: code,
      purpose: "delete_account",
    });
    it("rejects provider/app/subject mismatch and unconfigured verification", async () => {
      const identity = adapter(id()),
        login = await auth.login(identity, id(), "mini");
      await expect(
        new ReauthService(db.database, auth, {}).verify(
          login.actor,
          proof(),
          "delete_account",
        ),
      ).rejects.toThrow("REAUTH_UNCONFIGURED");
      await expect(
        new ReauthService(db.database, auth, {
          wechat_mini: adapter("other"),
        }).verify(login.actor, proof(), "delete_account"),
      ).rejects.toThrow("REAUTH_IDENTITY_MISMATCH");
      await expect(
        new ReauthService(db.database, auth, {
          wechat_mini: adapter("other", "other-app"),
        }).verify(login.actor, proof(), "delete_account"),
      ).rejects.toThrow("REAUTH_IDENTITY_MISMATCH");
    });
    it("issues one-purpose session-bound hash-only tokens and consumes atomically once", async () => {
      const identity = adapter(id()),
        login = await auth.login(identity, id(), "mini"),
        service = new ReauthService(db.database, auth, {
          wechat_mini: identity,
        }),
        input = proof();
      const result = await service.verify(login.actor, input, "delete_account");
      expect(result.reauthProof.length).toBeGreaterThan(32);
      await expect(
        service.verify(login.actor, input, "delete_account"),
      ).rejects.toThrow("REAUTH_CODE_REPLAY");
      await expect(
        db.database.transaction((tx) =>
          service.verifyFresh(
            login.actor,
            result.reauthProof,
            "privacy_export",
            tx,
          ),
        ),
      ).rejects.toThrow("REAUTH_REQUIRED");
      const attempts = await Promise.allSettled(
        Array.from({ length: 10 }, () =>
          db.database.transaction((tx) =>
            service.verifyFresh(
              login.actor,
              result.reauthProof,
              "delete_account",
              tx,
            ),
          ),
        ),
      );
      expect(attempts.filter((a) => a.status === "fulfilled")).toHaveLength(1);
      const stored = await db.database.transaction((tx) =>
        tx.query("SELECT token_hash FROM reauth_proofs WHERE session_id=$1", [
          login.actor.sessionId,
        ]),
      );
      expect(stored.rows[0].token_hash).not.toBe(result.reauthProof);
    });
    it("cannot reuse a login exchange code or cross sessions; rolled back consumption remains available", async () => {
      const subject = id(),
        identity = adapter(subject),
        code = id(),
        login = await auth.login(identity, code, "mini"),
        service = new ReauthService(db.database, auth, {
          wechat_mini: identity,
        });
      await expect(
        service.verify(login.actor, proof(code), "delete_account"),
      ).rejects.toThrow("REAUTH_CODE_REPLAY");
      const result = await service.verify(
        login.actor,
        proof(),
        "delete_account",
      );
      const second = await auth.login(identity, id(), "mini");
      await expect(
        db.database.transaction((tx) =>
          service.verifyFresh(
            second.actor,
            result.reauthProof,
            "delete_account",
            tx,
          ),
        ),
      ).rejects.toThrow("REAUTH_REQUIRED");
      await expect(
        db.database.transaction(async (tx) => {
          await service.verifyFresh(
            login.actor,
            result.reauthProof,
            "delete_account",
            tx,
          );
          throw Error("ROLLBACK");
        }),
      ).rejects.toThrow("ROLLBACK");
      await db.database.transaction((tx) =>
        service.freshProofVerifier.verify(
          login.actor,
          result.reauthProof,
          "account_deletion",
          tx,
        ),
      );
    });
    it("rejects expired proofs and mismatched purposes", async () => {
      const identity = adapter(id()),
        login = await auth.login(identity, id(), "mini"),
        service = new ReauthService(db.database, auth, {
          wechat_mini: identity,
        });
      await expect(
        service.verify(login.actor, proof(), "privacy_export"),
      ).rejects.toThrow("REAUTH_INVALID");
      const result = await service.verify(
        login.actor,
        proof(),
        "delete_account",
      );
      await db.database.transaction((tx) =>
        tx.query(
          "UPDATE reauth_proofs SET created_at=now()-interval '10 minutes',expires_at=now()-interval '6 minutes' WHERE token_hash=$1",
          [auth.hash(result.reauthProof)],
        ),
      );
      await expect(
        db.database.transaction((tx) =>
          service.verifyFresh(
            login.actor,
            result.reauthProof,
            "delete_account",
            tx,
          ),
        ),
      ).rejects.toThrow("REAUTH_REQUIRED");
    });
  },
);
