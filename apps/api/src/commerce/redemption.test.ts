import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";
import YAML from "yaml";
import { Redis } from "ioredis";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { id, type Actor } from "@album/server-core";
import { testDatabase } from "../../test/database";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
import { PublishedSkuMaterializer } from "./fulfillment";
import type { PublishedSku } from "../payments/types";
import {
  RedemptionService,
  RedisRedemptionRateLimiter,
  type RedemptionBatchInput,
  type RedemptionRequest,
} from "./redemption";

const pepper = "disposable-test-pepper-for-redemption-32bytes";
const features: PublishedSku["features"] = {
  storageBytes: 1000000,
  maxProjectPhotos: 500,
  maxSpreads: 50,
  exportDpis: [72, 150, 300],
  exportConcurrency: 2,
  aiConcurrency: 1,
  seatLimit: 1,
  commercialTemplateSetIds: [],
};
const product = (changes: Partial<PublishedSku> = {}): PublishedSku => ({
  kind: "sku",
  skuId: id(),
  skuKind: "membership",
  name: "Published membership",
  priceFen: 123,
  currency: "CNY",
  durationDays: 30,
  credits: 20,
  creditValidityDays: 30,
  features,
  refundPolicyRef: { id: "refund", version: 1 },
  enabled: true,
  ...changes,
});

describe("redemption creation-only contract", () => {
  it("accepts first response codes but rejects raw codes in list metadata", async () => {
    const spec = YAML.parse(
      await readFile("docs/release-v1.0/contracts/openapi.yaml", "utf8"),
    );
    const disable = spec.paths["/admin/redemption-batches/{batchId}"].delete;
    expect(
      disable.parameters.find((p: any) => p.name === "reason"),
    ).toMatchObject({
      in: "query",
      required: true,
      schema: { type: "string", minLength: 1, maxLength: 500 },
    });
    const ajv = new Ajv2020({ strict: false });
    addFormats(ajv);
    ajv.addSchema({ ...spec, $id: "https://local.invalid/openapi" });
    const data = {
      id: id(),
      skuVersionId: id(),
      count: 1,
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      state: "active",
      revision: 1,
      oneTimeCodes: ["A".repeat(43)],
    };
    const created = ajv.compile({
      $ref:
        "https://local.invalid/openapi#/components/schemas/" +
        (spec.components.schemas.RedemptionBatchCreated
          ? "RedemptionBatchCreated"
          : "RedemptionBatch"),
    });
    const listed = ajv.compile({
      $ref: "https://local.invalid/openapi#/components/schemas/RedemptionBatch",
    });
    expect(created(data)).toBe(true);
    expect(listed(data)).toBe(false);
    expect(created({ ...data, oneTimeCodes: ["short"] })).toBe(false);
    const { oneTimeCodes: _, ...metadata } = data;
    expect(created(metadata)).toBe(true);
  });
});

describe.skipIf(!process.env.C4_TEST_REDIS_URL)(
  "redemption rate limits (Redis)",
  () => {
    it("atomically limits independent user, IP and verified device windows", async () => {
      const url = new URL(process.env.C4_TEST_REDIS_URL!);
      if (!["127.0.0.1", "localhost"].includes(url.hostname))
        throw Error("DISPOSABLE_LOCAL_REDIS_REQUIRED");
      const redis = new Redis(url.toString());
      try {
        const limiter = new RedisRedemptionRateLimiter(redis, pepper + id(), {
          user: 2,
          ip: 2,
          device: 2,
          windowSeconds: 60,
        });
        const signals = { userId: id(), ip: id(), deviceId: id() };
        const attempts = await Promise.allSettled(
          Array.from({ length: 5 }, () => limiter.consume(signals)),
        );
        expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(
          2,
        );
        for (const dimension of ["userId", "ip", "deviceId"] as const) {
          const fresh = { userId: id(), ip: id(), deviceId: id() };
          await limiter.consume(fresh);
          await limiter.consume(fresh);
          const isolated = {
            userId: id(),
            ip: id(),
            deviceId: id(),
            [dimension]: fresh[dimension],
          };
          await expect(limiter.consume(isolated)).rejects.toThrow(
            "RATE_LIMITED",
          );
        }
      } finally {
        await redis.quit();
      }
    });
  },
);

describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "redemption atomic claims (PostgreSQL)",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      auth: AuthService,
      spaces: WorkspaceService,
      service: RedemptionService,
      actor: Actor,
      other: Actor,
      wid: string,
      otherWid: string,
      clock: Date;
    const attempts: Array<{ userId: string; ip: string; deviceId: string }> =
      [];
    let limited = false;
    const request = (key = id()): RedemptionRequest => ({
      idempotencyKey: key,
      reauthProof: "fresh",
      requestId: id(),
      signals: { ip: "127.0.0.1", deviceId: "server-verified-device" },
    });
    const rows = (sql: string, args: unknown[] = []) =>
      db.database.transaction(async (tx) => (await tx.query(sql, args)).rows);
    const login = async (subject: string) =>
      (
        await auth.login(
          {
            exchange: async () => ({
              provider: "wechat",
              appId: "test",
              subject,
              unionId: null,
              openPlatformId: null,
            }),
          },
          id(),
          "web",
        )
      ).actor;
    async function published(sku = product()) {
      const releaseId = id(),
        versionId = id();
      await db.database.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO config_releases(id,environment,release_number,schema_version,manifest_hash,manifest,published_by) VALUES($1,'dev',(SELECT coalesce(max(release_number),0)+1 FROM config_releases),1,$2,$3,$4)",
          [
            releaseId,
            "a".repeat(64),
            { versions: { sku: { id: versionId } } },
            actor.userId,
          ],
        );
        await tx.query(
          "INSERT INTO config_release_items(id,release_id,namespace,schema_version,body_hash,body) VALUES($1,$2,'sku',1,$3,$4)",
          [id(), releaseId, "a".repeat(64), sku],
        );
        await new PublishedSkuMaterializer().materialize(tx, {
          releaseId,
          skuConfigVersionId: versionId,
          sku,
          refundPolicy: { id: "refund", version: 1 },
        });
      });
      return versionId;
    }
    async function batch(
      changes: Partial<RedemptionBatchInput> = {},
      sku = product(),
    ) {
      const input: RedemptionBatchInput = {
        skuVersionId: await published(sku),
        startsAt: new Date(+clock - 1000).toISOString(),
        expiresAt: new Date(+clock + 86400000).toISOString(),
        count: 1,
        maxUsesPerCode: 1,
        workspaceKinds: ["personal", "studio"],
        distributionChannel: "local-test",
        ...changes,
      };
      return service
        .withRequest(request())
        .createRedemptionBatch(actor, input, "Authorized test distribution");
    }
    const redeem = (code: string, key = id(), a = actor, w = wid) =>
      service.withRequest(request()).redeemCode(a, w, code, key);
    beforeAll(async () => {
      db = await testDatabase();
      auth = new AuthService(db.database, {
        secret: "test-only-redemption-auth-secret-32bytes",
        environment: "dev",
      });
      spaces = new WorkspaceService(db.database, auth);
      actor = await login("redemption-finance");
      other = await login("redemption-other");
      wid = (await spaces.createWorkspace(actor, "personal", id())).workspaceId;
      otherWid = (await spaces.createWorkspace(other, "personal", id()))
        .workspaceId;
      await rows(
        "INSERT INTO admin_role_assignments(id,user_id,role) VALUES($1,$2,'finance')",
        [id(), actor.userId],
      );
      clock = new Date();
      service = new RedemptionService(db.database, auth, spaces, {
        pepper,
        now: () => clock,
        reauth: {
          verifyFresh: async (_actor, proof) => {
            if (proof !== "fresh") throw Error("REAUTH_REQUIRED");
          },
        },
        rateLimiter: {
          consume: async (signals) => {
            attempts.push(signals);
            if (limited) throw Error("RATE_LIMITED");
          },
        },
      });
    });
    afterAll(async () => {
      await db?.close();
    });
    it("maps generated DTOs and omits raw codes on replay after the clock advances", async () => {
      const input = {
        skuVersionId: await published(),
        count: 1,
        maxUsesPerCode: 1,
        expiresAt: new Date(+clock + 86400000).toISOString(),
        reason: "controlled admin download",
      };
      const req = request(),
        first = await service.withRequest(req).createBatch(actor, input);
      expect(first.oneTimeCodes).toHaveLength(1);
      const previous = clock;
      clock = new Date(+clock + 1000);
      try {
        const replay = await service.withRequest(req).createBatch(actor, input);
        const { oneTimeCodes: _, ...metadata } = first;
        expect(replay).toEqual(metadata);
      } finally {
        clock = previous;
      }
      const redeemed = await service
        .withRequest(request())
        .redeem(
          actor,
          { workspaceId: wid, code: first.oneTimeCodes![0] },
          id(),
        );
      expect(redeemed.creditGrant).toBe(20);
      expect(redeemed.entitlementGrantIds).toHaveLength(2);
      expect(redeemed.skuVersionId).toBe(input.skuVersionId);
    });
    it("replays expired batch creation within retention before computing new admission defaults", async () => {
      const input = {
        skuVersionId: await published(),
        count: 1,
        maxUsesPerCode: 1,
        expiresAt: new Date(+clock + 1000).toISOString(),
        reason: "short distribution window",
      };
      const req = request(),
        first = await service.withRequest(req).createBatch(actor, input),
        previous = clock;
      clock = new Date(+clock + 2000);
      try {
        const { oneTimeCodes: _, ...metadata } = first;
        expect(
          await service.withRequest(req).createBatch(actor, input),
        ).toEqual(metadata);
        await expect(
          service.withRequest(req).createBatch(actor, { ...input, count: 2 }),
        ).rejects.toThrow("IDEMPOTENCY_MISMATCH");
        await rows(
          "UPDATE admin_role_assignments SET revoked_at=now() WHERE user_id=$1 AND role='finance'",
          [actor.userId],
        );
        await expect(
          service.withRequest(req).createBatch(actor, input),
        ).rejects.toThrow("FORBIDDEN");
      } finally {
        clock = previous;
        await rows(
          "UPDATE admin_role_assignments SET revoked_at=NULL WHERE user_id=$1 AND role='finance'",
          [actor.userId],
        );
      }
    });
    it("records the verified finance authorizing role on creation and disable audit events", async () => {
      const b = await batch();
      await service
        .withRequest({ ...request(), expectedRevision: 1 })
        .disableRedemptionBatch(actor, b.batchId, "distribution ended");
      const events = await rows(
        "SELECT action,actor_user_id,redacted_details FROM audit_events WHERE target_id=$1 ORDER BY created_at,id",
        [b.batchId],
      );
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.action).sort()).toEqual([
        "commerce.redemption_batch_created",
        "commerce.redemption_batch_disabled",
      ]);
      for (const event of events) {
        expect(event.actor_user_id).toBe(actor.userId);
        expect(event.redacted_details).toMatchObject({
          authorizingRole: "finance",
        });
      }
    });
    it("serializes different codes under the common account lock and batch disable lock", async () => {
      const b = await batch({ count: 3 });
      const claimed = await Promise.all(
        b.oneTimeCodes.slice(0, 2).map((c) => redeem(c)),
      );
      const memberships = await rows(
        "SELECT * FROM entitlement_grants WHERE workspace_id=$1 AND source_redemption_id=ANY($2::text[]) AND grant_type='membership' ORDER BY starts_at",
        [wid, claimed.map((r) => r.redemptionId)],
      );
      expect(memberships).toHaveLength(2);
      expect(memberships[1].starts_at).toEqual(memberships[0].ends_at);
      const raced = await Promise.allSettled([
        redeem(b.oneTimeCodes[2]),
        service
          .withRequest({ ...request(), expectedRevision: 1 })
          .disableRedemptionBatch(actor, b.batchId, "stop distribution"),
      ]);
      expect(raced[1].status).toBe("fulfilled");
      await expect(
        redeem(b.oneTimeCodes[2], id(), other, otherWid),
      ).rejects.toThrow("REDEMPTION_INVALID");
      const claims = await rows(
        "SELECT r.id FROM redemptions r JOIN redemption_codes c ON c.id=r.code_id WHERE c.batch_id=$1",
        [b.batchId],
      );
      expect(claims).toHaveLength(raced[0].status === "fulfilled" ? 3 : 2);
    });
    it("persists hashes only and returns no raw codes on creation key replay", async () => {
      const version = await published(),
        input: RedemptionBatchInput = {
          skuVersionId: version,
          startsAt: clock.toISOString(),
          expiresAt: new Date(+clock + 86400000).toISOString(),
          count: 3,
          maxUsesPerCode: 1,
          workspaceKinds: ["personal"],
          distributionChannel: "private",
        },
        ctx = request();
      const first = await service
        .withRequest(ctx)
        .createRedemptionBatch(actor, input, "distribution");
      expect(first.oneTimeCodes).toHaveLength(3);
      expect(new Set(first.oneTimeCodes).size).toBe(3);
      for (const code of first.oneTimeCodes)
        expect(Buffer.from(code, "base64url").length).toBeGreaterThanOrEqual(
          16,
        );
      expect(
        await service
          .withRequest(ctx)
          .createRedemptionBatch(actor, input, "distribution"),
      ).toEqual({ batchId: first.batchId, oneTimeCodes: [] });
      const dump = JSON.stringify(
        await rows(
          "SELECT row_to_json(b) row FROM redemption_batches b UNION ALL SELECT row_to_json(c) FROM redemption_codes c UNION ALL SELECT row_to_json(i) FROM idempotency_keys i UNION ALL SELECT row_to_json(a) FROM audit_events a",
        ),
      );
      for (const code of first.oneTimeCodes) expect(dump).not.toContain(code);
      const hashes = await rows(
        "SELECT code_hash FROM redemption_codes WHERE batch_id=$1",
        [first.batchId],
      );
      expect(hashes.map((x) => x.code_hash)).toEqual(
        expect.arrayContaining(
          first.oneTimeCodes.map((c) =>
            createHmac("sha256", pepper)
              .update("redemption:" + c)
              .digest("hex"),
          ),
        ),
      );
      await expect(
        service
          .withRequest(ctx)
          .createRedemptionBatch(actor, { ...input, count: 2 }, "distribution"),
      ).rejects.toThrow("IDEMPOTENCY_MISMATCH");
    });
    it("allows one concurrent claim across workspaces, replay returns exactly the same grants", async () => {
      const b = await batch(),
        code = b.oneTimeCodes[0],
        key = id();
      const results = await Promise.allSettled([
        redeem(code, key),
        redeem(code, id(), other, otherWid),
      ]);
      const successes = results.filter((r) => r.status === "fulfilled");
      expect(successes).toHaveLength(1);
      const winner =
        results[0].status === "fulfilled"
          ? { a: actor, w: wid, k: key }
          : { a: other, w: otherWid, k: undefined };
      if (winner.k)
        expect(await redeem(code, winner.k, winner.a, winner.w)).toEqual(
          (results[0] as PromiseFulfilledResult<unknown>).value,
        );
      const grants = await rows(
        "SELECT g.* FROM entitlement_grants g JOIN redemptions r ON r.workspace_id=g.workspace_id AND r.id=g.source_redemption_id WHERE r.code_id IN (SELECT id FROM redemption_codes WHERE batch_id=$1)",
        [b.batchId],
      );
      expect(grants).toHaveLength(2);
      expect(grants.every((g) => g.source_order_id === null)).toBe(true);
      expect(
        await rows("SELECT * FROM credit_ledger WHERE operation_group_id=$1", [
          grants[0].source_redemption_id,
        ]),
      ).toHaveLength(1);
      expect(await rows("SELECT * FROM orders")).toHaveLength(0);
    });
    it("deduplicates 20 concurrent same-key attempts and binds workspace payload and operation", async () => {
      const b = await batch(),
        key = id(),
        code = b.oneTimeCodes[0];
      const all = await Promise.all(
        Array.from({ length: 20 }, () => redeem(code, key)),
      );
      for (const result of all) expect(result).toEqual(all[0]);
      await expect(redeem("unknown", key)).rejects.toThrow(
        "IDEMPOTENCY_MISMATCH",
      );
      const [record] = await rows(
        "SELECT * FROM idempotency_keys WHERE workspace_id=$1 AND idempotency_key=$2",
        [wid, key],
      );
      expect(record.principal_scope).toBe("workspace");
      const foreign = id();
      await rows(
        "INSERT INTO idempotency_keys(id,workspace_id,principal_scope,idempotency_key,request_hash,operation,state,response_status,response_json,expires_at) VALUES($1,$2,'workspace',$3,$4,'job.create','completed',200,'{}',now()+interval '7 days')",
        [id(), wid, foreign, "a".repeat(64)],
      );
      await expect(redeem(code, foreign)).rejects.toThrow(
        "IDEMPOTENCY_MISMATCH",
      );
    });
    it("uses generic errors for unknown/used codes and limits user IP and verified device", async () => {
      const b = await batch();
      await redeem(b.oneTimeCodes[0]);
      await expect(
        redeem(b.oneTimeCodes[0], id(), other, otherWid),
      ).rejects.toThrow("REDEMPTION_INVALID");
      await expect(
        redeem("does-not-exist", id(), other, otherWid),
      ).rejects.toThrow("REDEMPTION_INVALID");
      expect(attempts.at(-1)).toEqual({
        userId: other.userId,
        ip: "127.0.0.1",
        deviceId: "server-verified-device",
      });
      limited = true;
      await expect(redeem("invalid")).rejects.toThrow("RATE_LIMITED");
      limited = false;
      await expect(
        service.redeemCode(actor, wid, "unknown", id()),
      ).rejects.toThrow("REDEMPTION_SIGNALS_REQUIRED");
    });
    it("checks owner and current live finance/session/reason/proof rather than actor permission hints", async () => {
      const b = await batch();
      await rows(
        "INSERT INTO workspace_members(id,workspace_id,user_id,role) VALUES($1,$2,$3,'viewer')",
        [id(), wid, other.userId],
      );
      await expect(redeem(b.oneTimeCodes[0], id(), other, wid)).rejects.toThrow(
        "FORBIDDEN",
      );
      await expect(
        service
          .withRequest(request())
          .disableRedemptionBatch(
            { ...other, platformPermissions: ["platform.finance.redemption"] },
            b.batchId,
            "reason",
          ),
      ).rejects.toThrow("FORBIDDEN");
      await expect(
        service
          .withRequest(request())
          .disableRedemptionBatch(actor, b.batchId, " "),
      ).rejects.toThrow("REASON_REQUIRED");
      await expect(
        service
          .withRequest({ ...request(), reauthProof: "" })
          .disableRedemptionBatch(actor, b.batchId, "reason"),
      ).rejects.toThrow("REAUTH_REQUIRED");
      const dead = await login("expired-finance");
      await rows("UPDATE auth_sessions SET revoked_at=now() WHERE id=$1", [
        dead.sessionId,
      ]);
      await expect(
        service
          .withRequest(request())
          .disableRedemptionBatch(dead, b.batchId, "reason"),
      ).rejects.toThrow("UNAUTHORIZED");
    });
    it("enforces durable starts/expiry/workspace kinds after idempotency cleanup", async () => {
      const future = await batch({
        startsAt: new Date(+clock + 3600000).toISOString(),
      });
      await rows("DELETE FROM idempotency_keys");
      await expect(redeem(future.oneTimeCodes[0])).rejects.toThrow(
        "REDEMPTION_INVALID",
      );
      const studio = await batch({ workspaceKinds: ["studio"] });
      await expect(redeem(studio.oneTimeCodes[0])).rejects.toThrow(
        "REDEMPTION_INVALID",
      );
      const expired = await batch();
      const original = clock;
      clock = new Date(+clock + 2 * 86400000);
      await expect(redeem(expired.oneTimeCodes[0])).rejects.toThrow(
        "REDEMPTION_INVALID",
      );
      clock = original;
      await expect(
        rows(
          "UPDATE redemption_batches SET workspace_kinds=ARRAY['studio'] WHERE id=$1",
          [future.batchId],
        ),
      ).rejects.toThrow();
    });
    it("stacks monthly and yearly features, rejects cross-tier before consuming the code", async () => {
      const first = await batch(),
        a = await redeem(first.oneTimeCodes[0]);
      const year = await batch({}, product({ durationDays: 365 }));
      await redeem(year.oneTimeCodes[0]);
      const [monthly] = await rows(
        "SELECT * FROM entitlement_grants WHERE id=ANY($1::text[]) AND grant_type='membership'",
        [a.grantIds],
      );
      const memberships = await rows(
        "SELECT * FROM entitlement_grants WHERE workspace_id=$1 AND grant_type='membership' AND starts_at=$2",
        [wid, monthly.ends_at],
      );
      expect(memberships.length).toBeGreaterThan(0);
      const conflict = await batch(
        {},
        product({ features: { ...features, storageBytes: 9999999 } }),
      );
      await expect(redeem(conflict.oneTimeCodes[0])).rejects.toThrow(
        "MEMBERSHIP_TIER_CONFLICT",
      );
      const [c] = await rows(
        "SELECT used_count FROM redemption_codes WHERE batch_id=$1",
        [conflict.batchId],
      );
      expect(c.used_count).toBe(0);
      expect(
        await rows(
          "SELECT r.id FROM redemptions r JOIN redemption_codes c ON c.id=r.code_id WHERE c.batch_id=$1",
          [conflict.batchId],
        ),
      ).toHaveLength(0);
    });
    it("disable blocks fresh claims without revoking issued grants and CAS guards admin changes", async () => {
      const b = await batch({ count: 2 }),
        r = await redeem(b.oneTimeCodes[0]),
        before = await rows(
          "SELECT * FROM entitlement_grants WHERE id=ANY($1::text[])",
          [r.grantIds],
        );
      const req = { ...request(), expectedRevision: 1 };
      await service
        .withRequest(req)
        .disableRedemptionBatch(actor, b.batchId, "distribution ended");
      expect(
        await rows(
          "SELECT * FROM entitlement_grants WHERE id=ANY($1::text[])",
          [r.grantIds],
        ),
      ).toEqual(before);
      await expect(redeem(b.oneTimeCodes[1])).rejects.toThrow(
        "REDEMPTION_INVALID",
      );
      await expect(
        service
          .withRequest({ ...request(), expectedRevision: 1 })
          .disableRedemptionBatch(actor, b.batchId, "stale"),
      ).rejects.toThrow("REVISION_CONFLICT");
      expect(
        await rows(
          "SELECT * FROM audit_events WHERE target_id=$1 AND action='commerce.redemption_batch_disabled'",
          [b.batchId],
        ),
      ).toHaveLength(1);
    });
    it("creates only actual published enabled SKU versions and freezes benefits after batch creation", async () => {
      await expect(batch({ skuVersionId: id() })).rejects.toThrow(
        "SKU_UNPUBLISHED",
      );
      const b = await batch();
      await rows(
        "UPDATE billing_skus SET state='retired' WHERE id=(SELECT sku_id FROM sku_versions WHERE id=(SELECT sku_version_id FROM redemption_batches WHERE id=$1))",
        [b.batchId],
      );
      await expect(redeem(b.oneTimeCodes[0])).resolves.toHaveProperty(
        "grantIds",
      );
      const [v] = await rows(
        "SELECT sku_version_id FROM redemption_batches WHERE id=$1",
        [b.batchId],
      );
      await expect(batch({ skuVersionId: v.sku_version_id })).rejects.toThrow(
        "SKU_UNPUBLISHED",
      );
      await expect(batch({ maxUsesPerCode: 2 })).rejects.toThrow(
        "REDEMPTION_BATCH_INVALID",
      );
    });
    it("rolls back code use, grants, lots and ledger when ledger insertion fails", async () => {
      const b = await batch();
      await rows(
        "CREATE FUNCTION reject_test_redemption_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.reason_code='redemption_fulfillment' THEN RAISE EXCEPTION 'LEDGER_FAILURE'; END IF; RETURN NEW; END; $$",
      );
      await rows(
        "CREATE TRIGGER test_ledger_failure BEFORE INSERT ON credit_ledger FOR EACH ROW EXECUTE FUNCTION reject_test_redemption_ledger()",
      );
      try {
        await expect(redeem(b.oneTimeCodes[0])).rejects.toThrow(
          "LEDGER_FAILURE",
        );
        expect(
          (
            await rows(
              "SELECT used_count FROM redemption_codes WHERE batch_id=$1",
              [b.batchId],
            )
          )[0].used_count,
        ).toBe(0);
        expect(
          await rows(
            "SELECT * FROM redemptions WHERE code_id IN (SELECT id FROM redemption_codes WHERE batch_id=$1)",
            [b.batchId],
          ),
        ).toHaveLength(0);
      } finally {
        await rows("DROP TRIGGER test_ledger_failure ON credit_ledger");
      }
      await expect(redeem(b.oneTimeCodes[0])).resolves.toHaveProperty(
        "redemptionId",
      );
    });
  },
);
