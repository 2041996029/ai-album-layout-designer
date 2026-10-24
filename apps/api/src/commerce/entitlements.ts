import { fail, type Database } from "@album/server-core";
import type { ConfigPayload, ConfigRelease } from "../config/types";
import { validateConfigPayload } from "../config/types";
import type { EntitlementSnapshot, EntitlementPort } from "../exports/service";
import type { QuotaPolicyPort } from "../assets/types";
import type { PoolClient } from "pg";
import { lockCreditAccount, sourceCreditFrozenSql } from "./credits";
import { membershipTierKey } from "./fulfillment";

type Features = Extract<
  ConfigPayload,
  { kind: "workspace" }
>["defaultFeatures"];
export class EntitlementService implements EntitlementPort, QuotaPolicyPort {
  constructor(
    readonly db: Database,
    readonly release: () => Promise<Readonly<ConfigRelease>>,
    readonly now: () => Date = () => new Date(),
  ) {}
  private async effective(wid: string, at: string) {
    const time = new Date(at);
    if (!Number.isFinite(+time)) fail("INVALID_TIME", 422);
    const release = await this.release(),
      version = release.versions.workspace;
    if (
      !version ||
      version.state !== "published" ||
      version.payload.kind !== "workspace" ||
      new Date(release.effectiveAt) > time
    )
      fail("ENTITLEMENTS_UNCONFIGURED", 503);
    validateConfigPayload("workspace", version.payload);
    const rows = await this.db.transaction(
      async (tx) =>
        (
          await tx.query(
            `SELECT g.id,g.features FROM entitlement_grants g WHERE g.workspace_id=$1 AND g.grant_type='membership' AND g.state='active' AND g.starts_at<=$2 AND g.ends_at>$2 AND NOT ${sourceCreditFrozenSql()} ORDER BY g.id`,
            [wid, time],
          )
        ).rows,
    );
    let effective: Features = version.payload.defaultFeatures;
    if (rows.length) {
      const keys = new Set(rows.map((r) => r.features.tierKey));
      if (keys.size !== 1) fail("ENTITLEMENT_TIER_CONFLICT", 409);
      const features = rows[0].features.entitlements;
      if (!features || rows[0].features.tierKey !== membershipTierKey(features))
        fail("ENTITLEMENT_GRANT_INVALID", 503);
      // Reuse the generated schema for historical feature validation.
      const historical = { ...version.payload, defaultFeatures: features };
      validateConfigPayload("workspace", historical);
      effective = features;
    }
    return { features: effective, ids: rows.map((r) => r.id as string) };
  }
  /** Lock the same account as refund admission, then recheck the exact paid
   * sources before snapshot/job/pins/quota commit. No nested transaction or I/O. */
  async verifyAcceptance(
    tx: PoolClient,
    wid: string,
    snapshot: EntitlementSnapshot,
  ): Promise<void> {
    await lockCreditAccount(tx, wid);
    if (snapshot.workspaceId !== wid) fail("PREFLIGHT_STALE", 409);
    if (!snapshot.grantIds.length) {
      if (!snapshot.brandWatermark) fail("PREFLIGHT_STALE", 409);
      return;
    }
    const rows = (
      await tx.query(
        `SELECT g.id,g.features FROM entitlement_grants g WHERE g.workspace_id=$1 AND g.id=ANY($2::text[]) AND g.grant_type='membership' AND g.state='active' AND g.starts_at<=$3 AND g.ends_at>$3 AND NOT ${sourceCreditFrozenSql()} ORDER BY g.id`,
        [wid, snapshot.grantIds, this.now()],
      )
    ).rows;
    if (
      rows.length !== new Set(snapshot.grantIds).size ||
      rows.length !== snapshot.grantIds.length
    )
      fail("PREFLIGHT_STALE", 409);
    for (const row of rows) {
      const features = row.features.entitlements;
      if (
        !features ||
        row.features.tierKey !== membershipTierKey(features) ||
        snapshot.maxDpi !== Math.max(...features.exportDpis) ||
        snapshot.maxConcurrentExports !== features.exportConcurrency ||
        snapshot.storageLimitBytes !== features.storageBytes ||
        snapshot.brandWatermark
      )
        fail("PREFLIGHT_STALE", 409);
    }
  }
  async getEntitlements(wid: string, at: string): Promise<EntitlementSnapshot> {
    const { features, ids } = await this.effective(wid, at);
    return {
      workspaceId: wid,
      at,
      grantIds: ids,
      maxDpi: Math.max(...features.exportDpis) as 72 | 150 | 300,
      maxConcurrentExports: features.exportConcurrency,
      brandWatermark: ids.length === 0,
      storageLimitBytes: features.storageBytes,
    };
  }
  async readQuota(
    wid: string,
  ): Promise<{ limitBytes: number; maxProjectPhotos: number }> {
    const { features } = await this.effective(wid, this.now().toISOString());
    return {
      limitBytes: features.storageBytes,
      maxProjectPhotos: features.maxProjectPhotos,
    };
  }
}
