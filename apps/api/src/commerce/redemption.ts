import { createHmac, randomBytes } from "node:crypto";
import {
  type Actor,
  type Database,
  digest,
  fail,
  id,
} from "@album/server-core";
import type { PoolClient } from "pg";
import type { components } from "../../../../packages/contracts/src/api";
import type { AuthService } from "../auth/identity";
import type { ReauthService } from "../auth/reauthentication";
import type { WorkspaceService } from "../workspaces/service";
import { audit, requireRoles } from "../config/secrets";
import { canonical, validateConfigPayload } from "../config/types";
import type { PublishedSku } from "../payments/types";
import { membershipTierKey } from "./fulfillment";
import {
  creditLedgerLine,
  lockCreditAccount,
  syncCreditAccount,
} from "./credits";

export type RedemptionBatchInput = {
  skuVersionId: string;
  startsAt: string;
  expiresAt: string;
  count: number;
  maxUsesPerCode: number;
  workspaceKinds: Array<"personal" | "studio">;
  distributionChannel: string;
};
/** Constructed by trusted HTTP middleware. Do not copy IP/device from body or
 * unverified forwarding headers; deviceId must be a server-issued verified signal. */
export type RedemptionRequest = {
  idempotencyKey?: string;
  reauthProof?: string;
  requestId?: string;
  expectedRevision?: number;
  signals?: { ip: string; deviceId: string };
};
export interface RedemptionRateLimitPort {
  consume(signals: {
    userId: string;
    ip: string;
    deviceId: string;
  }): Promise<void>;
}
export type RedemptionOptions = {
  pepper: string;
  reauth: Pick<ReauthService, "verifyFresh">;
  rateLimiter: RedemptionRateLimitPort;
  now?: () => Date;
};
type Batch = components["schemas"]["RedemptionBatch"];
type BatchCreated = components["schemas"]["RedemptionBatchCreated"];
type Creation = { batch: Batch; oneTimeCodes: string[] };
export type RedemptionResult = { redemptionId: string; grantIds: string[] };

/** Atomic shared Redis windows for all three signals, with peppered keys and no
 * raw code in the limiter. Redis failure propagates, closing financial admission. */
export class RedisRedemptionRateLimiter implements RedemptionRateLimitPort {
  constructor(
    private redis: {
      eval(
        script: string,
        numKeys: number,
        ...args: (string | number)[]
      ): Promise<unknown>;
    },
    private pepper: string,
    private limits = { user: 20, ip: 60, device: 20, windowSeconds: 60 },
  ) {
    if (
      pepper.length < 32 ||
      !Object.values(limits).every((n) => Number.isSafeInteger(n) && n > 0)
    )
      fail("REDEMPTION_LIMITER_UNCONFIGURED", 503);
  }
  async consume(s: { userId: string; ip: string; deviceId: string }) {
    const keys = [s.userId, s.ip, s.deviceId].map(
      (v, i) =>
        "redemption:limit:" +
        i +
        ":" +
        createHmac("sha256", this.pepper).update(v).digest("hex"),
    );
    const allowed = await this.redis.eval(
      `
      local denied=0
      for i=1,3 do
        local n=redis.call('INCR',KEYS[i])
        if n==1 then redis.call('EXPIRE',KEYS[i],ARGV[4]) end
        if n>tonumber(ARGV[i]) then denied=1 end
      end
      return denied`,
      3,
      ...keys,
      this.limits.user,
      this.limits.ip,
      this.limits.device,
      this.limits.windowSeconds,
    );
    if (Number(allowed) !== 0) fail("RATE_LIMITED", 429);
  }
}

/** One SQL transaction owns code use, source grants, lots, ledger and replay. */
export class RedemptionService {
  constructor(
    private db: Database,
    private auth: Pick<AuthService, "assertActor">,
    private workspaces: Pick<WorkspaceService, "authorize">,
    private options: RedemptionOptions,
    private request: RedemptionRequest = {},
  ) {
    if (typeof options.pepper !== "string" || options.pepper.length < 32)
      fail("REDEMPTION_UNCONFIGURED", 503);
  }
  withRequest(request: RedemptionRequest) {
    return new RedemptionService(
      this.db,
      this.auth,
      this.workspaces,
      this.options,
      request,
    );
  }
  private async at(tx: PoolClient) {
    return (
      this.options.now?.() ??
      ((await tx.query("SELECT clock_timestamp() AS at")).rows[0].at as Date)
    );
  }
  private codeHash(raw: string) {
    return createHmac("sha256", this.options.pepper)
      .update("redemption:" + raw)
      .digest("hex");
  }
  private reason(reason: string) {
    if (typeof reason !== "string" || !reason.trim() || reason.length > 500)
      fail("REASON_REQUIRED", 422);
  }
  private async finance(tx: PoolClient, actor: Actor) {
    await requireRoles(tx, this.auth, actor, ["finance"]);
    return "finance" as const;
  }
  private async fresh(tx: PoolClient, actor: Actor) {
    await this.options.reauth.verifyFresh(
      actor,
      this.request.reauthProof ?? "",
      "admin_operations",
      tx,
    );
  }
  private async once<T>(
    tx: PoolClient,
    actor: Actor,
    wid: string | null,
    key: string | undefined,
    operation: string,
    payload: unknown,
    work: () => Promise<T>,
    persist: (v: T) => T = (v) => v,
  ): Promise<T> {
    if (!key || !/^[\x21-\x7e]{16,128}$/.test(key))
      fail("IDEMPOTENCY_KEY_REQUIRED", 428);
    const scope = wid ? "workspace" : "user:" + actor.userId;
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      `${wid ? "workspace:" + wid : scope}:${key}`,
    ]);
    const hash = digest(
      canonical({ operation, userId: actor.userId, payload }),
    );
    const prior = (
      await tx.query(
        "SELECT * FROM idempotency_keys WHERE workspace_id IS NOT DISTINCT FROM $1 AND principal_scope=$2 AND idempotency_key=$3 FOR UPDATE",
        [wid, scope, key],
      )
    ).rows[0];
    if (prior) {
      const expired = +prior.expires_at <= +(await this.at(tx));
      if (!expired) {
        if (prior.operation !== operation || prior.request_hash !== hash)
          fail("IDEMPOTENCY_MISMATCH", 409);
        return prior.response_json as T;
      }
      await tx.query("DELETE FROM idempotency_keys WHERE id=$1", [prior.id]);
    }
    const result = await work();
    await tx.query(
      "INSERT INTO idempotency_keys(id,workspace_id,principal_scope,idempotency_key,request_hash,operation,state,response_status,response_json,expires_at) VALUES($1,$2,$3,$4,$5,$6,'completed',200,$7,clock_timestamp()+interval '7 days')",
      [id(), wid, scope, key, hash, operation, persist(result)],
    );
    return result;
  }
  private validateBatch(input: RedemptionBatchInput) {
    if (
      !input ||
      typeof input.skuVersionId !== "string" ||
      !input.skuVersionId.length ||
      input.skuVersionId.length > 128 ||
      !Number.isSafeInteger(input.count) ||
      input.count < 1 ||
      input.count > 10000 ||
      input.maxUsesPerCode !== 1 ||
      !Array.isArray(input.workspaceKinds) ||
      !input.workspaceKinds.length ||
      input.workspaceKinds.length > 2 ||
      new Set(input.workspaceKinds).size !== input.workspaceKinds.length ||
      input.workspaceKinds.some((k) => !["personal", "studio"].includes(k)) ||
      typeof input.distributionChannel !== "string" ||
      !input.distributionChannel.trim() ||
      input.distributionChannel.length > 128 ||
      /[\x00-\x1f\x7f]/.test(input.distributionChannel) ||
      !Number.isFinite(Date.parse(input.startsAt)) ||
      !Number.isFinite(Date.parse(input.expiresAt)) ||
      Date.parse(input.expiresAt) <= Date.parse(input.startsAt)
    )
      fail("REDEMPTION_BATCH_INVALID", 422);
  }
  /** Read only canonical, immutable published provenance. New batch admission
   * additionally requires active catalog identity. Existing batches retain it. */
  private async sku(
    tx: PoolClient,
    versionId: string,
    newBatch: boolean,
  ): Promise<PublishedSku> {
    const row = (
      await tx.query(
        "SELECT v.*,s.state AS catalog_state FROM sku_versions v JOIN billing_skus s ON s.id=v.sku_id WHERE v.id=$1 FOR SHARE OF s",
        [versionId],
      )
    ).rows[0];
    if (!row || (newBatch && row.catalog_state !== "active"))
      fail("SKU_UNPUBLISHED", 409);
    const sku = row.features?.publishedSku as PublishedSku;
    if (!sku || !sku.enabled || row.features.skuConfigVersionId !== versionId)
      fail("SKU_UNPUBLISHED", 409);
    validateConfigPayload("sku", sku);
    const published = (
      await tx.query(
        "SELECT i.body,r.manifest FROM config_releases r JOIN config_release_items i ON i.release_id=r.id AND i.namespace='sku' WHERE r.id=$1",
        [row.features.releaseId],
      )
    ).rows[0];
    if (
      !published ||
      published.manifest?.versions?.sku?.id !== versionId ||
      canonical(published.body) !== canonical(sku) ||
      row.sku_id !== sku.skuId ||
      row.currency !== sku.currency ||
      Number(row.price_fen) !== sku.priceFen ||
      row.duration_days !== sku.durationDays ||
      Number(row.credit_grant) !== sku.credits
    )
      fail("SKU_UNPUBLISHED", 409);
    return sku;
  }
  private async metadata(tx: PoolClient, batchId: string): Promise<Batch> {
    const row = (
      await tx.query(
        "SELECT b.*, (SELECT count(*) FROM redemption_codes c WHERE c.batch_id=b.id) AS count FROM redemption_batches b WHERE b.id=$1",
        [batchId],
      )
    ).rows[0];
    if (!row) fail("NOT_FOUND", 404);
    return {
      id: row.id,
      skuVersionId: row.sku_version_id,
      count: Number(row.count),
      expiresAt: row.expires_at.toISOString(),
      state: row.state,
      revision: Number(row.revision),
    };
  }
  private async create(
    actor: Actor,
    inputSource: RedemptionBatchInput | ((at: Date) => RedemptionBatchInput),
    reason: string,
    payload: unknown,
  ): Promise<Creation> {
    this.reason(reason);
    return this.db.transaction(async (tx) => {
      const authorizingRole = await this.finance(tx, actor);
      return this.once(
        tx,
        actor,
        null,
        this.request.idempotencyKey,
        "redemption.batch.create",
        payload,
        async () => {
          await this.fresh(tx, actor);
          const at = await this.at(tx);
          const input =
            typeof inputSource === "function" ? inputSource(at) : inputSource;
          this.validateBatch(input);
          if (Date.parse(input.expiresAt) <= +at)
            fail("REDEMPTION_BATCH_INVALID", 422);
          await this.sku(tx, input.skuVersionId, true);
          const batchId = id();
          await tx.query(
            "INSERT INTO redemption_batches(id,created_at,sku_version_id,name,expires_at,created_by,starts_at,workspace_kinds,distribution_channel) VALUES($1::text,$2,$3,$1::text,$4,$5,$6,$7,$8)",
            [
              batchId,
              at,
              input.skuVersionId,
              input.expiresAt,
              actor.userId,
              input.startsAt,
              input.workspaceKinds,
              input.distributionChannel,
            ],
          );
          const oneTimeCodes = Array.from({ length: input.count }, () =>
            randomBytes(32).toString("base64url"),
          );
          // Raw values never cross the SQL boundary, including replay/audit rows.
          await tx.query(
            "INSERT INTO redemption_codes(id,created_at,batch_id,code_hash,max_uses) SELECT x.id,$2,$3,x.hash,1 FROM unnest($1::text[],$4::text[]) AS x(id,hash)",
            [
              oneTimeCodes.map(() => id()),
              at,
              batchId,
              oneTimeCodes.map((c) => this.codeHash(c)),
            ],
          );
          await audit(
            tx,
            actor,
            this.request,
            "commerce.redemption_batch_created",
            "redemption_batch",
            batchId,
            reason,
            {
              authorizingRole,
              count: input.count,
              skuVersionId: input.skuVersionId,
              distributionChannel: input.distributionChannel,
              maxUsesPerCode: 1,
            },
          );
          return { batch: await this.metadata(tx, batchId), oneTimeCodes };
        },
        (r) => ({ ...r, oneTimeCodes: [] }),
      );
    });
  }
  async createRedemptionBatch(
    actor: Actor,
    input: RedemptionBatchInput,
    reason: string,
  ): Promise<{ batchId: string; oneTimeCodes: string[] }> {
    const result = await this.create(actor, input, reason, { input, reason });
    return { batchId: result.batch.id, oneTimeCodes: result.oneTimeCodes };
  }
  /** Generated-DTO facade: no disconnected download ID or fake output. A replay
   * intentionally omits oneTimeCodes. Lost first responses require reissue. */
  async createBatch(
    actor: Actor,
    input: components["schemas"]["RedemptionBatchCreate"],
  ): Promise<BatchCreated> {
    // Resolve retained replay before computing new-admission defaults. The start
    // time belongs only to the first creation's authoritative SQL transaction.
    const result = await this.create(
      actor,
      (at) => ({
        ...input,
        startsAt: at.toISOString(),
        workspaceKinds: ["personal", "studio"],
        distributionChannel: "admin",
      }),
      input.reason,
      input,
    );
    return {
      ...result.batch,
      ...(result.oneTimeCodes.length
        ? { oneTimeCodes: result.oneTimeCodes }
        : {}),
    };
  }
  async redeemCode(
    actor: Actor,
    wid: string,
    rawCode: string,
    key: string,
  ): Promise<RedemptionResult> {
    const signals = this.request.signals;
    if (
      !signals ||
      !signals.ip ||
      !signals.deviceId ||
      signals.ip.length > 128 ||
      signals.deviceId.length > 512
    )
      fail("REDEMPTION_SIGNALS_REQUIRED", 503);
    // No network limiter calls while holding account/code/batch locks. Recheck
    // current session and ownership in the actual financial transaction too.
    await this.db.transaction((tx) =>
      this.workspaces.authorize(actor, wid, "purchase", tx),
    );
    await this.options.rateLimiter.consume({
      userId: actor.userId,
      ...signals,
    });
    const hash = this.codeHash(
      typeof rawCode === "string" && rawCode.length <= 128 ? rawCode : "",
    );
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, wid, "purchase", tx);
      return this.once(
        tx,
        actor,
        wid,
        key,
        "redemption.claim",
        { wid, codeHash: hash },
        async () => {
          const reference = (
            await tx.query(
              "SELECT id,batch_id FROM redemption_codes WHERE code_hash=$1",
              [hash],
            )
          ).rows[0];
          if (!reference) fail("REDEMPTION_INVALID", 422);
          // Batch -> code -> common credit account. Disable takes the same batch
          // lock; all benefit issuance serializes under the shared account lock.
          const b = (
            await tx.query(
              "SELECT * FROM redemption_batches WHERE id=$1 FOR UPDATE",
              [reference.batch_id],
            )
          ).rows[0];
          const c = (
            await tx.query(
              "SELECT * FROM redemption_codes WHERE id=$1 FOR UPDATE",
              [reference.id],
            )
          ).rows[0];
          const at = await this.at(tx),
            workspace = (
              await tx.query("SELECT kind FROM workspaces WHERE id=$1", [wid])
            ).rows[0];
          if (
            !b ||
            b.state !== "active" ||
            +b.starts_at > +at ||
            +b.expires_at <= +at ||
            c.state !== "active" ||
            c.used_count >= c.max_uses ||
            !b.workspace_kinds.includes(workspace.kind)
          )
            fail("REDEMPTION_INVALID", 422);
          const prior = await tx.query(
            "SELECT id FROM redemptions WHERE code_id=$1 AND workspace_id=$2",
            [c.id, wid],
          );
          if (prior.rowCount) fail("REDEMPTION_INVALID", 422);
          const sku = await this.sku(tx, b.sku_version_id, false);
          await lockCreditAccount(tx, wid);
          // Re-read the clock after waiting on the shared account lock.
          const accepted = await this.at(tx);
          if (+b.expires_at <= +accepted) fail("REDEMPTION_INVALID", 422);
          let starts = accepted,
            ends: Date | undefined;
          if (sku.skuKind === "membership") {
            const active = (
              await tx.query(
                "SELECT features,ends_at FROM entitlement_grants WHERE workspace_id=$1 AND grant_type='membership' AND state='active' AND ends_at>$2 ORDER BY ends_at,id",
                [wid, accepted],
              )
            ).rows;
            const tierKey = membershipTierKey(sku.features);
            if (active.some((g) => g.features.tierKey !== tierKey))
              fail("MEMBERSHIP_TIER_CONFLICT", 409);
            if (!sku.durationDays) fail("MEMBERSHIP_DURATION_INVALID", 409);
            starts = new Date(
              Math.max(+accepted, ...active.map((g) => +g.ends_at)),
            );
            ends = new Date(+starts + sku.durationDays * 86400000);
          }
          const redemptionId = id(),
            grantIds: string[] = [];
          await tx.query(
            "INSERT INTO redemptions(id,created_at,workspace_id,code_id,user_id,operation_id,sku_version_id) VALUES($1,$2,$3,$4,$5,$6,$7)",
            [
              redemptionId,
              accepted,
              wid,
              c.id,
              actor.userId,
              id(),
              b.sku_version_id,
            ],
          );
          if (ends) {
            const grantId = id();
            grantIds.push(grantId);
            await tx.query(
              "INSERT INTO entitlement_grants(id,created_at,workspace_id,source_redemption_id,grant_type,starts_at,ends_at,features) VALUES($1,$2,$3,$4,'membership',$5,$6,$7)",
              [
                grantId,
                accepted,
                wid,
                redemptionId,
                starts,
                ends,
                {
                  skuId: sku.skuId,
                  skuVersionId: b.sku_version_id,
                  tierKey: membershipTierKey(sku.features),
                  entitlements: sku.features,
                },
              ],
            );
            await tx.query(
              "INSERT INTO subscriptions(id,created_at,workspace_id,entitlement_grant_id,starts_at,ends_at) VALUES($1,$2,$3,$4,$5,$6)",
              [id(), accepted, wid, grantId, starts, ends],
            );
          }
          if (sku.credits > 0) {
            if (!sku.creditValidityDays) fail("CREDIT_VALIDITY_INVALID", 409);
            const grantId = id(),
              lotId = id(),
              expires = new Date(+accepted + sku.creditValidityDays * 86400000);
            grantIds.push(grantId);
            await tx.query(
              "INSERT INTO entitlement_grants(id,created_at,workspace_id,source_redemption_id,grant_type,starts_at,ends_at,features) VALUES($1,$2,$3,$4,'credits',$2,$5,$6)",
              [
                grantId,
                accepted,
                wid,
                redemptionId,
                expires,
                {
                  skuId: sku.skuId,
                  skuVersionId: b.sku_version_id,
                  creditGrant: sku.credits,
                },
              ],
            );
            await tx.query(
              "INSERT INTO credit_lots(id,created_at,workspace_id,source_grant_id,granted,available,expires_at) VALUES($1,$2,$3,$4,$5,$5,$6)",
              [lotId, accepted, wid, grantId, sku.credits, expires],
            );
            await creditLedgerLine(tx, {
              wid,
              lotId,
              groupId: redemptionId,
              line: 1,
              type: "grant",
              amount: sku.credits,
              from: "external",
              to: "available",
              balanceAfter: sku.credits,
              reason: "redemption_fulfillment",
            });
          }
          await syncCreditAccount(tx, wid, accepted);
          await tx.query(
            "UPDATE redemption_codes SET used_count=used_count+1,state=CASE WHEN used_count+1>=max_uses THEN 'exhausted' ELSE state END WHERE id=$1",
            [c.id],
          );
          await tx.query(
            "INSERT INTO outbox(id,workspace_id,event_key,aggregate_kind,aggregate_id,event_type,payload) VALUES($1,$2,$1,'redemption',$3,'commerce.redemption_claimed',$4)",
            [id(), wid, redemptionId, { redemptionId, grantIds }],
          );
          return { redemptionId, grantIds };
        },
      );
    });
  }
  /** HTTP facade projects durable business facts into the generated DTO. */
  async redeem(
    actor: Actor,
    input: components["schemas"]["RedemptionCreate"],
    key: string,
  ): Promise<components["schemas"]["Redemption"]> {
    const result = await this.redeemCode(
      actor,
      input.workspaceId,
      input.code,
      key,
    );
    return this.db.transaction(async (tx) => {
      await this.workspaces.authorize(actor, input.workspaceId, "purchase", tx);
      const r = (
        await tx.query(
          "SELECT * FROM redemptions WHERE workspace_id=$1 AND id=$2",
          [input.workspaceId, result.redemptionId],
        )
      ).rows[0];
      const grants = (
        await tx.query(
          "SELECT features FROM entitlement_grants WHERE workspace_id=$1 AND source_redemption_id=$2 AND grant_type='credits'",
          [input.workspaceId, r.id],
        )
      ).rows;
      return {
        id: r.id,
        workspaceId: r.workspace_id,
        skuVersionId: r.sku_version_id,
        creditGrant: grants.reduce(
          (n, g) => n + Number(g.features.creditGrant),
          0,
        ),
        entitlementGrantIds: result.grantIds,
        redeemedAt: r.created_at.toISOString(),
      };
    });
  }
  async disableRedemptionBatch(
    actor: Actor,
    batchId: string,
    reason: string,
  ): Promise<void> {
    await this.disableBatch(actor, batchId, reason);
  }
  async disableBatch(
    actor: Actor,
    batchId: string,
    reason: string,
  ): Promise<Batch> {
    this.reason(reason);
    return this.db.transaction(async (tx) => {
      const authorizingRole = await this.finance(tx, actor);
      return this.once(
        tx,
        actor,
        null,
        this.request.idempotencyKey,
        "redemption.batch.disable",
        {
          batchId,
          reason,
          expectedRevision: this.request.expectedRevision ?? null,
        },
        async () => {
          await this.fresh(tx, actor);
          const b = (
            await tx.query(
              "SELECT * FROM redemption_batches WHERE id=$1 FOR UPDATE",
              [batchId],
            )
          ).rows[0];
          if (!b) fail("NOT_FOUND", 404);
          if (
            this.request.expectedRevision !== undefined &&
            Number(b.revision) !== this.request.expectedRevision
          )
            fail("REVISION_CONFLICT", 409);
          if (b.state !== "disabled") {
            await tx.query(
              "UPDATE redemption_batches SET state='disabled',revision=revision+1 WHERE id=$1",
              [batchId],
            );
            await audit(
              tx,
              actor,
              this.request,
              "commerce.redemption_batch_disabled",
              "redemption_batch",
              batchId,
              reason,
              {
                authorizingRole,
                previousState: b.state,
                revision: Number(b.revision) + 1,
              },
            );
          }
          return this.metadata(tx, batchId);
        },
      );
    });
  }
}
