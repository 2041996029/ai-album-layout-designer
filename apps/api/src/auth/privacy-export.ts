import { type Actor, type Database, fail, id } from "@album/server-core";
import type { PoolClient } from "pg";
import type {
  DeletionAuthorization,
  FreshProofVerifier,
} from "./account-deletion";
/** C4 must atomically persist a real job/outbox in this transaction; output is private to this user. */
export interface PrivacyExportScheduler {
  enqueue(
    tx: PoolClient,
    input: {
      userId: string;
      workspaceId: string;
      includeAssetManifest: boolean;
      idempotencyKey: string;
    },
  ): Promise<unknown>;
}
export class PrivacyExportService {
  constructor(
    private db: Database,
    private auth: DeletionAuthorization,
    private verifyProof?: FreshProofVerifier,
    private scheduler?: PrivacyExportScheduler,
  ) {}
  async request(
    actor: Actor,
    input: { reauthProof: string; includeAssetManifest: boolean },
    key: string = id(),
  ) {
    if (
      !input.reauthProof ||
      input.reauthProof.length < 16 ||
      input.reauthProof.length > 4096 ||
      typeof input.includeAssetManifest !== "boolean"
    )
      fail("INVALID_PRIVACY_EXPORT", 422);
    return this.db.transaction(async (tx) => {
      await this.auth.assertActor(tx, actor);
      if (!this.verifyProof) fail("REAUTH_UNCONFIGURED", 503);
      await this.verifyProof.verify(
        actor,
        input.reauthProof,
        "privacy_export",
        tx,
      );
      const { rows } = await tx.query(
        "SELECT id FROM workspaces WHERE owner_user_id=$1 AND kind='personal' AND state='active' ORDER BY created_at LIMIT 1 FOR SHARE",
        [actor.userId],
      );
      if (!rows[0]) fail("PERSONAL_WORKSPACE_REQUIRED", 409);
      if (!this.scheduler) fail("PRIVACY_EXPORT_UNCONFIGURED", 503);
      return this.scheduler.enqueue(tx, {
        userId: actor.userId,
        workspaceId: rows[0].id,
        includeAssetManifest: input.includeAssetManifest,
        idempotencyKey: key,
      });
    });
  }
  createPrivacyExport(
    actor: Actor,
    input: { reauthProof: string; includeAssetManifest: boolean },
    key?: string,
  ) {
    return this.request(actor, input, key);
  }
}
