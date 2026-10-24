import { sqlPage, mapPage, arrayPage } from "./pagination";
import { fail, id, runIdempotent } from "@album/server-core";
import type { components } from "@album/contracts";
import type { ApiRuntime } from "../http/runtime";
import type { CommerceRuntime } from "./runtime";
import { requireRoles } from "../config/secrets";
import { frozenOrderSnapshot } from "../payments/orders";
import { membershipTierKey } from "./fulfillment";
import { sourceCreditFrozenSql } from "./credits";
import { CONFIG_REGISTRY, payloadHash } from "../config/types";
type S = components["schemas"];
const date = (v: any) => new Date(v).toISOString();
const need = <T>(v: T | undefined): T => {
  if (!v) fail("UNCONFIGURED", 503);
  return v;
};
const header = (r: any, k: string) => String(r.headers[k.toLowerCase()] ?? "");
const key = (r: any) => header(r, "idempotency-key");
const wid = (r: any) =>
  r.params.workspaceId ??
  r.resolvedWorkspaceId ??
  r.body?.workspaceId ??
  header(r, "x-workspace-id");
const expected = (r: any) => Number(header(r, "if-match").replaceAll('"', ""));
const context = (r: any) => ({
  idempotencyKey: key(r),
  reauthProof: header(r, "x-reauthentication-proof"),
  requestId: id(),
  expectedRevision: expected(r),
});
export const orderDto = (r: any): S["Order"] => ({
  id: r.id,
  workspaceId: r.workspace_id,
  skuVersionId: r.sku_version_id,
  amountFen: Number(r.amount_fen),
  currency: r.currency,
  state: r.state,
  fulfillmentState: r.fulfillment_state,
  channel: r.channel,
  createdAt: date(r.created_at),
  ...(r.paid_at ? { paidAt: date(r.paid_at) } : {}),
  revision: Number(r.revision),
});
const refundDto = (r: any): S["Refund"] => ({
  id: r.id,
  orderId: r.order_id,
  amountFen: Number(r.amount_fen),
  state: r.state,
  reason: r.reason_code,
  reasonCode: r.reason_code,
  createdAt: date(r.created_at),
  revision: Number(r.revision),
});
export function commerceHandlers(
  runtime: ApiRuntime,
  s: CommerceRuntime,
): Record<string, (r: any, reply: any) => Promise<any>> {
  const { db, auth, workspaces } = runtime;
  const finance = (r: any) =>
    db.transaction((tx) => requireRoles(tx, auth, r.actor, ["finance"]));
  const scoped = (
    r: any,
    fn: (tx: any) => Promise<any>,
    action: "read" | "purchase" | "edit" = "read",
  ) =>
    db.transaction(async (tx) => {
      await workspaces.authorize(r.actor, wid(r), action, tx);
      return fn(tx);
    });
  const order = (r: any) =>
    scoped(
      r,
      async (tx) => {
        const row = (
          await tx.query(
            "SELECT * FROM orders WHERE workspace_id=$1 AND id=$2",
            [wid(r), r.params.orderId],
          )
        ).rows[0];
        if (!row) fail("NOT_FOUND", 404);
        return orderDto(row);
      },
      "purchase",
    );
  const job = async (r: any, jobId = r.params.jobId) =>
    scoped(r, async (tx) => {
      const row = (
        await tx.query(
          "SELECT j.*,s.config_release_id,ARRAY(SELECT x.id::text FROM job_outputs x WHERE x.workspace_id=j.workspace_id AND x.job_id=j.id AND j.state='succeeded') AS outputs FROM jobs j JOIN job_snapshots s ON s.id=j.snapshot_id AND s.workspace_id=j.workspace_id WHERE j.workspace_id=$1 AND j.id=$2",
          [wid(r), jobId],
        )
      ).rows[0];
      if (!row) fail("NOT_FOUND", 404);
      return {
        id: row.id,
        workspaceId: row.workspace_id,
        kind: row.kind,
        state: row.state,
        stage: row.stage,
        progress: row.state === "succeeded" ? 100 : Number(row.progress),
        revision: Number(row.revision),
        createdAt: date(row.created_at),
        updatedAt: date(row.terminal_at ?? row.created_at),
        outputIds: row.outputs,
        configReleaseId: row.config_release_id,
        providerSubmissionState: row.provider_submission_state,
        ...(row.parent_job_id ? { parentJobId: row.parent_job_id } : {}),
      };
    });
  const batch = (b: any): S["RedemptionBatch"] => ({
    id: b.id,
    skuVersionId: b.sku_version_id,
    count: Number(b.generated_count),
    expiresAt: date(b.expires_at),
    state: b.state,
    revision: Number(b.revision),
  });
  const config = (r: any) => s.config.withRequest(context(r));
  const secret = (r: any) => s.secrets.withRequest(context(r));
  const draft = async (r: any, v: any) => {
    const row = (
      await db.transaction((tx) =>
        tx.query(
          "SELECT created_at,updated_at FROM config_drafts WHERE id=$1",
          [v.id],
        ),
      )
    ).rows[0];
    return {
      summary: {
        id: v.id,
        category: v.namespace,
        revision: v.revision,
        state: v.state,
        hash: v.payloadHash,
        updatedAt: date(row.terminal_at ?? row.created_at),
      },
      value: v.payload,
      validationErrors: [],
    };
  };
  const release = async (r: any, rid: string) => {
    await db.transaction((tx) =>
      requireRoles(tx, auth, r.actor, ["platform_ops", "finance", "content"]),
    );
    const v = (
      await db.transaction((tx) =>
        tx.query(
          "SELECT * FROM config_releases WHERE id=$1 AND environment=$2",
          [rid, runtime.environment],
        ),
      )
    ).rows[0];
    if (!v) fail("NOT_FOUND", 404);
    return {
      id: v.id,
      version: Number(v.release_number),
      configHash: v.manifest_hash,
      draftIds: Object.values(v.manifest.sourceDrafts).map((x: any) => x.id),
      publishedAt: date(v.created_at),
      publishedBy: v.published_by,
      reason: v.manifest.reason,
      ...(v.previous_release_id
        ? { previousReleaseId: v.previous_release_id }
        : {}),
    };
  };
  return {
    async getReauthAvailability(r) {
      return s.reauth.availability(r.actor);
    },
    async createReauthChallenge(r) {
      return s.reauth.start(r.actor, r.body.purpose, key(r));
    },
    async listWorkspaceRefunds(r) {
      return scoped(
        r,
        async (tx) =>
          mapPage(
            await sqlPage(
              tx,
              r,
              "refunds",
              "SELECT * FROM refunds WHERE workspace_id=$1",
              [wid(r)],
              wid(r),
            ),
            refundDto,
          ),
        "purchase",
      );
    },
    async getCapabilities() {
      let release = null;
      try {
        release = await s.config.loadRelease();
      } catch {}
      const caps = await s.config.capabilities();
      return {
        configReleaseId: release?.releaseId ?? null,
        serverTime: new Date().toISOString(),
        capabilities: [
          ...Object.entries(caps).map(([key, c]) => ({
            key,
            status: c.state,
            reasonCode: c.reason,
            action: c.state === "available" ? "none" : "contact_admin",
            platforms: ["web", "mini"],
          })),
          {
            key: "textSuggestion",
            status: "unconfigured",
            action: "contact_admin",
            platforms: ["web", "mini"],
          },
        ],
      };
    },
    async startReconciliation(r) {
      await finance(r);
      if (!["payments", "refunds"].includes(r.body.scope))
        fail("RECONCILIATION_SCOPE_UNCONFIGURED", 503);
      const source = need(s.options.statements);
      const from = new Date(r.body.from),
        to = new Date(r.body.to);
      const businessDate = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(from);
      if (!Number.isFinite(+from) || +to < +from || +to - +from > 86400000)
        fail("INVALID_BUSINESS_DATE", 422);
      const lines = await source.read(businessDate);
      return db.transaction(async (tx) => {
        await requireRoles(tx, auth, r.actor, ["finance"]);
        return runIdempotent(
          tx,
          `finance:${r.actor.userId}:reconciliation`,
          key(r),
          payloadHash(r.body),
          async () => {
            await s.reauth.verifyFresh(
              r.actor,
              header(r, "x-reauthentication-proof"),
              "admin_operations",
              tx,
            );
            const result = await s.reconciliation.reconcileStatement(
              businessDate,
              lines,
            );
            const reviews = (
              await tx.query(
                "SELECT id,redacted_details FROM audit_events WHERE id=ANY($1::text[])",
                [result.reviewIds],
              )
            ).rows.map((row) => ({
              id: row.id,
              orderId: row.redacted_details.statement.orderId,
              paidFen: row.redacted_details.statement.paidFen,
              refundedFen: row.redacted_details.statement.refundedFen,
              localState: row.redacted_details.local?.state ?? "missing",
              localFulfillmentState:
                row.redacted_details.local?.fulfillment_state ?? "missing",
            }));
            const value = {
              reviews,
              id: id(),
              scope: r.body.scope,
              scannedCount: lines.length,
              discrepancyCount: result.reviewIds.length,
              state: "completed",
            };
            await tx.query(
              "INSERT INTO audit_events(id,actor_user_id,action,target_kind,target_id,request_id,reason,redacted_details) VALUES($1,$2,'commerce.reconciliation','reconciliation',$1,$3,$4,$5)",
              [
                value.id,
                r.actor.userId,
                id(),
                r.body.reason,
                { result: value, reviewIds: result.reviewIds, businessDate },
              ],
            );
            return value;
          },
        );
      });
    },
    async getReconciliation(r) {
      await finance(r);
      const row = (
        await db.transaction((tx) =>
          tx.query(
            "SELECT redacted_details FROM audit_events WHERE id=$1 AND action='commerce.reconciliation'",
            [r.params.reconciliationId],
          ),
        )
      ).rows[0];
      if (!row) fail("NOT_FOUND", 404);
      return row.redacted_details.result;
    },
    async listAuditEvents(r) {
      await finance(r);
      return db.transaction(async (tx) =>
        mapPage(
          await sqlPage(
            tx,
            r,
            "audit",
            "SELECT * FROM audit_events WHERE action LIKE 'commerce.%' AND actor_user_id IS NOT NULL",
          ),
          (x) => ({
            id: x.id,
            actorId: x.actor_user_id,
            action: x.action,
            targetType: x.target_kind,
            targetId: x.target_id,
            requestId: x.request_id,
            occurredAt: date(x.created_at),
            reason: x.reason,
          }),
        ),
      );
    },
    async queryAdminJobs(r) {
      await db.transaction((tx) =>
        requireRoles(tx, auth, r.actor, ["platform_ops"]),
      );
      const p = await db.transaction((tx) =>
        sqlPage(
          tx,
          r,
          "admin-jobs",
          "SELECT j.*,s.config_release_id FROM jobs j JOIN job_snapshots s ON s.id=j.snapshot_id AND s.workspace_id=j.workspace_id",
        ),
      );
      return mapPage(p, (row) => ({
        id: row.id,
        workspaceId: row.workspace_id,
        kind: row.kind,
        state: row.state,
        stage: row.stage,
        progress: row.state === "succeeded" ? 100 : Number(row.progress),
        revision: Number(row.revision),
        createdAt: date(row.created_at),
        updatedAt: date(row.terminal_at ?? row.created_at),
        outputIds: [],
        configReleaseId: row.config_release_id,
        providerSubmissionState: row.provider_submission_state,
      }));
    },
    async adminJobAction(r) {
      return (await import("./admin-jobs")).adminJobAction(
        runtime,
        s,
        r.actor,
        r.params.jobId,
        r.body,
        context(r),
      );
    },
    async listSkus(r) {
      let active;
      try {
        active = await s.config.loadRelease();
      } catch {
        return arrayPage(r, "skus", [], "public");
      }
      const v = active.versions.sku;
      if (v?.payload.kind !== "sku" || !v.payload.enabled)
        return arrayPage(r, "skus", [], "public");
      const row = (
        await db.transaction((tx) =>
          tx.query(
            "SELECT v.*,b.name FROM sku_versions v JOIN billing_skus b ON b.id=v.sku_id WHERE v.id=$1 AND b.state='active'",
            [v.id],
          ),
        )
      ).rows[0];
      if (!row) return arrayPage(r, "skus", [], "public");
      const p = v.payload;
      const result = arrayPage(
        r,
        "skus",
        [
          {
            id: p.skuId,
            versionId: row.id,
            name: p.name,
            priceFen: p.priceFen,
            currency: p.currency,
            durationDays: p.durationDays,
            creditGrant: p.credits,
            features: [
              `${p.durationDays}天`,
              `点数有效期 ${p.creditValidityDays} 天`,
              `退款规则 ${p.refundPolicyRef.id} v${p.refundPolicyRef.version}`,
              `${p.credits}点`,
              ...Object.entries(p.features).map(
                ([k, v]) => `${k}: ${Array.isArray(v) ? v.join("/") : v}`,
              ),
            ],
            channels: [
              active.versions.payment?.payload.kind === "payment"
                ? active.versions.payment.payload.channel
                : "wechat_pay",
            ],
            platforms: [
              active.versions.payment?.payload.kind === "payment" &&
              active.versions.payment.payload.channel === "wechat_virtual"
                ? "mini"
                : "web",
            ],
            state: "published",
            createdAt: date(row.created_at),
          },
        ].filter((sku) => sku.platforms.includes(r.query.platform)),
        "public",
      );
      return {
        ...result,
        items: result.items.map(({ createdAt, ...sku }) => sku),
      };
    },
    async listOrders(r) {
      return scoped(
        r,
        async (tx) =>
          mapPage(
            await sqlPage(
              tx,
              r,
              "orders",
              "SELECT * FROM orders WHERE workspace_id=$1",
              [wid(r)],
              wid(r),
            ),
            orderDto,
          ),
        "purchase",
      );
    },
    async getOrder(r) {
      await s.orders.queryOrder(r.actor, wid(r), r.params.orderId);
      return order(r);
    },
    async createOrder(r) {
      if (r.body.clientPlatform !== r.actor.client)
        fail("CLIENT_PLATFORM_MISMATCH", 403);
      await s.config.assertNewRequestsAllowed("purchase");
      await scoped(
        r,
        async (tx) => {
          const sku = (
            await tx.query("SELECT features FROM sku_versions WHERE id=$1", [
              r.body.skuVersionId,
            ])
          ).rows[0]?.features?.publishedSku;
          if (sku?.durationDays > 0) {
            const grants = (
              await tx.query(
                `SELECT features FROM entitlement_grants g WHERE workspace_id=$1 AND grant_type='membership' AND state='active' AND ends_at>now() AND NOT ${sourceCreditFrozenSql()}`,
                [wid(r)],
              )
            ).rows;
            if (
              grants.some(
                (g: any) =>
                  g.features.tierKey !== membershipTierKey(sku.features),
              )
            )
              fail("MEMBERSHIP_TIER_CONFLICT", 409);
          }
        },
        "purchase",
      );
      const created = await s.orders.createOrder(
        r.actor,
        wid(r),
        r.body.skuVersionId,
        r.body.channel,
        key(r),
      );
      return order({ ...r, params: { ...r.params, orderId: created.orderId } });
    },
    async createPaymentAttempt(r) {
      await order(r);
      return scoped(
        r,
        async (tx) => {
          const p = (
            await tx.query(
              "SELECT p.*,o.expires_at FROM payment_attempts p JOIN orders o ON o.id=p.order_id WHERE p.workspace_id=$1 AND p.order_id=$2 AND p.attempt=1",
              [wid(r), r.params.orderId],
            )
          ).rows[0];
          const retained = (
            await tx.query(
              "SELECT response_json FROM idempotency_keys WHERE workspace_id=$1 AND resource_id=$2 AND operation='payment.create'",
              [wid(r), r.params.orderId],
            )
          ).rows[0];
          if (!retained?.response_json?.clientPayload)
            fail("PAYMENT_CONFIRMATION_PENDING", 409);
          return {
            attemptId: p.id,
            expiresAt: date(p.expires_at),
            channel: p.channel,
            launch: retained.response_json.clientPayload,
          };
        },
        "purchase",
      );
    },
    async closeOrder(r) {
      await s.orders.closeOrder(r.actor, wid(r), r.params.orderId);
      return order(r);
    },
    async requestRefund(r) {
      const service = s.refunds.withRequest({
        ...context(r),
        amountFen: r.body.amountFen,
        expectedOrderRevision: r.body.expectedOrderRevision,
      });
      const result = await service.requestRefund(
        r.actor,
        wid(r),
        r.params.orderId,
        r.body.reason,
        key(r),
      );
      return service.getRefund(r.actor, wid(r), result.refundId);
    },
    async getRefund(r) {
      return s.refunds.getRefund(r.actor, wid(r), r.params.refundId);
    },
    async receivePaymentCallback(r) {
      const b = s.callbacks.get(r.params.channel);
      if (!b) fail("PAYMENT_UNCONFIGURED", 503);
      if (r.rawBody.length > 1048576) fail("PAYLOAD_TOO_LARGE", 413);
      const event = await s.payments.verify(b.id, r.rawBody, r.headers);
      await s.confirmation.confirmPayment(event);
      return b.ack;
    },
    async receiveRefundCallback(r) {
      const b = s.callbacks.get(r.params.channel);
      if (!b) fail("REFUND_UNCONFIGURED", 503);
      if (r.rawBody.length > 1048576) fail("PAYLOAD_TOO_LARGE", 413);
      const event = await s.refundAdapters.verify(b.id, r.rawBody, r.headers);
      await s.refunds.confirmVerifiedRefund(event, event.refundId);
      return b.ack;
    },
    async listWorkspaceJobs(r) {
      const p = await scoped(r, (tx) =>
        sqlPage(
          tx,
          r,
          "jobs",
          "SELECT * FROM jobs WHERE workspace_id=$1",
          [wid(r)],
          wid(r),
        ),
      );
      return mapPage(p, (x: any) => job(r, x.id));
    },
    async getJob(r) {
      return job(r);
    },
    async cancelJob(r) {
      await scoped(
        r,
        async (tx) => {
          const row = (
            await tx.query(
              "SELECT revision FROM jobs WHERE workspace_id=$1 AND id=$2",
              [wid(r), r.params.jobId],
            )
          ).rows[0];
          if (!row) fail("NOT_FOUND", 404);
        },
        "edit",
      );
      await s.jobs.requestCancel(r.actor, wid(r), r.params.jobId);
      return job(r);
    },
    async retryJob(r) {
      const source = await job(r);
      const created =
        source.kind === "export"
          ? (await s.config.assertNewRequestsAllowed("cloudExport"),
            await need(s.exports).retryExport(
              r.actor,
              wid(r),
              source.id,
              r.body.expectedRevision,
              r.body.reason,
              key(r),
            ))
          : source.kind === "layout"
            ? await need(runtime.cloudLayout).retryCloudLayoutJob(
                r.actor,
                wid(r),
                source.id,
                r.body.expectedRevision,
                r.body.reason,
                key(r),
              )
            : fail(
                source.kind === "generation"
                  ? "FRESH_QUOTE_REQUIRED"
                  : "RETRY_UNCONFIGURED",
                409,
              );
      return job(r, created.jobId);
    },
    async getEntitlements(r) {
      await scoped(r, async () => {});
      const ent = await s.entitlements.getEntitlements(
          wid(r),
          new Date().toISOString(),
        ),
        credits = await s.credits.creditBalance(
          wid(r),
          new Date().toISOString(),
        );
      return {
        workspaceId: wid(r),
        features: [`${ent.maxDpi} DPI`],
        availableCredits: credits.available,
        reservedCredits: credits.reserved,
        storageLimitBytes: ent.storageLimitBytes,
        seatLimit: 1,
        maxDpi: ent.maxDpi,
        watermarkRequired: ent.brandWatermark,
      };
    },
    async listCreditLedger(r) {
      return scoped(r, async (tx) =>
        mapPage(
          await sqlPage(
            tx,
            r,
            "ledger",
            "SELECT * FROM credit_ledger WHERE workspace_id=$1",
            [wid(r)],
            wid(r),
          ),
          (x) => ({
            id: x.id,
            operationId: x.operation_id,
            type: ["revoke", "adjustment"].includes(x.entry_type)
              ? "refund_adjustment"
              : x.entry_type,
            amount: (x.to_bucket === "available" ? 1 : -1) * Number(x.amount),
            balanceAfter: Number(x.balance_after),
            sourceId: x.lot_id,
            createdAt: date(x.created_at),
          }),
        ),
      );
    },
    async redeemCode(r) {
      return need(s.redemption)
        .withRequest({
          ...context(r),
          signals: { ip: r.ip, deviceId: r.actor.sessionId },
        })
        .redeem(r.actor, r.body, key(r));
    },
    async listRedemptions(r) {
      return scoped(r, async (tx) =>
        mapPage(
          await sqlPage(
            tx,
            r,
            "redemptions",
            "SELECT r.*,ARRAY(SELECT g.id::text FROM entitlement_grants g WHERE g.workspace_id=r.workspace_id AND g.source_redemption_id=r.id) AS grants,(SELECT coalesce(sum((g.features->>'creditGrant')::bigint),0) FROM entitlement_grants g WHERE g.workspace_id=r.workspace_id AND g.source_redemption_id=r.id AND grant_type='credits') AS credits FROM redemptions r WHERE workspace_id=$1",
            [wid(r)],
            wid(r),
          ),
          (x) => ({
            id: x.id,
            workspaceId: x.workspace_id,
            skuVersionId: x.sku_version_id,
            creditGrant: Number(x.credits),
            entitlementGrantIds: x.grants,
            redeemedAt: date(x.created_at),
          }),
        ),
      );
    },
    async createPreflight(r) {
      return need(s.exports).createPreflight(
        r.actor,
        wid(r),
        r.params.projectId,
        r.body,
        key(r),
      );
    },
    async createExportJob(r) {
      await s.config.assertNewRequestsAllowed("cloudExport");
      const created = await need(s.exports).acceptPreflightExport(
        r.actor,
        r.body,
        key(r),
      );
      return job(r, created.jobId);
    },
    async listJobOutputs(r) {
      return arrayPage(
        r,
        "outputs",
        await need(s.exports).listArtifacts(r.actor, wid(r), r.params.jobId),
        wid(r),
      );
    },
    async getOutput(r) {
      const row = await scoped(
        r,
        async (tx) =>
          (
            await tx.query(
              "SELECT job_id FROM job_outputs WHERE workspace_id=$1 AND id=$2",
              [wid(r), r.params.outputId],
            )
          ).rows[0],
      );
      if (!row) fail("NOT_FOUND", 404);
      return (
        await need(s.exports).listArtifacts(r.actor, wid(r), row.job_id)
      ).find((x) => x.id === r.params.outputId);
    },
    async createOutputDownloadToken(r) {
      const service = need(s.exports),
        row = await scoped(
          r,
          async (tx) =>
            (
              await tx.query(
                "SELECT job_id FROM job_outputs WHERE workspace_id=$1 AND id=$2",
                [wid(r), r.params.outputId],
              )
            ).rows[0],
        );
      if (!row) fail("OUTPUT_NOT_FOUND", 404);
      const output = (
        await service.listArtifacts(r.actor, wid(r), row.job_id)
      ).find((x) => x.id === r.params.outputId);
      if (!output) fail("OUTPUT_NOT_FOUND", 404);
      const token = await service.authorizeArtifactDownload(
        r.actor,
        wid(r),
        r.params.outputId,
      );
      return {
        ...token,
        filename: output.filename,
        mime: output.mime,
        sizeBytes: output.sizeBytes,
        sha256: output.sha256,
      };
    },
    async queryAdminOrders(r) {
      await finance(r);
      return db.transaction(async (tx) =>
        mapPage(
          await sqlPage(tx, r, "admin-orders", "SELECT * FROM orders"),
          orderDto,
        ),
      );
    },
    async queryAdminRefunds(r) {
      await finance(r);
      return db.transaction(async (tx) =>
        mapPage(
          await sqlPage(tx, r, "admin-refunds", "SELECT * FROM refunds"),
          refundDto,
        ),
      );
    },
    async decideRefund(r) {
      await finance(r);
      await s.refunds
        .withRequest(context(r))
        .decideRefund(r.actor, r.params.refundId, r.body, key(r));
      return db.transaction(async (tx) =>
        refundDto(
          (
            await tx.query("SELECT * FROM refunds WHERE id=$1", [
              r.params.refundId,
            ])
          ).rows[0],
        ),
      );
    },
    async listRedemptionBatches(r) {
      await finance(r);
      return db.transaction(async (tx) =>
        mapPage(
          await sqlPage(
            tx,
            r,
            "redemption-batches",
            "SELECT * FROM redemption_batches",
          ),
          batch,
        ),
      );
    },
    async createRedemptionBatch(r) {
      await finance(r);
      return need(s.redemption)
        .withRequest(context(r))
        .createBatch(r.actor, r.body);
    },
    async disableRedemptionBatch(r) {
      await finance(r);
      return need(s.redemption)
        .withRequest(context(r))
        .disableBatch(r.actor, r.params.batchId, r.query.reason);
    },
    async createFinancialAdjustment(r) {
      await finance(r);
      return (await import("./adjustments")).adjustFinancial(
        runtime,
        s.reauth,
        r.actor,
        wid(r),
        r.body,
        context(r),
      );
    },
    async listSecretMetadata(r) {
      return db.transaction(async (tx) => {
        await requireRoles(tx, auth, r.actor, ["platform_ops"]);
        return mapPage(
          await sqlPage(
            tx,
            r,
            "secrets",
            "SELECT * FROM secret_references WHERE environment=$1",
            [runtime.environment],
          ),
          (x) => s.secrets.metadata(x),
        );
      });
    },
    async createSecret(r) {
      return secret(r).writeSecret(
        r.actor,
        r.body.purpose,
        Buffer.from(r.body.value, "utf8"),
        r.body.reason,
      );
    },
    async rotateSecret(r) {
      return secret(r).rotateSecret(
        r.actor,
        r.params.secretId,
        Buffer.from(r.body.value, "utf8"),
        r.body.reason,
      );
    },
    async revokeSecret(r) {
      return secret(r).revokeSecret(
        r.actor,
        r.params.secretId,
        r.body.emergency ?? false,
        r.body.reason,
      );
    },
    async createConfigDraft(r) {
      const base = r.body.baseReleaseId
        ? ((await s.config.loadRelease(r.body.baseReleaseId)).versions[
            r.body.category
          ]?.version ?? null)
        : null;
      return draft(
        r,
        await config(r).createConfigDraft(
          r.actor,
          r.body.category,
          r.body.value,
          base,
        ),
      );
    },
    async getConfigDraft(r) {
      return draft(
        r,
        await config(r).getConfigDraft(r.actor, r.params.draftId),
      );
    },
    async replaceConfigDraft(r) {
      return draft(
        r,
        await config(r).updateConfigDraft(
          r.actor,
          r.params.draftId,
          expected(r),
          r.body.value,
        ),
      );
    },
    async listConfigDrafts(r) {
      await db.transaction((tx) =>
        requireRoles(tx, auth, r.actor, ["platform_ops", "finance", "content"]),
      );
      const p = await db.transaction((tx) =>
        sqlPage(
          tx,
          r,
          "config-drafts",
          "SELECT * FROM config_drafts WHERE environment=$1",
          [runtime.environment],
        ),
      );
      const mapped = await mapPage(p, async (row) => {
        try {
          return (
            await draft(r, await config(r).getConfigDraft(r.actor, row.id))
          ).summary;
        } catch {
          return null;
        }
      });
      return { ...mapped, items: mapped.items.filter((x) => x !== null) };
    },
    async publishConfig(r) {
      const v = await config(r).getConfigDraft(r.actor, r.params.draftId);
      if (v.payloadHash !== r.body.configHash || v.revision !== expected(r))
        fail("REVISION_CONFLICT", 409);
      let active = null;
      try {
        active = (await s.config.loadRelease()).releaseId;
      } catch {}
      const result = await config(r).publishConfig(
        r.actor,
        [v.id],
        r.body.testIds,
        r.body.reason,
        active,
      );
      return release(r, result.releaseId);
    },
    async getConfigRelease(r) {
      return release(r, r.params.releaseId);
    },
    async listConfigReleases(r) {
      await db.transaction((tx) =>
        requireRoles(tx, auth, r.actor, ["platform_ops", "finance", "content"]),
      );
      const p = await db.transaction((tx) =>
        sqlPage(
          tx,
          r,
          "config-releases",
          "SELECT * FROM config_releases WHERE environment=$1",
          [runtime.environment],
        ),
      );
      return mapPage(p, (row) => release(r, row.id));
    },
    async rollbackConfig(r) {
      const active = await s.config.loadRelease();
      const result = await config(r).rollbackConfig(
        r.actor,
        r.body.sourceReleaseId,
        active.releaseId,
        r.body.reason,
      );
      return release(r, result.releaseId);
    },
    async createConfigTest(r) {
      const v = await config(r).getConfigDraft(r.actor, r.params.draftId);
      if (v.payloadHash !== r.body.configHash) fail("CONFIG_TEST_STALE", 409);
      const value = await config(r).testConfigDraft(
        r.actor,
        v.id,
        r.body.level,
      );
      const { errorCode, ...rest } = value;
      return {
        ...rest,
        ...(errorCode
          ? { error: { code: errorCode, message: errorCode, retryable: false } }
          : {}),
      };
    },
    async getConfigTest(r) {
      const row = (
        await db.transaction((tx) =>
          tx.query(
            "SELECT report,draft_id FROM config_tests WHERE id=$1 AND environment=$2",
            [r.params.testId, runtime.environment],
          ),
        )
      ).rows[0];
      if (!row) fail("NOT_FOUND", 404);
      await config(r).getConfigDraft(r.actor, row.draft_id);
      const { errorCode, ...rest } = row.report;
      return {
        ...rest,
        ...(errorCode
          ? { error: { code: errorCode, message: errorCode, retryable: false } }
          : {}),
      };
    },
    async discardConfigDraft(r) {
      const v = await config(r).getConfigDraft(r.actor, r.params.draftId);
      if (v.revision !== expected(r)) fail("REVISION_CONFLICT", 409);
      return db.transaction(async (tx) => {
        await requireRoles(
          tx,
          auth,
          r.actor,
          CONFIG_REGISTRY[v.payload.kind].roles,
        );
        await tx.query(
          "DELETE FROM config_drafts WHERE id=$1 AND revision=$2",
          [v.id, v.revision],
        );
        return {
          operationId: id(),
          state: "completed",
          acceptedAt: new Date().toISOString(),
        };
      });
    },
    async emergencyDisableCapability(r) {
      return config(r).emergencyDisable(
        r.actor,
        r.body.capability,
        r.body.disabled,
        r.body.reason,
      );
    },
    async getConfigImpact(r) {
      const v = await config(r).getConfigDraft(r.actor, r.params.draftId);
      return {
        draftId: v.id,
        configHash: v.payloadHash,
        changes: [],
        requiredTestLevels: CONFIG_REGISTRY[v.payload.kind].requiredTests,
        readyToPublish: v.state === "validated",
      };
    },
  };
}
