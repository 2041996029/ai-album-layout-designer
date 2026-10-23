import { randomBytes } from "node:crypto";
import { type Actor, type Database, fail, id } from "@album/server-core";
import type { PoolClient } from "pg";
import type { AuthService } from "./identity";
import type { IdentityAdapter } from "./types";
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
  provider: "wechat_mini" | "wechat_web" | "phone";
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
  ) {}
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
    const adapter = this.adapters[input.provider];
    if (!adapter) fail("REAUTH_UNCONFIGURED", 503);
    const identity = await adapter.exchange(input.proof, null);
    if (
      !identity.subject ||
      !identity.appId ||
      (input.provider === "phone"
        ? identity.provider !== "sms"
        : identity.provider !== "wechat")
    )
      fail("REAUTH_IDENTITY_INVALID", 401);
    return this.db.transaction(async (tx) => {
      await this.auth.assertActor(tx, actor);
      const replay = this.auth.hash(
        input.provider + ":" + identity.appId + ":" + input.proof,
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
      if (purpose.startsWith("admin_") && !actor.platformPermissions.length)
        fail("FORBIDDEN", 403);
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
