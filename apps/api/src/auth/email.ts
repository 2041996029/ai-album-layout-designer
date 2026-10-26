import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { type Actor, type Database, fail, id } from "@album/server-core";
import type { AuthService } from "./identity";
import type { IdentityAdapter } from "./types";
export type EmailPurpose = "login" | "bind" | "reauth" | "link_wechat";
export interface EmailSender {
  send(message: {
    to: string;
    code: string;
    purpose: EmailPurpose;
  }): Promise<void>;
}
export function normalizeEmail(value: string) {
  const email = value.trim().toLowerCase();
  if (
    email.length > 254 ||
    !/^\S+@[^\s@]+\.[^\s@]+$/.test(email) ||
    /[\r\n\0]/.test(email)
  )
    fail("EMAIL_INVALID", 422);
  return email;
}
export class EmailIdentityService {
  private key: Buffer;
  constructor(
    private db: Database,
    private auth: AuthService,
    private options: {
      secret: string;
      sender: EmailSender;
      now?: () => number;
    },
  ) {
    if (options.secret.length < 32) fail("EMAIL_SECRET_REQUIRED", 503);
    this.key = createHash("sha256").update(options.secret).digest();
  }
  private now() {
    return this.options.now?.() ?? Date.now();
  }
  private encrypt(value: string) {
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.key, iv);
    return Buffer.concat([
      iv,
      c.update(value, "utf8"),
      c.final(),
      c.getAuthTag(),
    ]).toString("base64url");
  }
  private decrypt(value: string) {
    const b = Buffer.from(value, "base64url"),
      c = createDecipheriv("aes-256-gcm", this.key, b.subarray(0, 12));
    c.setAuthTag(b.subarray(-16));
    return Buffer.concat([c.update(b.subarray(12, -16)), c.final()]).toString();
  }
  async start(
    raw: string,
    purpose: EmailPurpose,
    actor?: Actor,
    source = "unknown",
    challengeId: string = id(),
  ) {
    const email = normalizeEmail(raw),
      now = this.now(),
      digest = this.auth.hash(email),
      sourceDigest = this.auth.hash("email-source:" + source);
    if (!["login", "link_wechat"].includes(purpose) && !actor)
      fail("UNAUTHORIZED", 401);
    const code = String(randomInt(1000000)).padStart(6, "0");
    await this.db.transaction(async (tx) => {
      if (actor) await this.auth.assertActor(tx, actor);
      for (const lock of [digest, sourceDigest].sort())
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          "email:" + lock,
        ]);
      const recent = await tx.query(
        "SELECT count(*) FILTER (WHERE destination_digest=$1 AND created_at>$3::timestamptz-interval '60 seconds')::int AS cooldown,count(*) FILTER(WHERE destination_digest=$1)::int AS mailbox,count(*) FILTER(WHERE source_digest=$2)::int AS source FROM email_challenges WHERE created_at>$3::timestamptz-interval '1 hour'",
        [digest, sourceDigest, new Date(now)],
      );
      const limits = recent.rows[0];
      if (limits.cooldown || limits.mailbox >= 10 || limits.source >= 30)
        fail("EMAIL_RATE_LIMITED", 429);
      await tx.query(
        "INSERT INTO email_challenges(id,destination_digest,destination_cipher,source_digest,purpose,session_id,code_digest,created_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          challengeId,
          digest,
          this.encrypt(email),
          sourceDigest,
          purpose,
          actor?.sessionId ?? null,
          this.auth.hash("email-code:" + challengeId + ":" + code),
          new Date(now),
          new Date(now + 300000),
        ],
      );
    });
    try {
      await this.options.sender.send({ to: email, code, purpose });
    } catch {
      fail("EMAIL_DELIVERY_UNAVAILABLE", 503);
    }
    await this.db.transaction((tx) =>
      tx.query("UPDATE email_challenges SET delivered=true WHERE id=$1", [
        challengeId,
      ]),
    );
    return {
      id: challengeId,
      expiresAt: new Date(now + 300000).toISOString(),
      retryAfterSeconds: 60,
      destinationHint: email.slice(0, 1) + "***@" + email.split("@")[1],
    };
  }
  adapter(purpose: EmailPurpose): IdentityAdapter {
    return {
      exchange: async (proof, _redirect, context) => {
        let input: any;
        try {
          input = JSON.parse(proof);
        } catch {
          fail("EMAIL_CODE_INVALID", 401);
        }
        if (
          typeof input.challengeId !== "string" ||
          typeof input.code !== "string"
        )
          fail("EMAIL_CODE_INVALID", 401);
        const result = await this.db.transaction(async (tx) => {
          const q = (
            await tx.query(
              "SELECT * FROM email_challenges WHERE id=$1 FOR UPDATE",
              [input.challengeId],
            )
          ).rows[0];
          if (
            !q ||
            !q.delivered ||
            q.consumed_at ||
            q.attempts >= 5 ||
            q.purpose !== purpose ||
            new Date(q.expires_at).getTime() <= this.now() ||
            (!["login", "link_wechat"].includes(purpose) &&
              (!context?.actor || q.session_id !== context.actor.sessionId))
          )
            return null;
          if (context?.actor) await this.auth.assertActor(tx, context.actor);
          const expected = this.auth.hash(
            "email-code:" + q.id + ":" + input.code,
          );
          if (
            !/^\d{6}$/.test(input.code) ||
            !timingSafeEqual(Buffer.from(expected), Buffer.from(q.code_digest))
          ) {
            await tx.query(
              "UPDATE email_challenges SET attempts=attempts+1 WHERE id=$1",
              [q.id],
            );
            return null;
          }
          await tx.query(
            "UPDATE email_challenges SET consumed_at=$2 WHERE id=$1",
            [q.id, new Date(this.now())],
          );
          await tx.query(
            "INSERT INTO email_destinations(destination_digest,destination_cipher) VALUES($1,$2) ON CONFLICT(destination_digest) DO UPDATE SET destination_cipher=excluded.destination_cipher",
            [q.destination_digest, q.destination_cipher],
          );
          return this.decrypt(q.destination_cipher);
        });
        if (!result) fail("EMAIL_CODE_INVALID", 401);
        return {
          provider: "email",
          appId: "email",
          subject: result,
          unionId: null,
          openPlatformId: null,
        };
      },
    };
  }
  async linkedDestination(actor: Actor) {
    return this.db.transaction(async (tx) => {
      await this.auth.assertActor(tx, actor);
      const row = (
        await tx.query(
          "SELECT d.destination_cipher FROM auth_identities i JOIN email_destinations d ON d.destination_digest=i.subject_digest WHERE i.user_id=$1 AND i.provider='email' AND i.revoked_at IS NULL",
          [actor.userId],
        )
      ).rows[0];
      if (!row) fail("REAUTH_IDENTITY_UNAVAILABLE", 503);
      return this.decrypt(row.destination_cipher);
    });
  }
}
