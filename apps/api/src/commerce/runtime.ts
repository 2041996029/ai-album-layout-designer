import { AiFinanceService } from "../ai/finance";
import { aiCatalogDependencies } from "../ai/dependencies";
import { materializeAiConfig } from "../ai/materialize";
import { LicenseService } from "../content/licenses";
import { assertSecretNotInUse } from "./secret-obligations";
import type { SecretOptions } from "../config/secrets";
import { CloudLayoutService } from "../projects/layout-service";
import { fail, type Database } from "@album/server-core";
import { JobRepository, policyFromRelease, type PolicyPort } from "@album/jobs";
import type { ApiRuntime } from "../http/runtime";
import type {
  ReauthService,
  HumanReauthAdapter,
  IdentityProof,
} from "../auth/reauthentication";
import { ConfigService, type ConfigOptions } from "../config/service";
import { SecretService } from "../config/secrets";
import type { SecretPort } from "../config/types";
import { PaymentAdapters } from "../payments/adapters";
import { OrderService, PublishedOrderCatalog } from "../payments/orders";
import { PaymentConfirmation } from "../payments/confirm";
import type { PaymentAdmissionPort, PaymentAdapter } from "../payments/types";
import {
  OrderFulfillment,
  actualPublishedSkuMaterializer,
} from "./fulfillment";
import { CreditService } from "./credits";
import { EntitlementService } from "./entitlements";
import { RefundAdapters, RefundService, type RefundAdapter } from "./refunds";
import { RedemptionService, type RedemptionRateLimitPort } from "./redemption";
import { ReconciliationService, type StatementPort } from "./reconciliation";
import {
  ExportService,
  exportTerminalHook,
  type ExportDependencies,
} from "../exports/service";
import { commerceHandlers } from "./http";
export type CommerceOptions = {
  reauthentication?: {
    identities?: Partial<
      Record<IdentityProof["provider"], import("../auth/types").IdentityAdapter>
    >;
    human?: HumanReauthAdapter;
  };
  secrets?: SecretPort;
  assertSecretNotInUse?: SecretOptions["assertNotInUse"];
  config?: Partial<ConfigOptions>;
  paymentBindings?: Array<{
    id: string;
    adapter: PaymentAdapter;
    refundAdapter?: RefundAdapter;
    callbackChannel: string;
    ack: unknown;
  }>;
  admission?: PaymentAdmissionPort;
  refundPolicy?: Record<string, unknown>;
  financePolicy?: () => Promise<{ dualReviewRequired: boolean }>;
  redemption?: { pepper: string; rateLimiter: RedemptionRateLimitPort };
  exports?: Pick<
    ExportDependencies,
    "objects" | "storage" | "preflight" | "renderer" | "tokenSecret"
  >;
  statements?: StatementPort;
};
const closedSecrets: SecretPort = {
  write: async () => fail("SECRETS_UNCONFIGURED", 503),
  read: async () => fail("SECRETS_UNCONFIGURED", 503),
  isRevoked: async () => true,
};
export async function bindCommerceRuntime(
  runtime: ApiRuntime,
  reauth: ReauthService,
  options: CommerceOptions = {},
) {
  const { db, auth, workspaces, environment } = runtime;
  runtime.proofAdapter = reauth;
  const config = new ConfigService(db, auth, options.secrets ?? closedSecrets, {
    ...options.config,
    dependencies: aiCatalogDependencies(options.config?.dependencies),
    environment,
    reauth,
    onPublished: async (tx, release) => {
      await materializeAiConfig(
        tx,
        release,
        environment,
        runtime.ai?.service.options.registry,
      );
      const v = release.versions.sku;
      if (v?.payload.kind === "sku" && v.payload.enabled)
        await actualPublishedSkuMaterializer.materialize(tx, {
          releaseId: release.releaseId,
          skuConfigVersionId: v.id,
          sku: v.payload,
          refundPolicy: options.refundPolicy ?? {},
        });
    },
  });
  const secrets = new SecretService(
    db,
    auth,
    options.secrets ?? closedSecrets,
    {
      environment,
      reauth,
      assertNotInUse: options.assertSecretNotInUse ?? assertSecretNotInUse,
    },
  );
  const payments = new PaymentAdapters(environment),
    refundAdapters = new RefundAdapters(payments);
  const callbacks = new Map<string, { id: string; ack: unknown }>();
  for (const b of options.paymentBindings ?? []) {
    payments.register(b.id, b.adapter, { approved: true });
    if (b.refundAdapter) refundAdapters.register(b.id, b.refundAdapter);
    callbacks.set(b.callbackChannel, { id: b.id, ack: b.ack });
  }
  const credits = new CreditService(db),
    entitlements = new EntitlementService(db, () => config.loadRelease());
  const policy: PolicyPort = async (tx, job) => {
    const release = await config.loadRelease(job.configReleaseId);
    const row = (
      await tx.query(
        "SELECT manifest FROM job_snapshots WHERE workspace_id=$1 AND id=(SELECT snapshot_id FROM jobs WHERE id=$2)",
        [job.workspaceId, job.jobId],
      )
    ).rows[0];
    const maximum =
      job.kind === "export"
        ? row?.manifest?.entitlements?.maxConcurrentExports
        : 1;
    if (!Number.isSafeInteger(maximum) || maximum < 1)
      fail("JOB_POLICY_UNCONFIGURED", 503);
    return policyFromRelease(
      release,
      job.kind === "export"
        ? "export"
        : job.kind === "generation"
          ? "generation"
          : "layout",
      { global: 8, workspace: 2 },
      { global: 8, workspace: maximum },
    );
  };
  const jobs = new JobRepository(db, policy, async (tx, job, outcome) => {
    await exportTerminalHook(tx, job, outcome);
    await credits.creditTerminalHook(tx, job, outcome);
    await runtime.ai?.service.terminalHook(tx, job, outcome);
    if (job.kind === "layout")
      await tx.query(
        "UPDATE resource_pins SET released_at=clock_timestamp() WHERE workspace_id=$1 AND job_id=$2 AND released_at IS NULL",
        [job.workspaceId, job.jobId],
      );
  });
  const confirmation = new PaymentConfirmation(
    db,
    payments,
    new OrderFulfillment().fulfillOrder,
  );
  const catalog = new PublishedOrderCatalog(
    () => config.loadRelease(),
    options.admission ?? {
      admit: async () => fail("PAYMENT_UNCONFIGURED", 503),
    },
  );
  const orders = new OrderService({
    db,
    workspaces,
    adapters: payments,
    catalog,
    confirmation,
  });
  const refunds = new RefundService(
    db,
    auth,
    workspaces,
    payments,
    refundAdapters,
    { reauth, jobs, financePolicy: options.financePolicy },
  );
  const redemption = options.redemption
    ? new RedemptionService(db, auth, workspaces, {
        ...options.redemption,
        reauth,
      })
    : undefined;
  const exports = options.exports
    ? new ExportService({
        db,
        authorization: workspaces,
        config,
        entitlements,
        ...options.exports,
      })
    : undefined;
  const reconciliation = new ReconciliationService(db);
  const licenses = new LicenseService(db, auth);
  const aiFinance = new AiFinanceService(db, auth, reauth, environment);
  const services = {
    aiFinance,
    licenses,
    config,
    secrets,
    payments,
    refundAdapters,
    callbacks,
    credits,
    entitlements,
    jobs,
    policy,
    confirmation,
    orders,
    refunds,
    redemption,
    exports,
    reconciliation,
    reauth,
    options,
  };
  runtime.commerce = services;
  if (runtime.revisions)
    runtime.cloudLayout = new CloudLayoutService({
      db,
      workspaces,
      revisions: runtime.revisions,
      jobs,
      release: async () => {
        const release = await config.loadRelease(),
          p = release.versions.layout?.payload;
        if (
          p?.kind !== "layout" ||
          !Object.values(release.versions).some(
            (v) =>
              v.payload.kind === "queue" && v.payload.workerKind === "layout",
          )
        )
          fail("CLOUD_LAYOUT_UNCONFIGURED", 503);
        return {
          releaseId: release.releaseId,
          policy: {
            algorithmVersion: p.algorithmVersion,
            candidateCount: p.candidateCount as 1 | 2 | 3,
            weights: p.weights,
          },
        };
      },
    });
  runtime.operationHandlers = {
    ...runtime.operationHandlers,
    ...commerceHandlers(runtime, services),
  };
}
export type CommerceRuntime = {
  aiFinance: AiFinanceService;
  licenses: LicenseService;
  config: ConfigService;
  secrets: SecretService;
  payments: PaymentAdapters;
  refundAdapters: RefundAdapters;
  callbacks: Map<string, { id: string; ack: unknown }>;
  credits: CreditService;
  entitlements: EntitlementService;
  jobs: JobRepository;
  policy: PolicyPort;
  confirmation: PaymentConfirmation;
  orders: OrderService;
  refunds: RefundService;
  redemption?: RedemptionService;
  exports?: ExportService;
  reconciliation: ReconciliationService;
  reauth: ReauthService;
  options: CommerceOptions;
};
