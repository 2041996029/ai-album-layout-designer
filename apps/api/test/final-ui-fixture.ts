import { createHmac } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { id, digest, fail } from "@album/server-core";
import { testDatabase } from "./database";
import { storageFixture } from "./asset-fixtures";
import { AuthService } from "../src/auth/identity";
import { WorkspaceService } from "../src/workspaces/service";
import { ReauthService } from "../src/auth/reauthentication";
import { LocalObjectStore } from "../src/assets/object-store";
import { RevisionService } from "../src/projects/revisions";
import { bindCommerceRuntime } from "../src/commerce/runtime";
import { LocalSignedPaymentAdapter } from "../src/payments/adapters";
import type {
  OriginalRefundRequest,
  VerifiedRefundEvent,
} from "../src/commerce/refunds";
import { actualPublishedSkuMaterializer } from "../src/commerce/fulfillment";
import { payloadHash, type ConfigPayload } from "../src/config/types";
import { BrowserPreflight } from "../../export-worker/src/preflight";
import { createApplication } from "../src/app.module";
import type { ApiRuntime } from "../src/http/runtime";
import type { DocumentModel } from "@album/document";
import fixture from "../../../tests/fixtures/documents/minimal.json";

import sharp from "sharp";
import { UploadService } from "../src/assets/upload";
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

/** Disposable production-path fixture, shared by real browser integration checks. */
export async function finalUiFixture(origin: string) {
  const cleanups: Array<() => Promise<unknown>> = [];
  try {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      app: any,
      runtime: ApiRuntime,
      session: any,
      wid: string,
      pid: string,
      skuVersion: string,
      root: string;
    const smsCodes = new Map<string, string>();
    const human = {
      start: async ({ challengeId }: any) => {
        smsCodes.set(challengeId, "654321");
        return { destinationHint: "手机尾号1234" };
      },
      complete: async ({ challengeId, code }: any) => {
        if (smsCodes.get(challengeId) !== code)
          fail("REAUTH_INVALID_CODE", 401);
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
    db = await testDatabase();
    cleanups.push(() => db.close());
    root = await mkdtemp(tmpdir() + "/c4-loop-");
    cleanups.push(() => rm(root, { recursive: true, force: true }));
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
      allowedOrigin: origin,
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
    const uploads = new UploadService(
      db.database,
      workspaces,
      objects,
      {
        readQuota: async () => ({
          limitBytes: 2147483648,
          maxProjectPhotos: 500,
        }),
      },
      storage,
    );
    const image = await sharp({
      create: { width: 8, height: 4, channels: 3, background: "#f00" },
    })
      .png()
      .toBuffer();
    const ticket = await uploads.beginUpload(
      session.actor,
      wid,
      {
        bytes: image.length,
        sha256: digest(image),
        mime: "image/png",
        folderId: null,
        projectId: pid,
      },
      id(),
    );
    await objects.put(
      objects.verify(ticket.url.split("/").at(-1)!, "upload"),
      image,
    );
    const completed = await uploads.completeUpload(
      session.actor,
      wid,
      ticket.uploadId,
      id(),
    );
    const asset = await uploads.getAsset(session.actor, wid, completed.id);
    doc.spreads[0].layers = [
      {
        id: "low-ppi-photo",
        type: "image",
        assetId: asset.id,
        x: 10,
        y: 10,
        width: 150,
        height: 75,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        fitMode: "cover",
        role: "photo",
      },
    ];
    await revisions.saveCloudRevision(
      session.actor,
      wid,
      doc,
      1,
      { assets: [asset.editorResource!], fonts: [] },
      id(),
    );
    app = await createApplication(runtime);
    cleanups.push(() => app.close());

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
          origin,
          "x-csrf-token": session.csrfToken,
          "x-workspace-id": wid,
          "idempotency-key": id(),
          ...headers,
        },
      });
    const order = await call("POST", "/v1/orders", {
      workspaceId: wid,
      skuVersionId: skuVersion,
      channel: "wechat_pay",
      clientPlatform: "web",
    });
    if (order.statusCode !== 201) throw Error(order.body);
    const orderId = order.json().data.id;
    const attempt = await call(
      "POST",
      `/v1/orders/${orderId}/payment-attempts`,
      { clientPlatform: "web" },
    );
    if (attempt.statusCode !== 201) throw Error(attempt.body);
    const event = {
      channel: "wechat_pay",
      eventId: id(),
      transactionId: id(),
      orderId,
      appId: "app",
      merchantId: "merchant",
      amountFen: 123,
      currency: "CNY",
      state: "paid",
      fulfillable: true,
    };
    const raw = JSON.stringify(event),
      timestamp = String(Date.now());
    const receipt = await app.inject({
      method: "POST",
      url: "/v1/payment-callbacks/wechat_pay",
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
    if (receipt.statusCode !== 200) throw Error(receipt.body);
    await db.database.transaction((tx) =>
      tx.query(
        "INSERT INTO admin_role_assignments(id,user_id,role) VALUES($1,$2,'finance')",
        [id(), session.actor.userId],
      ),
    );
    return {
      db,
      app,
      runtime,
      session,
      wid,
      pid,
      orderId,
      smsCodes,
      call,
      close: async () => {
        for (const cleanup of [...cleanups].reverse()) await cleanup();
      },
    };
  } catch (error) {
    for (const cleanup of [...cleanups].reverse()) await cleanup();
    throw error;
  }
}
