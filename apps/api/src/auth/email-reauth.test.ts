import { it, expect } from "vitest";
import { testDatabase } from "../../test/database";
import { AuthService } from "./identity";
import { EmailIdentityService } from "./email";
import { emailHumanAdapter } from "./email-human";
import { ReauthService } from "./reauthentication";
it.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "email step-up binds one operation proof to the original session and commits invalid attempts",
  async () => {
    const db = await testDatabase();
    let code = "";
    try {
      const auth = new AuthService(db.database, {
          secret: "email-stepup-test-secret-at-least-thirty-two",
          environment: "dev",
        }),
        email = new EmailIdentityService(db.database, auth, {
          secret: "email-stepup-encryption-test-thirty-two-chars",
          sender: {
            send: async (m) => {
              code = m.code;
            },
          },
        });
      const q = await email.start(
        "stepup@example.com",
        "login",
        undefined,
        "source",
      );
      const session = await auth.login(
        email.adapter("login"),
        JSON.stringify({ challengeId: q.id, code }),
        "web",
      );
      const reauth = new ReauthService(
        db.database,
        auth,
        {},
        emailHumanAdapter(email),
      );
      expect(await reauth.availability(session.actor)).toEqual({
        state: "available",
        method: "email",
      });
      // A separate destination is unnecessary: the test clock advances to clear the send cooldown.
      await db.pool.query(
        "UPDATE ai_album.email_challenges SET created_at=created_at-interval '2 minutes' WHERE id=$1",
        [q.id],
      );
      const c = await reauth.start(session.actor, "bind", "stepup-start");
      await expect(
        reauth.verify(
          session.actor,
          {
            provider: "email",
            challengeId: c.id,
            proof: "000000" === code ? "111111" : "000000",
            purpose: "bind",
          },
          "bind",
        ),
      ).rejects.toThrow("EMAIL_CODE_INVALID");
      expect(
        Number(
          (
            await db.pool.query(
              "SELECT attempts FROM ai_album.email_challenges WHERE id=$1",
              [c.id],
            )
          ).rows[0].attempts,
        ),
      ).toBe(1);
      const result = await reauth.verify(
        session.actor,
        { provider: "email", challengeId: c.id, proof: code, purpose: "bind" },
        "bind",
      );
      await db.database.transaction((tx) =>
        reauth.verifyFresh(session.actor, result.reauthProof, "bind", tx),
      );
      await expect(
        db.database.transaction((tx) =>
          reauth.verifyFresh(session.actor, result.reauthProof, "bind", tx),
        ),
      ).rejects.toThrow("REAUTH_REQUIRED");
    } finally {
      await db.close();
    }
  },
  60000,
);
