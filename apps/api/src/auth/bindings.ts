import {
  type Actor,
  type Database,
  id,
  digest,
  fail,
  runIdempotent,
} from "@album/server-core";
import type { AuthService } from "./identity";
import type { IdentityAdapter } from "./types";
import type { IdentityProof, ReauthService } from "./reauthentication";
export type BindingCreate = { proof: IdentityProof; reauthProof: string };
export type BindingDelete = {
  reauthProof: string;
  remainingLoginMethodAcknowledged: true;
};
const shape = (row: any) => ({
  id: row.id,
  provider: row.provider,
  displayHint:
    row.provider === "email"
      ? "已验证邮箱"
      : row.provider === "phone"
        ? "Verified phone"
        : "Verified WeChat",
  createdAt: new Date(row.created_at).toISOString(),
});
export class BindingService {
  constructor(
    private db: Database,
    private auth: AuthService,
    private reauth: ReauthService,
    private adapters: Partial<
      Record<IdentityProof["provider"], IdentityAdapter>
    > = {},
  ) {}
  async list(actor: Actor) {
    return this.db.transaction(async (tx) => {
      await this.auth.assertActor(tx, actor);
      const { rows } = await tx.query(
        "SELECT * FROM auth_identities WHERE user_id=$1 AND revoked_at IS NULL AND provider IN ('wechat_mini','wechat_web','phone','email') ORDER BY created_at,id",
        [actor.userId],
      );
      return rows.map(shape);
    });
  }
  async create(actor: Actor, input: BindingCreate, key: string = id()) {
    if (
      input.proof.purpose !== "bind" ||
      !input.proof.challengeId ||
      !input.proof.proof ||
      input.proof.proof.length > 4096
    )
      fail("BINDING_PROOF_INVALID", 422);
    return this.db.transaction(async (tx) => {
      await this.auth.assertActor(tx, actor);
      return runIdempotent(
        tx,
        "binding:create:" + actor.userId,
        key,
        digest(JSON.stringify(input)),
        async () => {
          const adapter = this.adapters[input.proof.provider];
          if (!adapter) fail("BINDING_UNCONFIGURED", 503);
          await this.reauth.verifyFresh(actor, input.reauthProof, "bind", tx);
          const identity = await adapter.exchange(input.proof.proof, null, {
            actor,
            purpose: "bind",
          });
          if (
            !identity.subject ||
            !identity.appId ||
            (input.proof.provider === "email"
              ? identity.provider !== "email"
              : input.proof.provider === "phone"
                ? identity.provider !== "sms"
                : identity.provider !== "wechat")
          )
            fail("BINDING_PROOF_INVALID", 401);
          const provider = input.proof.provider,
            subject = this.auth.hash(identity.subject),
            union =
              identity.unionId && identity.openPlatformId
                ? this.auth.hash(identity.unionId)
                : null;
          const keys = [
            `identity:${provider}:${identity.appId}:${subject}`,
            ...(union ? [`union:${identity.openPlatformId}:${union}`] : []),
          ].sort();
          for (const lock of keys)
            await tx.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              [lock],
            );
          const replay = this.auth.hash(
            provider + ":" + identity.appId + ":" + input.proof.proof,
          );
          if (
            (
              await tx.query(
                "SELECT 1 FROM auth_challenges WHERE token_hash=$1",
                [replay],
              )
            ).rowCount
          )
            fail("BINDING_CODE_REPLAY", 409);
          const { rows } = await tx.query(
            "SELECT * FROM auth_identities WHERE provider=$1 AND app_id=$2 AND subject_digest=$3 FOR UPDATE",
            [provider, identity.appId, subject],
          );
          if (rows[0] && rows[0].user_id !== actor.userId)
            fail("BINDING_CONFLICT", 409);
          if (
            union &&
            (
              await tx.query(
                "SELECT 1 FROM auth_identities WHERE union_scope=$1 AND union_digest=$2 AND user_id<>$3 AND revoked_at IS NULL",
                [identity.openPlatformId, union, actor.userId],
              )
            ).rowCount
          )
            fail("BINDING_CONFLICT", 409);
          await tx.query(
            "INSERT INTO auth_challenges(id,user_id,kind,token_hash,state,expires_at,consumed_at) VALUES($1,$2,'binding',$3,'consumed',now()+interval '5 minutes',now())",
            [id(), actor.userId, replay],
          );
          if (rows[0]) {
            const restored = await tx.query(
              "UPDATE auth_identities SET revoked_at=NULL,verified_at=now() WHERE id=$1 RETURNING *",
              [rows[0].id],
            );
            return shape(restored.rows[0]);
          }
          const created = await tx.query(
            "INSERT INTO auth_identities(id,user_id,provider,app_id,subject_digest,union_scope,union_digest,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,now()) RETURNING *",
            [
              id(),
              actor.userId,
              provider,
              identity.appId,
              subject,
              union ? identity.openPlatformId : null,
              union,
            ],
          );
          return shape(created.rows[0]);
        },
      );
    });
  }
  async remove(
    actor: Actor,
    bindingId: string,
    input: BindingDelete,
    key: string = id(),
  ) {
    if (input.remainingLoginMethodAcknowledged !== true)
      fail("REMAINING_LOGIN_ACKNOWLEDGEMENT_REQUIRED", 422);
    return this.db.transaction(async (tx) => {
      await this.auth.assertActor(tx, actor);
      return runIdempotent(
        tx,
        "binding:delete:" + actor.userId,
        key,
        digest(JSON.stringify({ bindingId, ...input })),
        async () => {
          await this.reauth.verifyFresh(actor, input.reauthProof, "unbind", tx);
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            ["bindings:" + actor.userId],
          );
          const { rows } = await tx.query(
            "SELECT * FROM auth_identities WHERE user_id=$1 AND revoked_at IS NULL AND provider IN ('wechat_mini','wechat_web','phone','email') ORDER BY id FOR UPDATE",
            [actor.userId],
          );
          const binding = rows.find((r) => r.id === bindingId);
          if (!binding) fail("NOT_FOUND", 404);
          if (rows.length <= 1) fail("LAST_LOGIN_METHOD", 409);
          await tx.query(
            "UPDATE auth_identities SET revoked_at=now() WHERE id=$1",
            [bindingId],
          );
          return {
            operationId: id(),
            state: "completed" as const,
            acceptedAt: new Date().toISOString(),
          };
        },
      );
    });
  }
}
