import {
  type Actor,
  type Database,
  digest,
  fail,
  id,
  runIdempotent,
} from "@album/server-core";
import type { PoolClient } from "pg";
import type { AuthService } from "../auth/identity";
import type { ReauthService } from "../auth/reauthentication";
import {
  payloadHash,
  type Environment,
  type PlatformRole,
  type RequestContext,
  type SecretPort,
} from "./types";
import type { components } from "../../../../packages/contracts/src/api";
export type { SecretPort } from "./types";
export type SecretMetadata = components["schemas"]["SecretMetadata"];
export async function requireRoles(
  tx: PoolClient,
  auth: Pick<AuthService, "assertActor">,
  actor: Actor,
  roles: readonly PlatformRole[],
) {
  await auth.assertActor(tx, actor);
  const { rows } = await tx.query(
    "SELECT role FROM admin_role_assignments WHERE user_id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp()) AND role=ANY($2::text[]) FOR SHARE",
    [actor.userId, roles],
  );
  if (!rows.length) fail("FORBIDDEN", 403);
}
export function requireReason(reason: string) {
  if (!reason.trim() || reason.length > 1000)
    fail("CONFIG_REASON_REQUIRED", 422);
}
export async function audit(
  tx: PoolClient,
  actor: Actor,
  request: RequestContext,
  action: string,
  targetKind: string,
  targetId: string,
  reason: string,
  details: Record<string, unknown> = {},
) {
  await tx.query(
    "INSERT INTO audit_events(id,created_at,actor_user_id,action,target_kind,target_id,request_id,reason,redacted_details) VALUES($1,clock_timestamp(),$2,$3,$4,$5,$6,$7,$8)",
    [
      id(),
      actor.userId,
      action,
      targetKind,
      targetId,
      request.requestId ?? id(),
      reason,
      details,
    ],
  );
}
export type SecretOptions = {
  environment: Environment;
  reauth: Pick<ReauthService, "verifyFresh">;
  assertNotInUse?: (referenceId: string, tx: PoolClient) => Promise<void>;
};
/** Secret bytes only cross the trusted secret service port; no read API is exposed. */
export class SecretService {
  constructor(
    private db: Database,
    private auth: Pick<AuthService, "assertActor" | "hash">,
    private port: SecretPort,
    private options: SecretOptions,
    private request: RequestContext = {},
  ) {}
  withRequest(request: RequestContext) {
    return new SecretService(
      this.db,
      this.auth,
      this.port,
      this.options,
      request,
    );
  }
  private async authorize(tx: PoolClient, actor: Actor) {
    await requireRoles(tx, this.auth, actor, ["platform_ops"]);
    await this.options.reauth.verifyFresh(
      actor,
      this.request.reauthProof ?? "",
      "admin_secret",
      tx,
    );
  }
  metadata(row: Record<string, any>): SecretMetadata {
    return {
      id: row.id,
      versionId: row.secret_version,
      maskedHint: "••••••••",
      purpose: row.purpose,
      state:
        row.state === "revoked"
          ? "revoked"
          : row.state === "retired"
            ? "expired"
            : "pending",
      createdAt: new Date(row.created_at).toISOString(),
    };
  }
  async writeSecret(
    actor: Actor,
    purpose: components["schemas"]["SecretCreate"]["purpose"],
    value: Uint8Array,
    reason: string,
  ): Promise<SecretMetadata> {
    if (
      ![
        "storage_read",
        "storage_write",
        "storage_cleanup",
        "ai",
        "wechat",
        "payment",
        "notify",
      ].includes(purpose)
    )
      fail("SECRET_INVALID", 422);
    return this.writeVersion(actor, value, reason, { purpose });
  }
  private async writeVersion(
    actor: Actor,
    value: Uint8Array,
    reason: string,
    target:
      | { purpose: components["schemas"]["SecretCreate"]["purpose"] }
      | { referenceId: string },
  ): Promise<SecretMetadata> {
    if (!value.length || value.length > 65536) fail("SECRET_INVALID", 422);
    requireReason(reason);
    const copy = Uint8Array.from(value);
    try {
      // A keyed digest prevents SQL contents from becoming an offline secret dictionary oracle.
      // Neither the plaintext nor its unkeyed digest crosses the SQL/log boundary.
      const hash = payloadHash({
        ...target,
        reason,
        valueHash: this.auth.hash(`config:secret-value:${digest(copy)}`),
      });
      const scope = `config:secret:${"purpose" in target ? "create" : "rotate"}:${this.options.environment}:${actor.userId}`;
      return await this.db.transaction(async (tx) => {
        // Replays still require the current session and live role, but consume no further proof.
        await requireRoles(tx, this.auth, actor, ["platform_ops"]);
        const work = async () => {
          let purpose: components["schemas"]["SecretCreate"]["purpose"],
            name: string;
          if ("purpose" in target) {
            purpose = target.purpose;
            name = id();
          } else {
            const { rows } = await tx.query(
              "SELECT purpose,secret_ref FROM secret_references WHERE id=$1 AND environment=$2",
              [target.referenceId, this.options.environment],
            );
            if (!rows[0]) fail("SECRET_UNAVAILABLE", 404);
            purpose = rows[0].purpose;
            name = rows[0].secret_ref;
          }
          await this.authorize(tx, actor);
          let binding: { secretRef: string; secretVersion: string };
          try {
            binding = await this.port.write(name, copy);
          } catch {
            fail("SECRET_WRITE_FAILED", 503);
          }
          if (
            ![binding.secretRef, binding.secretVersion].every((v) =>
              /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v),
            )
          )
            fail("SECRET_WRITE_FAILED", 503);
          await requireRoles(tx, this.auth, actor, ["platform_ops"]);
          const { rows } = await tx.query(
            "INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose) VALUES($1,$2,$3,$4,$5) RETURNING *",
            [
              id(),
              this.options.environment,
              binding.secretRef,
              binding.secretVersion,
              purpose,
            ],
          );
          await audit(
            tx,
            actor,
            this.request,
            "secret.write",
            "secret",
            rows[0].id,
            reason,
            { purpose },
          );
          return this.metadata(rows[0]);
        };
        // The per-request advisory lock spans the vault write. It serializes identical
        // requests before consuming proof or mutating the vault; no publication lock is held.
        return this.request.idempotencyKey
          ? runIdempotent(tx, scope, this.request.idempotencyKey, hash, work)
          : work();
      });
    } finally {
      copy.fill(0);
    }
  }
  async rotateSecret(
    actor: Actor,
    referenceId: string,
    value: Uint8Array,
    reason: string,
  ): Promise<SecretMetadata> {
    // A distinct immutable binding retains the logical name; old releases keep their version.
    return this.writeVersion(actor, value, reason, { referenceId });
  }
  async revokeSecret(
    actor: Actor,
    referenceId: string,
    emergency: boolean,
    reason: string,
  ): Promise<SecretMetadata> {
    requireReason(reason);
    return this.db.transaction(async (tx) => {
      await requireRoles(tx, this.auth, actor, ["platform_ops"]);
      const work = async () => {
        await this.options.reauth.verifyFresh(
          actor,
          this.request.reauthProof ?? "",
          "admin_secret",
          tx,
        );
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `config:publish:${this.options.environment}`,
        ]);
        const { rows } = await tx.query(
          "SELECT * FROM secret_references WHERE id=$1 AND environment=$2 FOR UPDATE",
          [referenceId, this.options.environment],
        );
        if (!rows[0]) fail("SECRET_UNAVAILABLE", 404);
        if (!emergency) {
          const active = await tx.query(
            "SELECT i.body FROM config_active_releases a JOIN config_release_items i ON i.release_id=a.release_id WHERE a.environment=$1",
            [this.options.environment],
          );
          const referenced = (value: unknown): boolean => {
            if (!value || typeof value !== "object") return false;
            const object = value as Record<string, unknown>;
            if (
              (object.secretRef === referenceId ||
                object.secretRef === rows[0].secret_ref) &&
              object.secretVersion === rows[0].secret_version
            )
              return true;
            if (Object.values(object).includes(referenceId)) return true;
            return Object.values(object).some(referenced);
          };
          if (active.rows.some((item) => referenced(item.body)))
            fail("SECRET_IN_USE", 409);
          // The snapshot/provider owner must prove pins/query obligations are discharged.
          if (!this.options.assertNotInUse)
            fail("SECRET_USAGE_UNVERIFIED", 409);
          await this.options.assertNotInUse(referenceId, tx);
        }
        const updated = await tx.query(
          "UPDATE secret_references SET state='revoked' WHERE id=$1 RETURNING *",
          [referenceId],
        );
        await audit(
          tx,
          actor,
          this.request,
          "secret.revoke",
          "secret",
          referenceId,
          reason,
          { emergency },
        );
        return this.metadata(updated.rows[0]);
      };
      return this.request.idempotencyKey
        ? runIdempotent(
            tx,
            `config:secret:revoke:${this.options.environment}:${actor.userId}`,
            this.request.idempotencyKey,
            payloadHash({ referenceId, emergency, reason }),
            work,
          )
        : work();
    });
  }
  async listMetadata(actor: Actor): Promise<SecretMetadata[]> {
    return this.db.transaction(async (tx) => {
      await requireRoles(tx, this.auth, actor, ["platform_ops"]);
      const { rows } = await tx.query(
        "SELECT * FROM secret_references WHERE environment=$1 ORDER BY created_at,id",
        [this.options.environment],
      );
      return rows.map((row) => this.metadata(row));
    });
  }
}
