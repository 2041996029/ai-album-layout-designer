import { randomBytes } from "node:crypto";
import {
  type Actor,
  type Database,
  fail,
  id,
  runIdempotent,
  digest,
} from "@album/server-core";
import type { PoolClient } from "pg";
import type { AuthService } from "./identity";
import type { IdentityAdapter, VerifiedIdentity } from "./types";
import type { FreshProofVerifier } from "./account-deletion";
export type ReauthPurpose =
  | "bind"
  | "unbind"
  | "delete_account"
  | "privacy_export"
  | "ownership_transfer"
  | "billing_refund"
  | "admin_secret"
  | "admin_publish"
  | "admin_operations";
export type IdentityProof = {
  provider: "wechat_mini" | "wechat_web" | "phone" | "email";
  challengeId: string;
  proof: string;
  purpose: ReauthPurpose;
};
const purposes = [
  "bind",
  "unbind",
  "delete_account",
  "privacy_export",
  "ownership_transfer",
  "billing_refund",
  "admin_secret",
  "admin_publish",
  "admin_operations",
];
/** Trusted SMS deployment port: dispatch to the actor's linked destination and authenticate
 * that challenge's human code. It returns identity evidence, never a server operation token. */
export interface HumanReauthAdapter {
  readonly method?: "sms" | "email";
  start(input: {
    actor: Actor;
    purpose: ReauthPurpose;
    challengeId: string;
    expiresAt: string;
  }): Promise<{ destinationHint: string }>;
  complete(input: {
    actor: Actor;
    purpose: ReauthPurpose;
    challengeId: string;
    code: string;
  }): Promise<VerifiedIdentity>;
}
export class ReauthService {
  readonly freshProofVerifier: FreshProofVerifier = {
    verify: (actor, token, purpose, tx) =>
      this.verifyFresh(
        actor,
        token,
        purpose === "account_deletion" ? "delete_account" : purpose,
        tx,
      ),
  };
  constructor(
    private db: Database,
    private auth: AuthService,
    private adapters: Partial<
      Record<IdentityProof["provider"], IdentityAdapter>
    >,
    private human?: HumanReauthAdapter,
  ) {}
  private async assertPurposeAllowed(
    tx: PoolClient,
    actor: Actor,
    purpose: ReauthPurpose,
  ) {
    if (!purpose.startsWith("admin_")) return;
    const roles =
      purpose === "admin_secret"
        ? ["platform_ops"]
        : ["platform_ops", "finance", "content"];
    const permitted = await tx.query(
      "SELECT 1 FROM admin_role_assignments WHERE user_id=$1 AND role=ANY($2::text[]) AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) FOR SHARE",
      [actor.userId, roles],
    );
    if (!permitted.rowCount) fail("FORBIDDEN", 403);
  }
  private challengeHash(
    actor: Actor,
    purpose: ReauthPurpose,
    challengeId: string,
  ) {
    return this.auth.hash(
      `human-reauth:${actor.sessionId}:${purpose}:${challengeId}`,
    );
  }
  async availability(actor: Actor) {
    return this.db.transaction(async (tx) => {
      await this.auth.assertActor(tx, actor);
      if (!this.human)
        return {
          state: "unconfigured" as const,
          reasonCode: "REAUTH_UNCONFIGURED",
        };
      const linked = (
        await tx.query(
          "SELECT 1 FROM auth_identities WHERE user_id=$1 AND provider=$2 AND revoked_at IS NULL AND verified_at IS NOT NULL",
          [actor.userId, this.human.method === "email" ? "email" : "phone"],
        )
      ).rowCount;
      return linked
        ? { state: "available" as const, method: this.human.method ?? "sms" }
        : {
            state: "unavailable" as const,
            reasonCode: "REAUTH_IDENTITY_UNAVAILABLE",
          };
    });
  }
  async start(actor: Actor, purpose: ReauthPurpose, key: string) {
    if (!purposes.includes(purpose)) fail("REAUTH_INVALID", 422);
    const available = await this.availability(actor);
    if (available.state !== "available")
      fail(available.reasonCode ?? "REAUTH_UNCONFIGURED", 503);
    return this.db.transaction(async (tx) => {
      await this.auth.assertActor(tx, actor);
      await this.assertPurposeAllowed(tx, actor, purpose);
      return runIdempotent(
        tx,
        `reauth:challenge:${actor.userId}:${actor.sessionId}`,
        key,
        digest(purpose),
        async () => {
          const challengeId = id(),
            expiresAt = new Date(Date.now() + 300000).toISOString();
          await tx.query(
            "INSERT INTO auth_challenges(id,user_id,kind,token_hash,state,expires_at) VALUES($1,$2,'login',$3,'pending',$4)",
            [
              challengeId,
              actor.userId,
              this.challengeHash(actor, purpose, challengeId),
              expiresAt,
            ],
          );
          const delivery = await this.human!.start({
            actor,
            purpose,
            challengeId,
            expiresAt,
          });
          if (
            typeof delivery.destinationHint !== "string" ||
            !delivery.destinationHint.length ||
            delivery.destinationHint.length > 100 ||
            (this.human!.method !== "email" &&
              delivery.destinationHint.replace(/\D/g, "").length > 6)
          )
            fail("REAUTH_ADAPTER_INVALID", 503);
          return {
            id: challengeId,
            method: this.human!.method ?? "sms",
            destinationHint: delivery.destinationHint,
            expiresAt,
            purpose,
          };
        },
      );
    });
  }
  private async checkChallenge(
    tx: PoolClient,
    actor: Actor,
    input: IdentityProof,
  ) {
    await this.auth.assertActor(tx, actor);
    const row = (
      await tx.query("SELECT * FROM auth_challenges WHERE id=$1 FOR UPDATE", [
        input.challengeId,
      ])
    ).rows[0];
    if (
      !row ||
      row.user_id !== actor.userId ||
      row.token_hash !==
        this.challengeHash(actor, input.purpose, input.challengeId)
    )
      fail("REAUTH_CHALLENGE_INVALID", 403);
    if (row.state !== "pending") fail("REAUTH_CODE_REPLAY", 409);
    if (new Date(row.expires_at) <= new Date())
      fail("REAUTH_CHALLENGE_EXPIRED", 410);
  }
  async verify(actor: Actor, input: IdentityProof, purpose: ReauthPurpose) {
    if (
      input.purpose !== purpose ||
      !purposes.includes(purpose) ||
      !input.proof ||
      input.proof.length > 4096 ||
      !input.challengeId ||
      input.challengeId.length > 128
    )
      fail("REAUTH_INVALID", 422);
    const human =
      input.provider === (this.human?.method === "email" ? "email" : "phone")
        ? this.human
        : undefined;
    const adapter = this.adapters[input.provider];
    if (!human && !adapter) fail("REAUTH_UNCONFIGURED", 503);
    if (human) {
      if (!/^\d{6}$/.test(input.proof)) fail("REAUTH_INVALID", 422);
      await this.db.transaction((tx) => this.checkChallenge(tx, actor, input));
    }
    const identity = human
      ? await human.complete({
          actor,
          purpose,
          challengeId: input.challengeId,
          code: input.proof,
        })
      : await adapter!.exchange(input.proof, null, { actor, purpose });
    if (
      !identity.subject ||
      !identity.appId ||
      (input.provider === "email"
        ? identity.provider !== "email"
        : input.provider === "phone"
          ? identity.provider !== "sms"
          : identity.provider !== "wechat")
    )
      fail("REAUTH_IDENTITY_INVALID", 401);
    return this.db.transaction(async (tx) => {
      await this.auth.assertActor(tx, actor);
      if (human) {
        await this.checkChallenge(tx, actor, input);
        await tx.query(
          "UPDATE auth_challenges SET state='consumed',consumed_at=now(),revision=revision+1 WHERE id=$1",
          [input.challengeId],
        );
      }
      const replay = this.auth.hash(
        input.provider +
          ":" +
          identity.appId +
          ":" +
          (human ? input.challengeId + ":" : "") +
          input.proof,
      );
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "reauth:" + replay,
      ]);
      const used = await tx.query(
        "SELECT 1 FROM auth_challenges WHERE token_hash=$1",
        [replay],
      );
      if (used.rowCount) fail("REAUTH_CODE_REPLAY", 409);
      const linked = await tx.query(
        "SELECT 1 FROM auth_identities WHERE user_id=$1 AND provider=$2 AND app_id=$3 AND subject_digest=$4 AND revoked_at IS NULL AND verified_at IS NOT NULL FOR SHARE",
        [
          actor.userId,
          input.provider,
          identity.appId,
          this.auth.hash(identity.subject),
        ],
      );
      if (!linked.rowCount) fail("REAUTH_IDENTITY_MISMATCH", 403);
      // Current authorization for admin actions is checked again by their consuming service.
      await this.assertPurposeAllowed(tx, actor, purpose);
      await tx.query(
        "INSERT INTO auth_challenges(id,user_id,kind,token_hash,state,expires_at,consumed_at) VALUES($1,$2,'login',$3,'consumed',now()+interval '5 minutes',now())",
        [id(), actor.userId, replay],
      );
      const raw = randomBytes(40).toString("base64url");
      const { rows } = await tx.query(
        "INSERT INTO reauth_proofs(token_hash,user_id,session_id,purpose,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes') RETURNING expires_at",
        [this.auth.hash(raw), actor.userId, actor.sessionId, purpose],
      );
      return {
        reauthProof: raw,
        purpose,
        expiresAt: new Date(rows[0].expires_at).toISOString(),
      };
    });
  }
  async verifyFresh(
    actor: Actor,
    raw: string,
    purpose: ReauthPurpose,
    tx: PoolClient,
  ) {
    await this.auth.assertActor(tx, actor);
    if (!raw || raw.length > 4096) fail("REAUTH_REQUIRED", 401);
    const { rows } = await tx.query(
      "UPDATE reauth_proofs SET consumed_at=now() WHERE token_hash=$1 AND user_id=$2 AND session_id=$3 AND purpose=$4 AND consumed_at IS NULL AND expires_at>now() RETURNING token_hash",
      [this.auth.hash(raw), actor.userId, actor.sessionId, purpose],
    );
    if (!rows[0]) fail("REAUTH_REQUIRED", 401);
  }
}
