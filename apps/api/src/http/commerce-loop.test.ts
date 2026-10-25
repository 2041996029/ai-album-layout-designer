import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { id, digest, fail } from "@album/server-core";
import { testDatabase } from "../../test/database";
import { storageFixture } from "../../test/asset-fixtures";
import { AuthService } from "../auth/identity";
import { WorkspaceService } from "../workspaces/service";
import { ReauthService } from "../auth/reauthentication";
import { LocalObjectStore } from "../assets/object-store";
import { RevisionService } from "../projects/revisions";
import { bindCommerceRuntime } from "../commerce/runtime";
import { startCommerceHost } from "../commerce/host";
import { LocalSignedPaymentAdapter } from "../payments/adapters";
import type {
  OriginalRefundRequest,
  VerifiedRefundEvent,
} from "../commerce/refunds";
import { actualPublishedSkuMaterializer } from "../commerce/fulfillment";
import { payloadHash, type ConfigPayload } from "../config/types";
import { BrowserPreflight } from "../../../export-worker/src/preflight";
import { createApplication } from "../app.module";
import type { ApiRuntime } from "./runtime";
import type { DocumentModel } from "@album/document";
import fixture from "../../../../tests/fixtures/documents/minimal.json";
const secret = "local-integration-signature-secret-000000000";
class SignedRefundAdapter extends LocalSignedPaymentAdapter {
  async verifyRefundEvent(raw: Uint8Array, headers: Record<string, string>) {
    const verified = await this.verifyEvent(raw, headers);
    const fields = JSON.parse(Buffer.from(raw).toString());
    return {
      ...verified,
      refundId: fields.refundId,
      providerRefundId: fields.providerRefundId,
      refundState: fields.refundState,
    } as VerifiedRefundEvent;
  }
  async queryOriginalRefund(_request: OriginalRefundRequest) {
    return null;
  }
}
describe.skipIf(
  !process.env.C3_TEST_DATABASE_URL || !process.env.C4_TEST_REDIS_URL,
)("composed signed purchase through real render and refund", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>,
    app: any,
    runtime: ApiRuntime,
    session: any,
    wid: string,
    pid: string,
    skuVersion: string,
    root: string,
    host: ReturnType<typeof startCommerceHost> | undefined;
  const smsCodes = new Map<string, string>();
  const human = {
    start: async ({ challengeId }: any) => {
      smsCodes.set(challengeId, "654321");
      return { destinationHint: "手机尾号1234" };
    },
    complete: async ({ challengeId, code }: any) => {
      if (smsCodes.get(challengeId) !== code) fail("REAUTH_INVALID_CODE", 401);
      smsCodes.delete(challengeId);
      return {
        provider: "sms" as const,
        appId: "loop-sms",
        subject: "loop-owner-phone",
        unionId: null,
        openPlatformId: null,
      };
    },
  };
  const call = (
    method: string,
    url: string,
    payload?: unknown,
    headers: Record<string, string> = {},
  ) =>
    app.inject({
      method,
      url,
      payload,
      headers: {
        cookie: `album_session=${session.accessToken}`,
        origin: "https://album.test",
        "x-csrf-token": session.csrfToken,
        "x-workspace-id": wid,
        "idempotency-key": id(),
        ...headers,
      },
    });
  const send = (kind: string, event: any, raw = JSON.stringify(event)) => {
    const timestamp = String(Date.now());
    return app.inject({
      method: "POST",
      url: `/v1/${kind}-callbacks/wechat_pay`,
      payload: raw,
      headers: {
        "content-type": "application/json",
        "x-payment-timestamp": timestamp,
        "x-payment-signature": createHmac("sha256", secret)
          .update(timestamp + ".")
          .update(raw)
          .digest("hex"),
      },
    });
  };
  beforeAll(async () => {
    for (const config of [
      "apps/web/vite.config.ts",
      "apps/export-worker/vite.config.ts",
    ])
      execFileSync(
        process.execPath,
        ["node_modules/vite/bin/vite.js", "build", "--config", config],
        { stdio: "pipe" },
      );
    db = await testDatabase();
    root = await mkdtemp(tmpdir() + "/c4-loop-");
    const auth = new AuthService(db.database, {
      secret: "x".repeat(40),
      environment: "dev",
    });
    const login = await auth.login(
      {
        exchange: async () => ({
          provider: "wechat",
          appId: "loop",
          subject: "owner",
          unionId: null,
          openPlatformId: null,
        }),
      },
      id(),
      "mini",
    );
    session = await auth.createWebSession(login.actor);
    const workspaces = new WorkspaceService(db.database, auth);
    wid = (await workspaces.createWorkspace(session.actor, "personal", id()))
      .workspaceId;
    const storage = await storageFixture(db.database),
      objects = new LocalObjectStore({
        root,
        secret: "o".repeat(40),
        environment: "dev",
        baseUrl: "http://127.0.0.1",
      });
    const revisions = new RevisionService(
      db.database,
      workspaces,
      objects,
      storage,
    );
    pid = id();
    const doc = structuredClone(fixture) as DocumentModel;
    doc.projectId = pid;
    doc.pageSize = { width: 200, height: 200 };
    await revisions.createInitialProject(
      session.actor,
      wid,
      doc,
      { assets: [], fonts: [] },
      id(),
      "Closed loop",
    );
    const features = {
      storageBytes: 2147483648,
      maxProjectPhotos: 500,
      maxSpreads: 50,
      exportDpis: [72, 150, 300] as (72 | 150 | 300)[],
      exportConcurrency: 2,
      aiConcurrency: 1,
      seatLimit: 1,
      commercialTemplateSetIds: [],
    };
    const payloads: ConfigPayload[] = [
      {
        kind: "sku",
        skuId: "actual-test-membership",
        skuKind: "membership",
        name: "Local test membership",
        priceFen: 123,
        currency: "CNY",
        durationDays: 30,
        credits: 20,
        creditValidityDays: 30,
        features,
        refundPolicyRef: { id: "refund-policy", version: 1 },
        enabled: true,
      },
      {
        kind: "payment",
        channel: "wechat_pay",
        appId: "app",
        merchantId: "merchant",
        credential: { secretRef: "local", secretVersion: "v1" },
        verificationKeyRef: "verify",
        callbackUrl: "https://local.invalid",
        refundEnabled: true,
        platformCapabilityRef: { id: "local-approved", version: 1 },
        enabled: true,
      },
      {
        kind: "workspace",
        defaultFeatures: {
          ...features,
          exportDpis: [72],
          exportConcurrency: 1,
        },
        roles: ["owner", "admin", "designer", "viewer"],
        designerCanDeleteUnusedAssets: false,
        seatInvitationEnabled: false,
        byosEnabled: false,
        byokEnabled: false,
      },
      {
        kind: "export",
        allowedFormats: ["png", "jpeg", "pdf"],
        allowedDpis: [72, 150, 300],
        maxSurfacePixels: 50000000,
        browserBudgetMiB: 768,
        workerBudgetMiB: 2048,
        ppiWarning: 200,
        ppiStrongWarning: 100,
        outputRetentionDays: 7,
        jpegQuality: 0.9,
        jpegMatte: "#FFFFFF",
      },
      {
        kind: "queue",
        workerKind: "export",
        maxGlobalConcurrency: 4,
        maxWorkspaceConcurrency: 2,
        leaseSeconds: 60,
        heartbeatSeconds: 5,
        retryLimit: 3,
        maxWaitingSeconds: 600,
        retryBackoffSeconds: [10, 30, 90],
        maxAttemptsPerTask: 4,
      } as ConfigPayload,
    ];
    const versions = Object.fromEntries(
      payloads.map((payload) => [
        payload.kind,
        {
          id: id(),
          namespace: payload.kind,
          version: 1,
          revision: 1,
          environment: "dev",
          state: "published",
          payload,
          payloadHash: payloadHash(payload),
        },
      ]),
    );
    const releaseId = id(),
      manifest = {
        versions,
        sourceDrafts: {},
        reason: "Local contract test",
        previousReleaseId: null,
      };
    skuVersion = versions.sku.id;
    await db.database.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO config_releases(id,environment,release_number,schema_version,manifest_hash,manifest,published_by) VALUES($1,'dev',1,1,$2,$3,$4)",
        [releaseId, payloadHash(manifest), manifest, session.actor.userId],
      );
      for (const v of Object.values(versions))
        await tx.query(
          "INSERT INTO config_release_items(id,release_id,namespace,schema_version,body_hash,body) VALUES($1,$2,$3,1,$4,$5)",
          [id(), releaseId, v.namespace, v.payloadHash, v.payload],
        );
      await tx.query(
        "INSERT INTO config_active_releases(id,environment,release_id) VALUES($1,'dev',$2)",
        [id(), releaseId],
      );
      await actualPublishedSkuMaterializer.materialize(tx, {
        releaseId,
        skuConfigVersionId: skuVersion,
        sku: payloads[0] as any,
        refundPolicy: { allowUnusedMembership: true, allowUnusedCredits: true },
      });
    });
    runtime = {
      db: db.database,
      auth,
      workspaces,
      environment: "dev",
      allowedOrigin: "https://album.test",
      revisions,
    };
    const adapter = new SignedRefundAdapter({
      environment: "dev",
      channel: "wechat_pay",
      secret,
      transport: {
        create: async () => ({
          clientPayload: { kind: "qr", qrPayload: "weixin://local-test" },
        }),
        query: async () => null,
        close: async () => null,
      },
    });
    await db.database.transaction((tx) =>
      tx.query(
        "INSERT INTO auth_identities(id,user_id,provider,app_id,subject_digest,verified_at) VALUES($1,$2,'phone','loop-sms',$3,now())",
        [id(), session.actor.userId, auth.hash("loop-owner-phone")],
      ),
    );
    await bindCommerceRuntime(
      runtime,
      new ReauthService(db.database, auth, {}, human),
      {
        paymentBindings: [
          {
            id: versions.payment.id,
            adapter,
            refundAdapter: adapter,
            callbackChannel: "wechat_pay",
            ack: { code: "SUCCESS", message: "成功" },
          },
        ],
        admission: {
          admit: async () => ({
            refundPolicy: {
              allowUnusedMembership: true,
              allowUnusedCredits: true,
            },
          }),
        },
        config: {
          readiness: { purchase: "available", cloudExport: "available" },
        },
        exports: {
          objects,
          storage,
          preflight: new BrowserPreflight({
            objects,
            chromiumPath: process.env.CHROMIUM_PATH,
          }),
          renderer: {
            version: "c1-cpu-fabric-v1",
            imageDigest: "sha256:" + digest("local-runtime"),
          },
          tokenSecret: "export-token-secret-".repeat(4),
        },
      },
    );
    app = await createApplication(runtime);
  }, 90000);
  afterAll(async () => {
    await host?.close();
    await app?.close();
    await db?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });
  it("binds every C4 operation and completes 100 exact-byte callbacks → one grant → durable queue export → verified refund → reconciliation", async () => {
    const { contract } = await import("./contracts").then((m) =>
      m.loadContracts(),
    );
    for (const path of Object.values(contract.paths) as any[])
      for (const operation of Object.values(path) as any[])
        if (operation["x-module"] === "C4")
          expect(
            runtime.operationHandlers?.[operation.operationId],
            operation.operationId,
          ).toBeTypeOf("function");
    const catalog = await call("GET", "/v1/skus?platform=web");
    expect(catalog.statusCode, catalog.body).toBe(200);
    expect(catalog.json().data.items[0].priceFen).toBe(123);
    const order = await call("POST", "/v1/orders", {
      workspaceId: wid,
      skuVersionId: skuVersion,
      channel: "wechat_pay",
      clientPlatform: "web",
    });
    expect(order.statusCode, order.body).toBe(201);
    const oid = order.json().data.id;
    const launch = await call("POST", `/v1/orders/${oid}/payment-attempts`, {
      clientPlatform: "web",
    });
    expect(launch.statusCode, launch.body).toBe(201);
    expect(launch.json().data.launch).toEqual({
      kind: "qr",
      qrPayload: "weixin://local-test",
    });
    const event = {
      channel: "wechat_pay",
      eventId: "receipt",
      transactionId: "capture",
      orderId: oid,
      appId: "app",
      merchantId: "merchant",
      amountFen: 123,
      currency: "CNY",
      state: "paid",
      fulfillable: true,
    };
    const raw = "  " + JSON.stringify(event, null, 2) + "\n";
    const callbacks = await Promise.all(
      Array.from({ length: 100 }, () => send("payment", event, raw)),
    );
    for (const r of callbacks) expect(r.statusCode, r.body).toBe(200);
    expect(
      (
        await db.pool.query(
          "SELECT count(*) FROM ai_album.entitlement_grants WHERE source_order_id=$1",
          [oid],
        )
      ).rows[0].count,
    ).toBe("2");
    const entitlement = await call("GET", `/v1/workspaces/${wid}/entitlements`);
    expect(entitlement.statusCode, entitlement.body).toBe(200);
    expect(entitlement.json().data).toMatchObject({
      maxDpi: 300,
      watermarkRequired: false,
      availableCredits: 20,
    });
    const preflight = await call("POST", `/v1/projects/${pid}/preflight`, {
      revision: 1,
      exportSpec: {
        format: "png",
        dpi: 150,
        view: "spread",
        pageIds: ["spread_1"],
        includeCover: false,
        bleedMm: 0,
        jpegMatte: "#FFFFFF",
      },
    });
    expect(preflight.statusCode, preflight.body).toBe(200);
    const p = preflight.json().data;
    const accepted = await call("POST", "/v1/export-jobs", {
      workspaceId: wid,
      projectId: pid,
      revision: 1,
      preflightToken: p.preflightToken,
      normalizedSpecHash: p.normalizedSpecHash,
      warningsAcknowledged: [],
    });
    expect(accepted.statusCode, accepted.body).toBe(202);
    const originalJobId = accepted.json().data.id;
    const cancelled = await call("POST", `/v1/jobs/${originalJobId}/cancel`, {
      reason: "retry integration",
    });
    expect(cancelled.statusCode, cancelled.body).toBe(202);
    const preflightPort = runtime.commerce!.options.exports!.preflight,
      check = preflightPort.check.bind(preflightPort);
    preflightPort.check = async (...args) => {
      const report = await check(...args);
      return {
        ...report,
        warnings: [
          ...report.warnings,
          {
            id: "changed-strong-warning",
            code: "LOW_PPI",
            path: "spreads[0]",
            severity: "warning",
            level: "strong",
            message: "changed warning",
          },
        ],
      };
    };
    const changedWarning = await call(
      "POST",
      `/v1/jobs/${originalJobId}/retry`,
      {
        expectedRevision: cancelled.json().data.revision,
        reason: "new warning needs confirmation",
      },
    );
    expect(changedWarning.statusCode, changedWarning.body).toBe(409);
    expect(changedWarning.json().error.code).toBe("FRESH_PREFLIGHT_REQUIRED");
    preflightPort.check = check;
    const retryKey = id(),
      retryBody = {
        expectedRevision: cancelled.json().data.revision,
        reason: "retry integration",
      };
    const retried = await call(
      "POST",
      `/v1/jobs/${originalJobId}/retry`,
      retryBody,
      { "idempotency-key": retryKey },
    );
    expect(retried.statusCode, retried.body).toBe(202);
    const jid = retried.json().data.id;
    expect(jid).not.toBe(originalJobId);
    expect(retried.json().data.parentJobId).toBe(originalJobId);
    const replay = await call(
      "POST",
      `/v1/jobs/${originalJobId}/retry`,
      retryBody,
      { "idempotency-key": retryKey },
    );
    expect(replay.statusCode, replay.body).toBe(202);
    expect(replay.json().data.id).toBe(jid);
    expect(
      (
        await db.pool.query(
          "SELECT count(*) FROM ai_album.audit_events WHERE action='job.retry' AND target_id=$1",
          [jid],
        )
      ).rows[0].count,
    ).toBe("1");
    host = startCommerceHost(runtime, process.env.C4_TEST_REDIS_URL);
    await host.recover();
    await expect
      .poll(
        async () => {
          const result = await call("GET", `/v1/jobs/${jid}`);
          return result.json().data?.state;
        },
        { timeout: 90000 },
      )
      .toBe("succeeded");
    const outputs = await call("GET", `/v1/jobs/${jid}/outputs`);
    expect(outputs.statusCode, outputs.body).toBe(200);
    expect(outputs.json().data.items.length).toBeGreaterThan(0);
    expect(outputs.json().data.items[0].sizeBytes).toBeGreaterThan(100);
    const download = await call(
      "POST",
      `/v1/outputs/${outputs.json().data.items[0].id}/download-token`,
    );
    expect(download.statusCode, download.body).toBe(200);
    const paid = await call("GET", `/v1/orders/${oid}`);
    const challenge = await call(
      "POST",
      "/v1/auth/reauthentication/challenges",
      { purpose: "billing_refund" },
    );
    expect(challenge.statusCode, challenge.body).toBe(200);
    const challengeId = challenge.json().data.id;
    const verification = await call("POST", "/v1/auth/reauthenticate", {
      purpose: "billing_refund",
      proof: {
        provider: "phone",
        challengeId,
        proof: smsCodes.get(challengeId),
        purpose: "billing_refund",
      },
    });
    expect(verification.statusCode, verification.body).toBe(200);
    const proof = verification.json().data.reauthProof;
    const refund = await call(
      "POST",
      `/v1/orders/${oid}/refunds`,
      {
        amountFen: 123,
        reason: "local test refund",
        expectedOrderRevision: paid.json().data.revision,
      },
      {
        "if-match": `"${paid.json().data.revision}"`,
        "x-reauthentication-proof": proof,
      },
    );
    expect(refund.statusCode, refund.body).toBe(202);
    expect(refund.json().data.state).toBe("manual_review");
    const refunded = {
      ...event,
      eventId: "refund-receipt",
      state: "refunded",
      refundId: refund.json().data.id,
      providerRefundId: "provider-refund",
      refundState: "succeeded",
    };
    const result = await send("refund", refunded);
    expect(result.statusCode, result.body).toBe(200);
    const history = await call("GET", `/v1/workspaces/${wid}/refunds`);
    expect(history.statusCode, history.body).toBe(200);
    expect(history.json().data.items).toEqual([
      expect.objectContaining({
        id: refund.json().data.id,
        state: "succeeded",
      }),
    ]);
    expect(
      (
        await db.pool.query(
          "SELECT consumed_at,purpose,session_id FROM ai_album.reauth_proofs WHERE token_hash=$1",
          [runtime.auth.hash(proof)],
        )
      ).rows[0],
    ).toMatchObject({
      consumed_at: expect.any(Date),
      purpose: "billing_refund",
      session_id: session.actor.sessionId,
    });
    const report = await runtime.commerce!.reconciliation.reconcileStatement(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(
        new Date(),
      ),
      [
        {
          channel: "wechat_pay",
          transactionId: "capture",
          orderId: oid,
          paidFen: 123,
          refundedFen: 123,
        },
      ],
    );
    expect(report.matched).toBe(0);
    expect(report.reviewIds).toHaveLength(1);
    const repeated = await runtime.commerce!.reconciliation.reconcileStatement(
      new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(
        new Date(),
      ),
      [
        {
          channel: "wechat_pay",
          transactionId: "capture",
          orderId: oid,
          paidFen: 123,
          refundedFen: 123,
        },
      ],
    );
    expect(repeated).toEqual(report);
    expect(
      (
        await db.pool.query(
          "SELECT count(*) FROM ai_album.entitlement_grants WHERE source_order_id=$1",
          [oid],
        )
      ).rows[0].count,
    ).toBe("2");
  }, 150000);
});
