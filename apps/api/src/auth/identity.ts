import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import {
  type Database,
  type Actor,
  fail,
  id,
  runIdempotent,
} from "@album/server-core";
import type { IdentityAdapter, VerifiedIdentity } from "./types";
export class AuthService {
  constructor(
    public db: Database,
    private options: {
      secret: string;
      environment: "dev" | "staging" | "prod";
    },
  ) {
    if (options.secret.length < 32) fail("AUTH_SECRET_REQUIRED", 503);
  }
  hash(value: string) {
    return createHmac("sha256", this.options.secret)
      .update(value)
      .digest("hex");
  }
  private provider(v: VerifiedIdentity, client: "web" | "mini") {
    return v.provider === "sms"
      ? "phone"
      : client === "mini"
        ? "wechat_mini"
        : "wechat_web";
  }
  private access(
    sessionId: string,
    client: "web" | "mini",
    exp = Date.now() + (client === "web" ? 7 * 86400000 : 15 * 60000),
  ) {
    const payload = Buffer.from(
      JSON.stringify({ sid: sessionId, client, exp }),
    ).toString("base64url");
    return payload + "." + this.hash(payload);
  }
  private async session(
    tx: PoolClient,
    userId: string,
    client: "web" | "mini",
    previous: string | null = null,
  ) {
    const sid = id(),
      refreshToken = randomBytes(40).toString("base64url"),
      csrfToken = this.hash("csrf:" + sid);
    await tx.query(
      `INSERT INTO auth_sessions(id,user_id,client_kind,refresh_hash,csrf_hash,expires_at,rotated_from_id) VALUES($1,$2,$3,$4,$5,now()+interval '7 days',$6)`,
      [
        sid,
        userId,
        client,
        this.hash(refreshToken),
        this.hash(csrfToken),
        previous,
      ],
    );
    return {
      actor: {
        userId,
        sessionId: sid,
        client,
        platformPermissions: [],
      } as Actor,
      accessToken: this.access(sid, client),
      refreshToken,
      csrfToken,
    };
  }
  async assertActor(tx: PoolClient, actor: Actor) {
    const { rows } = await tx.query(
      `SELECT s.user_id FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.client_kind=$3 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='active' FOR SHARE OF s,u`,
      [actor.sessionId, actor.userId, actor.client],
    );
    if (!rows.length) fail("UNAUTHORIZED", 401);
  }
  async authenticate(token: string, client: "web" | "mini"): Promise<Actor> {
    const [payload, signature, ...rest] = token.split(".");
    if (
      !payload ||
      !signature ||
      rest.length ||
      !/^[0-9a-f]{64}$/.test(signature)
    )
      fail("UNAUTHORIZED", 401);
    const expected = Buffer.from(this.hash(payload));
    if (!timingSafeEqual(expected, Buffer.from(signature)))
      fail("UNAUTHORIZED", 401);
    let value: any;
    try {
      value = JSON.parse(Buffer.from(payload, "base64url").toString());
    } catch {
      fail("UNAUTHORIZED", 401);
    }
    if (
      value.client !== client ||
      typeof value.exp !== "number" ||
      value.exp <= Date.now()
    )
      fail("UNAUTHORIZED", 401);
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        "SELECT user_id FROM auth_sessions WHERE id=$1",
        [value.sid],
      );
      if (!rows[0]) fail("UNAUTHORIZED", 401);
      const actor: Actor = {
        userId: rows[0].user_id,
        sessionId: value.sid,
        client,
        platformPermissions: [],
      };
      await this.assertActor(tx, actor);
      return actor;
    });
  }
  async assertRecoveryActor(tx: PoolClient, actor: Actor) {
    const { rows } = await tx.query(
      `SELECT s.id FROM auth_sessions s JOIN c3_recovery_sessions r ON r.session_id=s.id JOIN users u ON u.id=s.user_id WHERE s.id=$1 AND s.user_id=$2 AND s.client_kind=$3 AND s.revoked_at IS NULL AND s.expires_at>now() AND u.status='deleting' FOR SHARE OF s,u`,
      [actor.sessionId, actor.userId, actor.client],
    );
    if (!rows.length) fail("UNAUTHORIZED", 401);
  }
  async authenticateRecovery(
    token: string,
    client: "web" | "mini",
  ): Promise<Actor> {
    const [payload, signature, ...rest] = token.split(".");
    if (
      !payload ||
      !signature ||
      rest.length ||
      !/^[0-9a-f]{64}$/.test(signature)
    )
      fail("UNAUTHORIZED", 401);
    if (
      !timingSafeEqual(Buffer.from(this.hash(payload)), Buffer.from(signature))
    )
      fail("UNAUTHORIZED", 401);
    let value: any;
    try {
      value = JSON.parse(Buffer.from(payload, "base64url").toString());
    } catch {
      fail("UNAUTHORIZED", 401);
    }
    if (
      value.client !== client ||
      typeof value.exp !== "number" ||
      value.exp <= Date.now()
    )
      fail("UNAUTHORIZED", 401);
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        "SELECT user_id FROM auth_sessions WHERE id=$1",
        [value.sid],
      );
      if (!rows[0]) fail("UNAUTHORIZED", 401);
      const actor: Actor = {
        userId: rows[0].user_id,
        sessionId: value.sid,
        client,
        platformPermissions: [],
      };
      await this.assertRecoveryActor(tx, actor);
      return actor;
    });
  }
  async verifyCsrf(actor: Actor, token: string) {
    return this.db.transaction(async (tx) => {
      try {
        await this.assertActor(tx, actor);
      } catch (e) {
        if (!(e instanceof Error) || e.message !== "UNAUTHORIZED") throw e;
        await this.assertRecoveryActor(tx, actor);
      }
      const { rows } = await tx.query(
        "SELECT csrf_hash FROM auth_sessions WHERE id=$1",
        [actor.sessionId],
      );
      if (!token || rows[0].csrf_hash !== this.hash(token))
        fail("CSRF_INVALID", 403);
    });
  }
  async login(adapter: IdentityAdapter, code: string, client: "web" | "mini") {
    if (!code || code.length > 1024) fail("INVALID_LOGIN_CODE");
    const v = await adapter.exchange(code, null);
    if (!v.subject || !v.appId || (v.provider === "sms" && !v.appId))
      fail("INVALID_VERIFIED_IDENTITY", 401);
    const provider = this.provider(v, client),
      subject = this.hash(v.subject),
      union = v.unionId && v.openPlatformId ? this.hash(v.unionId) : null;
    return this.db.transaction(async (tx) => {
      const keys = [
        `identity:${provider}:${v.appId}:${subject}`,
        ...(union ? [`union:${v.openPlatformId}:${union}`] : []),
      ].sort();
      for (const k of keys)
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          k,
        ]);
      const replay = this.hash(provider + ":" + v.appId + ":" + code);
      const used = await tx.query(
        "SELECT id FROM auth_challenges WHERE token_hash=$1",
        [replay],
      );
      if (used.rows.length) fail("LOGIN_CODE_REPLAY", 409);
      let found = await tx.query(
        "SELECT user_id,revoked_at FROM auth_identities WHERE provider=$1 AND app_id=$2 AND subject_digest=$3",
        [provider, v.appId, subject],
      );
      if (found.rows[0]?.revoked_at) fail("IDENTITY_REVOKED", 401);
      let userId: string | undefined = found.rows[0]?.user_id;
      if (!userId && union) {
        const linked = await tx.query(
          `SELECT DISTINCT user_id FROM auth_identities WHERE union_scope=$1 AND union_digest=$2 AND revoked_at IS NULL`,
          [v.openPlatformId, union],
        );
        if (linked.rows.length > 1) fail("BINDING_CONFLICT", 409);
        userId = linked.rows[0]?.user_id;
      }
      if (!userId) {
        userId = id();
        await tx.query(
          `INSERT INTO users(id,display_name) VALUES($1,'相册用户')`,
          [userId],
        );
      }
      const user = await tx.query(
        `SELECT status FROM users WHERE id=$1 FOR UPDATE`,
        [userId],
      );
      if (!["active", "deleting"].includes(user.rows[0]?.status))
        fail("ACCOUNT_UNAVAILABLE", 403);
      if (!found.rows.length)
        await tx.query(
          `INSERT INTO auth_identities(id,user_id,provider,app_id,subject_digest,union_scope,union_digest,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,now())`,
          [
            id(),
            userId,
            provider,
            v.appId,
            subject,
            union ? v.openPlatformId : null,
            union,
          ],
        );
      await tx.query(
        `INSERT INTO auth_challenges(id,user_id,kind,token_hash,state,expires_at,consumed_at) VALUES($1,$2,'login',$3,'consumed',now()+interval '10 minutes',now())`,
        [id(), userId, replay],
      );
      await tx.query("UPDATE users SET last_login_at=now() WHERE id=$1", [
        userId,
      ]);
      const session = await this.session(tx, userId, client);
      if (user.rows[0].status === "deleting")
        await tx.query(
          "INSERT INTO c3_recovery_sessions(session_id) VALUES($1)",
          [session.actor.sessionId],
        );
      return session;
    });
  }
  async rotateRefresh(token: string) {
    const result = await this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT s.*,u.status FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE refresh_hash=$1 FOR UPDATE OF s`,
        [this.hash(token)],
      );
      const s = rows[0];
      if (!s) fail("UNAUTHORIZED", 401);
      if (s.revoked_at) {
        await tx.query(
          `WITH RECURSIVE family AS (SELECT id,rotated_from_id FROM auth_sessions WHERE id=$1 UNION SELECT p.id,p.rotated_from_id FROM auth_sessions p JOIN family f ON p.id=f.rotated_from_id OR p.rotated_from_id=f.id) UPDATE auth_sessions SET revoked_at=coalesce(revoked_at,now()) WHERE id IN(SELECT id FROM family)`,
          [s.id],
        );
        return { error: true } as const;
      }
      if (
        s.status !== "active" ||
        new Date(s.expires_at).getTime() <= Date.now()
      )
        fail("UNAUTHORIZED", 401);
      await tx.query("UPDATE auth_sessions SET revoked_at=now() WHERE id=$1", [
        s.id,
      ]);
      return this.session(tx, s.user_id, s.client_kind, s.id);
    });
    if ("error" in result) fail("REFRESH_REUSE", 401);
    return result;
  }
  async logout(actor: Actor) {
    await this.db.transaction(async (tx) => {
      await this.assertActor(tx, actor);
      await tx.query("UPDATE auth_sessions SET revoked_at=now() WHERE id=$1", [
        actor.sessionId,
      ]);
    });
  }
  async beginWebLogin(nonce: string, key: string = id()) {
    if (nonce.length < 32 || nonce.length > 256) fail("INVALID_BROWSER_NONCE");
    const value = await this.db.transaction((tx) =>
      runIdempotent(
        tx,
        "qr:" + this.hash(nonce),
        key,
        this.hash(nonce),
        async () => {
          const loginId = id(),
            expiresAt = new Date(Date.now() + 120000).toISOString();
          await tx.query(
            `INSERT INTO auth_challenges(id,kind,token_hash,expires_at) VALUES($1,'web_qr',$2,$3)`,
            [loginId, this.hash(this.hash("confirm:" + loginId)), expiresAt],
          );
          await tx.query(
            "INSERT INTO auth_qr_context(challenge_id,nonce_hash,poll_hash) VALUES($1,$2,$3)",
            [
              loginId,
              this.hash(nonce),
              this.hash(this.hash("poll:" + loginId)),
            ],
          );
          return { loginId, expiresAt };
        },
      ),
    );
    return {
      ...value,
      confirmToken: this.hash("confirm:" + value.loginId),
      pollToken: this.hash("poll:" + value.loginId),
    };
  }
  async pollWebLogin(loginId: string, pollToken: string, nonce: string) {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT c.*,q.nonce_hash,q.poll_hash,q.last_polled_at FROM auth_challenges c JOIN auth_qr_context q ON q.challenge_id=c.id WHERE c.id=$1 FOR UPDATE OF q`,
        [loginId],
      );
      const c = rows[0];
      if (
        !c ||
        c.nonce_hash !== this.hash(nonce) ||
        c.poll_hash !== this.hash(pollToken)
      )
        fail("LOGIN_BROWSER_MISMATCH", 403);
      if (
        c.last_polled_at &&
        Date.now() - new Date(c.last_polled_at).getTime() < 1000
      )
        fail("RATE_LIMITED", 429);
      await tx.query(
        "UPDATE auth_qr_context SET last_polled_at=now() WHERE challenge_id=$1",
        [loginId],
      );
      const expired = new Date(c.expires_at).getTime() <= Date.now();
      return {
        id: loginId,
        state: expired
          ? "expired"
          : c.state === "pending"
            ? "waiting"
            : c.state,
        expiresAt: new Date(c.expires_at).toISOString(),
        ...(c.state === "confirmed" && !expired
          ? {
              consumeProof: this.hash(
                "consume:" + loginId + ":" + nonce + ":" + pollToken,
              ),
            }
          : {}),
      };
    });
  }
  async consumeWebSession(
    loginId: string,
    nonce: string,
    pollToken: string,
    proof: string,
    key: string,
  ) {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT c.*,q.* FROM auth_challenges c JOIN auth_qr_context q ON q.challenge_id=c.id WHERE c.id=$1 FOR UPDATE OF c,q`,
        [loginId],
      );
      const c = rows[0];
      if (
        !c ||
        c.nonce_hash !== this.hash(nonce) ||
        c.poll_hash !== this.hash(pollToken) ||
        proof !==
          this.hash("consume:" + loginId + ":" + nonce + ":" + pollToken)
      )
        fail("LOGIN_BROWSER_MISMATCH", 403);
      if (c.state === "consumed") {
        if (c.consumed_key_hash !== this.hash(key))
          fail("LOGIN_ALREADY_CONSUMED", 409);
        const r = await tx.query(
          `SELECT s.*,u.status FROM auth_sessions s JOIN users u ON u.id=s.user_id WHERE s.id=$1`,
          [c.consumed_session_id],
        );
        const session = r.rows[0];
        if (
          !session ||
          session.revoked_at ||
          session.status !== "active" ||
          new Date(session.expires_at).getTime() <= Date.now()
        )
          fail("UNAUTHORIZED", 401);
        return {
          actor: {
            userId: session.user_id,
            sessionId: session.id,
            client: "web",
            platformPermissions: [],
          } as Actor,
          accessToken: this.access(
            session.id,
            "web",
            new Date(session.expires_at).getTime(),
          ),
          csrfToken: this.hash("csrf:" + session.id),
        };
      }
      if (
        c.state !== "confirmed" ||
        new Date(c.expires_at).getTime() <= Date.now()
      )
        fail("LOGIN_CHALLENGE_INVALID", 409);
      const u = await tx.query(
        "SELECT status FROM users WHERE id=$1 FOR SHARE",
        [c.user_id],
      );
      if (!["active", "deleting"].includes(u.rows[0]?.status))
        fail("ACCOUNT_UNAVAILABLE", 403);
      const result = await this.session(tx, c.user_id, "web");
      if (u.rows[0].status === "deleting")
        await tx.query(
          "INSERT INTO c3_recovery_sessions(session_id) VALUES($1)",
          [result.actor.sessionId],
        );
      await tx.query(
        `UPDATE auth_challenges SET state='consumed',consumed_at=now(),revision=revision+1 WHERE id=$1`,
        [loginId],
      );
      await tx.query(
        "UPDATE auth_qr_context SET consumed_session_id=$2,consumed_key_hash=$3 WHERE challenge_id=$1",
        [loginId, result.actor.sessionId, this.hash(key)],
      );
      return result;
    });
  }
  async confirmWebLogin(actor: Actor, loginId: string, token: string) {
    await this.db.transaction(async (tx) => {
      try {
        await this.assertActor(tx, actor);
      } catch (e) {
        if (!(e instanceof Error) || e.message !== "UNAUTHORIZED") throw e;
        await this.assertRecoveryActor(tx, actor);
      }
      const r = await tx.query(
        `UPDATE auth_challenges SET state='confirmed',user_id=$1,revision=revision+1 WHERE id=$2 AND kind='web_qr' AND token_hash=$3 AND state='pending' AND expires_at>now() RETURNING id`,
        [actor.userId, loginId, this.hash(token)],
      );
      if (!r.rows.length) fail("LOGIN_CHALLENGE_INVALID", 409);
    });
  }
  async consumeWebLogin(loginId: string, nonce: string) {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        `SELECT c.*,q.nonce_hash FROM auth_challenges c JOIN auth_qr_context q ON q.challenge_id=c.id WHERE c.id=$1 FOR UPDATE OF c`,
        [loginId],
      );
      const c = rows[0];
      if (!c) fail("NOT_FOUND", 404);
      if (c.nonce_hash !== this.hash(nonce))
        fail("LOGIN_BROWSER_MISMATCH", 403);
      if (c.state === "consumed") fail("LOGIN_ALREADY_CONSUMED", 409);
      if (
        c.state !== "confirmed" ||
        new Date(c.expires_at).getTime() <= Date.now()
      )
        fail("LOGIN_CHALLENGE_INVALID", 409);
      const u = await tx.query("SELECT status FROM users WHERE id=$1", [
        c.user_id,
      ]);
      if (u.rows[0]?.status !== "active") fail("ACCOUNT_UNAVAILABLE", 403);
      await tx.query(
        `UPDATE auth_challenges SET state='consumed',consumed_at=now(),revision=revision+1 WHERE id=$1`,
        [loginId],
      );
      return {
        userId: c.user_id,
        sessionId: "",
        client: "web",
        platformPermissions: [],
      } as Actor;
    });
  }
  async createWebSession(actor: Actor) {
    return this.db.transaction(async (tx) => {
      await this.assertActor(tx, actor);
      return this.session(tx, actor.userId, "web");
    });
  }
  async bind(actor: Actor, v: VerifiedIdentity) {
    return this.db.transaction(async (tx) => {
      await this.assertActor(tx, actor);
      const provider = this.provider(v, actor.client),
        subject = this.hash(v.subject);
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        `identity:${provider}:${v.appId}:${subject}`,
      ]);
      const { rows } = await tx.query(
        "SELECT user_id FROM auth_identities WHERE provider=$1 AND app_id=$2 AND subject_digest=$3",
        [provider, v.appId, subject],
      );
      if (rows[0] && rows[0].user_id !== actor.userId)
        fail("BINDING_CONFLICT", 409);
      if (!rows.length)
        await tx.query(
          `INSERT INTO auth_identities(id,user_id,provider,app_id,subject_digest,verified_at) VALUES($1,$2,$3,$4,$5,now())`,
          [id(), actor.userId, provider, v.appId, subject],
        );
    });
  }
}
