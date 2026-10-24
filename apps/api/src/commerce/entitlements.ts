import { fail, type Database } from "@album/server-core";
import type { ConfigPayload, ConfigRelease } from "../config/types";
import { validateConfigPayload } from "../config/types";
import type { EntitlementSnapshot, EntitlementPort } from "../exports/service";
import type { QuotaPolicyPort } from "../assets/types";
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
            "SELECT id,features FROM entitlement_grants WHERE workspace_id=$1 AND grant_type='membership' AND state='active' AND starts_at<=$2 AND ends_at>$2 ORDER BY id",
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
