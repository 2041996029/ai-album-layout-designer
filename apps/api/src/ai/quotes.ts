import { reserveGenerationStorage, closeGenerationStorage } from "./quota";
import {
  fail,
  id,
  digest,
  type Actor,
  type Database,
} from "@album/server-core";
import type { PoolClient } from "pg";
import type { ProviderRegistry, ProviderInput } from "@album/providers";
import { checkProviderInput } from "@album/providers";
import { createJob, type JobRecord, type TerminalCommit } from "@album/jobs";
import type { components } from "@album/contracts";
import { CreditService } from "../commerce/credits";
import type { WorkspaceService } from "../workspaces/service";
import { payloadHash, type ConfigRelease } from "../config/types";
import { readLicense, validateLicense, renderPresetPrompt } from "./catalog";
import { reserveProviderBudget, closeProviderBudget } from "./budget";
type Input = components["schemas"]["GenerationInput"];
type Quote = components["schemas"]["GenerationQuote"];
export type GenerationOptions = {
  db: Database;
  workspaces: WorkspaceService;
  registry: ProviderRegistry;
  loadRelease: (id?: string) => Promise<Readonly<ConfigRelease>>;
  environment: "dev" | "staging" | "prod";
  allowReplay?: boolean;
  now?: () => Date;
  assertAllowed?: () => Promise<void>;
  quota?: import("../assets/types").QuotaPolicyPort;
  validatePolicies?: (moderation: string, label: string) => boolean;
};
export const policyKey = (ref: { id: string; version: number }) =>
  digest(JSON.stringify(ref));
export class GenerationService {
  readonly credits: CreditService;
  constructor(readonly options: GenerationOptions) {
    this.credits = new CreditService(options.db, options.now);
  }
  private now() {
    return this.options.now?.() ?? new Date();
  }
  async catalogRow(
    tx: PoolClient,
    presetId: string,
    release: Readonly<ConfigRelease>,
    capability: string,
  ) {
    const queues = Object.values(release.versions)
      .map((v) => v.payload)
      .filter((p) => p.kind === "queue" && p.workerKind === "generation");
    if (queues.length !== 1 || queues[0].kind !== "queue" || !queues[0].enabled)
      fail("GENERATION_QUEUE_UNCONFIGURED", 503);
    const generationQueue = queues[0];
    const route = release.versions.aiRoute,
      pricing = release.versions.aiPricing,
      connection = release.versions.aiConnection,
      content = release.versions.content;
    if (
      route?.payload.kind !== "aiRoute" ||
      pricing?.payload.kind !== "aiPricing" ||
      connection?.payload.kind !== "aiConnection" ||
      content?.payload.kind !== "content" ||
      !route.payload.enabled ||
      !pricing.payload.enabled ||
      !connection.payload.enabled ||
      route.payload.capability !== capability ||
      pricing.payload.presetRef.id !== presetId
    )
      fail("GENERATION_UNCONFIGURED", 503);
    const r = (
      await tx.query(
        "SELECT p.*,b.name,b.category,b.state AS preset_state,m.id AS model_version_id,m.provider_version_id,m.provider_model_id,m.license_version_id AS model_license_id,m.capabilities AS model_capabilities,m.limits_json,m.moderation_policy_ref AS model_moderation,m.label_policy_ref AS model_label,a.state AS model_state,v.adapter_id,v.adapter_version,v.base_url,v.secret_reference_id,v.daily_budget_fen,v.allowed_data_use,v.connection_id,c.state AS connection_state,c.environment,s.state AS secret_state,s.secret_ref,s.secret_version,k.credit_cost,k.estimated_cost_fen,k.max_cost_fen,k.rule_key,k.id AS pricing_id,r.id AS route_version_id,ab.account_billing_id FROM ai_preset_versions p JOIN ai_presets b ON b.id=p.preset_id JOIN ai_preset_models pm ON pm.preset_version_id=p.id JOIN ai_model_versions m ON m.id=pm.model_version_id JOIN ai_models a ON a.id=m.model_id JOIN ai_provider_versions v ON v.id=m.provider_version_id JOIN ai_provider_connections c ON c.id=v.connection_id JOIN ai_billing_accounts ab ON ab.id=v.billing_account_id JOIN secret_references s ON s.id=v.secret_reference_id JOIN cost_rule_versions k ON k.id=p.cost_rule_version_id JOIN ai_route_versions r ON r.primary_model_version_id=m.id WHERE p.id=$1 AND m.id=$2 AND r.id=$3",
        [presetId, route.payload.primaryModelRef.id, route.id],
      )
    ).rows[0];
    if (
      !r ||
      r.environment !== this.options.environment ||
      r.preset_state !== "published" ||
      r.model_state !== "ready" ||
      r.connection_state !== "ready" ||
      r.secret_state !== "available" ||
      !r.model_capabilities[capability] ||
      pricing.payload.modelRef.id !== r.model_version_id ||
      (pricing.payload.costRuleId !== r.pricing_id &&
        pricing.payload.costRuleId !== r.rule_key) ||
      pricing.payload.creditsPerImage !== Number(r.credit_cost) ||
      pricing.payload.estimatedProviderCostFen !==
        Number(r.estimated_cost_fen) ||
      connection.id !== r.provider_version_id
    )
      fail("GENERATION_UNCONFIGURED", 503);
    validateLicense(
      await readLicense(tx, { id: r.license_version_id }),
      this.now(),
      "CN",
      capability === "imageToImage",
    );
    validateLicense(
      await readLicense(tx, { id: r.model_license_id }),
      this.now(),
      "CN",
      capability === "imageToImage",
    );
    if (
      r.model_moderation !== r.moderation_policy_ref ||
      r.model_label !== r.label_policy_ref
    )
      fail("GENERATION_POLICY_MISMATCH", 503);
    const adapter = this.options.registry.get(r.adapter_id, r.adapter_version);
    if (
      !adapter.capabilities.has(capability as any) ||
      (adapter.mode === "replay" &&
        (!this.options.allowReplay || this.options.environment !== "dev"))
    )
      fail("GENERATION_UNCONFIGURED", 503);
    if (
      !this.options.allowReplay &&
      (!this.options.validatePolicies?.(
        r.moderation_policy_ref,
        r.label_policy_ref,
      ) ||
        !this.options.quota)
    )
      fail("GENERATION_POLICIES_UNCONFIGURED", 503);
    return {
      ...r,
      policyVersion: policyKey(content.payload.licensePolicyVersion),
      release,
      adapter,
      content: content.payload,
      pricing: pricing.payload,
      generationQueue,
    };
  }
  async listPresets(actor: Actor, wid: string) {
    const release = await this.options.loadRelease();
    return this.options.db.transaction(async (tx) => {
      await this.options.workspaces.authorize(actor, wid, "read", tx);
      const p = release.versions.aiPricing?.payload;
      if (p?.kind !== "aiPricing") return [];
      let r: any;
      try {
        r = await this.catalogRow(
          tx,
          p.presetRef.id,
          release,
          release.versions.aiRoute?.payload.kind === "aiRoute"
            ? release.versions.aiRoute.payload.capability
            : "",
        );
      } catch {
        return [];
      }
      return [
        {
          id: r.id,
          version: r.version,
          name: r.name,
          capabilities: Object.keys(r.model_capabilities).filter(
            (k) =>
              ["textToImage", "imageToImage"].includes(k) &&
              r.model_capabilities[k],
          ),
          ratios: Object.keys(r.limits_json.sizes ?? {}),
          referenceAllowed: !!r.model_capabilities.imageToImage,
          commercialAllowed: true,
          licenseRef: r.license_version_id,
          policyVersion: r.policyVersion,
          maxPromptCharacters: 4000,
          seedSupported: false,
          available: true,
        },
      ];
    });
  }
  async createGenerationQuote(actor: Actor, input: Input): Promise<Quote> {
    await this.options.assertAllowed?.();
    const release = await this.options.loadRelease();
    return this.options.db.transaction(async (tx) => {
      await this.options.workspaces.authorize(
        actor,
        input.workspaceId,
        "manageAssets",
        tx,
      );
      const r = await this.catalogRow(
        tx,
        input.presetVersionId,
        release,
        input.capability,
      );
      const normalized = structuredClone(input);
      normalized.description = input.description.trim();
      if (!normalized.description || input.imageCount !== 1)
        fail("GENERATION_INPUT_INVALID", 422);
      const size = r.limits_json.sizes?.[input.ratio];
      if (
        !size ||
        !Number.isInteger(size.width) ||
        !Number.isInteger(size.height) ||
        size.width * size.height > 50000000
      )
        fail("UNSUPPORTED_PARAMETER", 422);
      const providerInput: ProviderInput = {
        operationId: "quote",
        modelVersionId: r.model_version_id,
        prompt: renderPresetPrompt(
          String(r.parameter_template.prompt ?? "{{description}}"),
          normalized.description,
        ),
        width: size.width,
        height: size.height,
        count: 1,
        ...(input.negativePrompt !== undefined
          ? { negativePrompt: input.negativePrompt }
          : {}),
        ...(input.seed !== undefined ? { seed: input.seed } : {}),
        ...(input.referenceStrength !== undefined
          ? { referenceStrength: input.referenceStrength }
          : {}),
        ...(input.capability === "imageToImage"
          ? {
              referenceObjectIds: [input.referenceConsent?.assetId ?? ""],
              consentRef: "quote-consent",
            }
          : {}),
      };
      checkProviderInput(providerInput, r.adapter.capabilities);
      let asset: string | null = null;
      if (input.capability === "imageToImage") {
        const consent = input.referenceConsent;
        if (
          !consent ||
          consent.authorized !== true ||
          consent.transferAccepted !== true ||
          consent.purpose !== "imageToImage" ||
          consent.policyVersion !== r.policyVersion
        )
          fail("REFERENCE_CONSENT_REQUIRED", 422);
        asset = consent.assetId;
        const a = (
          await tx.query(
            "SELECT id FROM assets WHERE workspace_id=$1 AND id=$2 AND state='ready' FOR SHARE",
            [input.workspaceId, asset],
          )
        ).rows[0];
        if (!a) fail("REFERENCE_UNAVAILABLE", 422);
      } else if (input.referenceConsent) fail("REFERENCE_NOT_ALLOWED", 422);
      const hash = payloadHash(normalized),
        consentId = id(),
        quoteId = id(),
        at = this.now(),
        expiresAt = new Date(
          +at + r.pricing.quoteTtlSeconds * 1000,
        ).toISOString();
      await tx.query(
        "INSERT INTO generation_consents(id,workspace_id,user_id,reference_asset_id,policy_version,purpose,consented_at,reference_authorization_ref,input_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          consentId,
          input.workspaceId,
          actor.userId,
          asset,
          r.policyVersion,
          input.capability,
          at,
          asset ? "user-authorized:" + actor.userId : null,
          hash,
        ],
      );
      await tx.query(
        "INSERT INTO generation_quotes(id,created_at,workspace_id,config_release_id,route_version_id,model_version_id,provider_version_id,preset_version_id,cost_rule_version_id,consent_id,reference_asset_id,input_hash,credit_cost,estimated_cost_fen,max_cost_fen,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)",
        [
          quoteId,
          at,
          input.workspaceId,
          release.releaseId,
          r.route_version_id,
          r.model_version_id,
          r.provider_version_id,
          r.id,
          r.pricing_id,
          consentId,
          asset,
          hash,
          r.credit_cost,
          r.estimated_cost_fen,
          r.max_cost_fen,
          expiresAt,
        ],
      );
      const quote: Quote = {
        id: quoteId,
        workspaceId: input.workspaceId,
        inputHash: hash,
        credits: Number(r.credit_cost),
        expiresAt,
        configReleaseId: release.releaseId,
        routeVersionId: r.route_version_id,
        modelVersionId: r.model_version_id,
        presetVersionId: r.id,
        costRuleVersionId: r.pricing_id,
        policyVersion: r.policyVersion,
        normalizedInput: normalized,
      };
      await tx.query(
        "INSERT INTO generation_quote_inputs(quote_id,user_id,input_json,context_json) VALUES($1,$2,$3,$4)",
        [
          quoteId,
          actor.userId,
          quote,
          {
            providerInput,
            providerVersionId: r.provider_version_id,
            accountBillingId: r.account_billing_id,
            adapterId: r.adapter_id,
            adapterVersion: r.adapter_version,
            endpoint: r.base_url,
            providerModelId: r.provider_model_id,
            secretRef: r.secret_ref,
            secretVersion: r.secret_version,
            secretReferenceId: r.secret_reference_id,
            consentId,
            licenseId: r.license_version_id,
            moderationPolicyVersion: r.moderation_policy_ref,
            labelPolicyVersion: r.label_policy_ref,
            timeoutSeconds: r.pricing.unknownFinalTimeoutSeconds,
            estimatedCostFen: Number(r.estimated_cost_fen),
          },
        ],
      );
      return quote;
    });
  }
  async getQuote(actor: Actor, quoteId: string): Promise<Quote> {
    return this.options.db.transaction(async (tx) => {
      const q = (
        await tx.query(
          "SELECT i.*,q.workspace_id FROM generation_quote_inputs i JOIN generation_quotes q ON q.id=i.quote_id WHERE i.quote_id=$1",
          [quoteId],
        )
      ).rows[0];
      if (!q) fail("NOT_FOUND", 404);
      await this.options.workspaces.authorize(
        actor,
        q.workspace_id,
        "read",
        tx,
      );
      if (q.user_id !== actor.userId) fail("NOT_FOUND", 404);
      return q.input_json;
    });
  }
  async acceptGenerationQuote(
    actor: Actor,
    input: components["schemas"]["GenerationJobCreate"],
    key: string,
  ): Promise<JobRecord> {
    await this.options.assertAllowed?.();
    if (!key || key.length > 128) fail("IDEMPOTENCY_KEY_REQUIRED", 428);
    const preview = await this.getQuote(actor, input.quoteId);
    const frozenRelease = await this.options.loadRelease(
      preview.configReleaseId,
    );
    const quota = await this.options.quota?.readQuota(preview.workspaceId);
    return this.options.db.transaction(async (tx) => {
      const r = (
        await tx.query(
          "SELECT q.*,i.user_id,i.input_json,i.context_json,i.accepted_job_id FROM generation_quotes q JOIN generation_quote_inputs i ON i.quote_id=q.id WHERE q.id=$1 FOR UPDATE OF q,i",
          [input.quoteId],
        )
      ).rows[0];
      if (!r || r.user_id !== actor.userId) fail("NOT_FOUND", 404);
      await this.options.workspaces.authorize(
        actor,
        r.workspace_id,
        "manageAssets",
        tx,
      );
      if (
        r.input_hash !== input.inputHash ||
        r.input_json.policyVersion !== input.policyConsentVersion
      )
        fail("QUOTE_INPUT_MISMATCH", 409);
      const requestHash = payloadHash({
        operation: "generation.accept",
        ...input,
      });
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        "workspace:" + r.workspace_id + ":" + key,
      ]);
      const previous = (
        await tx.query(
          "SELECT * FROM idempotency_keys WHERE workspace_id=$1 AND principal_scope='workspace' AND idempotency_key=$2",
          [r.workspace_id, key],
        )
      ).rows[0];
      if (previous) {
        if (
          previous.request_hash !== requestHash ||
          previous.operation !== "job.create"
        )
          fail("IDEMPOTENCY_CONFLICT", 409);
        return previous.response_json;
      }
      if (r.accepted_job_id) {
        const original = (
          await tx.query(
            "SELECT response_json FROM idempotency_keys WHERE workspace_id=$1 AND operation='job.create' AND resource_id=$2 LIMIT 1",
            [r.workspace_id, r.accepted_job_id],
          )
        ).rows[0];
        if (!original) fail("JOB_ACCEPTANCE_CORRUPT", 503);
        await tx.query(
          "INSERT INTO idempotency_keys(id,workspace_id,principal_scope,idempotency_key,request_hash,operation,state,response_status,response_json,resource_kind,resource_id,expires_at) VALUES($1,$2,'workspace',$3,$4,'job.create','completed',200,$5,'job',$6,clock_timestamp()+interval '7 days')",
          [
            id(),
            r.workspace_id,
            key,
            requestHash,
            original.response_json,
            r.accepted_job_id,
          ],
        );
        return original.response_json;
      }
      if (r.expires_at <= this.now()) fail("QUOTE_EXPIRED", 410);
      const validated = await this.catalogRow(
        tx,
        r.preset_version_id,
        frozenRelease,
        r.input_json.normalizedInput.capability,
      );
      if (
        r.reference_asset_id &&
        !(
          await tx.query(
            "SELECT 1 FROM assets WHERE workspace_id=$1 AND id=$2 AND state='ready' FOR SHARE",
            [r.workspace_id, r.reference_asset_id],
          )
        ).rowCount
      )
        fail("REFERENCE_UNAVAILABLE", 422);
      const snapshot = id(),
        context = r.context_json;
      context.providerInput.operationId = "pending";
      await tx.query(
        "INSERT INTO job_snapshots(id,workspace_id,kind,quote_id,config_release_id,schema_version,normalized_spec_hash,manifest_hash,manifest,entitlement_snapshot,warnings_acknowledged) VALUES($1,$2,'generation',$3,$4,1,$5,$6,$7,'{}','[]')",
        [
          snapshot,
          r.workspace_id,
          r.id,
          r.config_release_id,
          r.input_hash,
          payloadHash(context),
          context,
        ],
      );
      const job = await createJob(
        tx,
        {
          workspaceId: r.workspace_id,
          kind: "generation",
          configReleaseId: r.config_release_id,
          inputHash: r.input_hash,
          payload: { quoteId: r.id },
          createdBy: actor.userId,
          snapshotId: snapshot,
          quoteId: r.id,
          maxAttempts: validated.generationQueue.maxAttemptsPerTask,
          idempotencyRequestHash: requestHash,
        },
        key,
      );
      if (r.reference_asset_id) {
        const pins = (
          await tx.query(
            "SELECT v.storage_object_id FROM asset_variants v JOIN storage_objects o ON o.workspace_id=v.workspace_id AND o.id=v.storage_object_id WHERE v.workspace_id=$1 AND v.asset_id=$2 AND v.variant='normalized' AND o.state='verified' FOR SHARE OF v,o",
            [r.workspace_id, r.reference_asset_id],
          )
        ).rows;
        if (pins.length !== 1) fail("REFERENCE_UNAVAILABLE", 422);
        await tx.query(
          "INSERT INTO resource_pins(id,workspace_id,job_id,storage_workspace_id,storage_object_id,asset_id) VALUES($1,$2,$3,$2,$4,$5)",
          [
            id(),
            r.workspace_id,
            job.jobId,
            pins[0].storage_object_id,
            r.reference_asset_id,
          ],
        );
      }
      await this.credits.reserveCredits(
        tx,
        r.workspace_id,
        job.jobId,
        Number(r.credit_cost),
      );
      if (quota)
        await reserveGenerationStorage(
          tx,
          r.workspace_id,
          job.jobId,
          quota.limitBytes,
        );
      await reserveProviderBudget(
        tx,
        context.accountBillingId,
        context.providerVersionId,
        Number(r.estimated_cost_fen),
        job.jobId,
        this.now().toISOString(),
      );
      await tx.query(
        "UPDATE generation_quote_inputs SET accepted_job_id=$2 WHERE quote_id=$1",
        [r.id, job.jobId],
      );
      return job;
    });
  }
  readonly terminalHook: TerminalCommit = async (tx, job, outcome) => {
    if (job.kind !== "generation") return;
    await tx.query(
      "UPDATE resource_pins SET released_at=clock_timestamp() WHERE workspace_id=$1 AND job_id=$2 AND released_at IS NULL",
      [job.workspaceId, job.jobId],
    );
    await tx.query(
      "UPDATE ai_submission_slots SET closed_at=clock_timestamp() WHERE job_id=$1",
      [job.jobId],
    );
    await closeGenerationStorage(
      tx,
      job.workspaceId,
      job.jobId,
      Number((outcome.result as any)?.storageBytes ?? 0),
      outcome.state === "succeeded",
    );
    const r = (
      await tx.query(
        "SELECT id FROM budget_reservations WHERE workspace_id=$1 AND job_id=$2",
        [job.workspaceId, job.jobId],
      )
    ).rows[0];
    if (r)
      await closeProviderBudget(
        tx,
        r.id,
        Number((outcome.result as any)?.costFen ?? 0),
        outcome.state === "succeeded" ||
          Number((outcome.result as any)?.costFen ?? 0) > 0
          ? "settled"
          : "released",
      );
  };
}
