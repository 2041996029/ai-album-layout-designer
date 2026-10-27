import {
  fail,
  id,
  digest,
  type Actor,
  type Database,
} from "@album/server-core";
import type { PoolClient } from "pg";
import type { AuthService } from "../auth/identity";
import { audit, requireRoles, requireReason } from "../config/secrets";
import type { ProviderRegistry } from "@album/providers";
import type {
  LicenseRecord,
  ModelVersion,
  PresetVersion,
} from "./catalog-types";
import { payloadHash } from "../config/types";
export const originalPresets = [
  {
    name: "山水水墨",
    category: "ink-landscape",
    prompt:
      "以原创中国水墨山水语言表现：{{description}}。保留呼吸感留白，墨色层次自然，不添加文字。",
  },
  {
    name: "人像淡彩",
    category: "portrait-watercolor",
    prompt:
      "以原创淡彩手绘语言表现：{{description}}。柔和纸张纹理，自然光影，不添加文字，不保证人物身份完全一致。",
  },
  {
    name: "花鸟写意",
    category: "ink-flora",
    prompt:
      "以原创花鸟写意语言表现：{{description}}。疏密有致、笔触轻盈、背景留白，不添加文字。",
  },
] as const;
export function renderPresetPrompt(template: string, description: string) {
  if (/\{\{(?!description\}\})/.test(template))
    fail("PRESET_VARIABLE_UNSUPPORTED", 422);
  const result = template.replaceAll("{{description}}", description);
  if (!result || result.length > 20000) fail("PROMPT_TOO_LONG", 422);
  return result;
}
export function validateLicense(
  l: LicenseRecord,
  now: Date,
  territory: string,
  reference: boolean,
) {
  if (!l.commercialAllowed) fail("LICENSE_NOT_COMMERCIAL", 422);
  if (l.expiresAt && new Date(l.expiresAt) <= now) fail("LICENSE_EXPIRED", 422);
  if (!l.territories.includes("*") && !l.territories.includes(territory))
    fail("LICENSE_TERRITORY_UNAVAILABLE", 422);
  if (reference && !l.allowReference) fail("REFERENCE_NOT_LICENSED", 422);
}
export async function readLicense(
  tx: PoolClient,
  ref: { id: string; version?: number },
): Promise<LicenseRecord> {
  const row = (
    await tx.query("SELECT * FROM license_versions WHERE id=$1", [ref.id])
  ).rows[0];
  if (
    !row ||
    (ref.version !== undefined && row.version !== ref.version) ||
    row.valid_from > new Date()
  )
    fail("LICENSE_UNAVAILABLE", 409);
  return {
    id: row.id,
    version: row.version,
    source: row.source_uri,
    author: row.restrictions.author ?? "",
    termsVersion: row.restrictions.termsVersion ?? row.terms_hash,
    commercialAllowed: row.commercial_allowed,
    allowReference: row.reference_input_allowed,
    allowModification: row.restrictions.allowModification === true,
    allowRedistribution: row.restrictions.allowRedistribution === true,
    attribution: row.restrictions.attribution ?? null,
    expiresAt: row.valid_until?.toISOString() ?? null,
    territories: row.territories,
  };
}
export const modelProofHash = (m: ModelVersion) =>
  payloadHash({
    providerVersionId: m.connectionVersionId,
    providerModelId: m.providerModelId,
    providerModelVersion: m.providerModelVersion,
    capabilities: m.capabilities,
    parameterSchema: m.parameterSchema,
    sizes: m.sizes ?? {},
    licenseRef: m.licenseRef,
    moderationPolicyVersion: m.moderationPolicyVersion,
    labelPolicyVersion: m.labelPolicyVersion,
  });
export class AiCatalog {
  constructor(
    private db: Database,
    private auth: AuthService,
    private registry: ProviderRegistry,
    readonly environment: "dev" | "staging" | "prod",
    private territory = "CN",
  ) {}
  async publishModel(actor: Actor, model: ModelVersion) {
    return this.db.transaction(async (tx) => {
      await requireRoles(tx, this.auth, actor, ["platform_ops"]);
      const license = await readLicense(tx, model.licenseRef);
      validateLicense(
        license,
        new Date(),
        this.territory,
        model.capabilities.includes("imageToImage"),
      );
      const provider = (
        await tx.query(
          "SELECT * FROM ai_provider_versions WHERE id=$1 AND environment=$2",
          [model.connectionVersionId, this.environment],
        )
      ).rows[0];
      if (!provider) fail("AI_CONNECTION_UNAVAILABLE", 409);
      const adapter = this.registry.get(
        provider.adapter_id,
        provider.adapter_version,
      );
      if (model.capabilities.some((c) => !adapter.capabilities.has(c)))
        fail("UNSUPPORTED_CAPABILITY", 422);
      const report = (
        await tx.query(
          "SELECT * FROM config_tests WHERE id=$1 AND environment=$2 AND state='passed' AND test_kind IN ('sample','capability') AND created_at>clock_timestamp()-interval '5 minutes'",
          [model.testReportId, this.environment],
        )
      ).rows[0];
      if (
        !report ||
        report.subject_id !== model.id ||
        report.subject_hash !== modelProofHash(model) ||
        !report.report.verifiedChecks?.includes("inference") ||
        (this.environment !== "dev" &&
          report.report.actualServiceMode !== "live")
      )
        fail("MODEL_UNVERIFIED", 409);
      const base = digest(
        model.connectionVersionId + ":" + model.providerModelId,
      );
      await tx.query(
        "INSERT INTO ai_models(id,name,state) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=ai_models.revision+1",
        [base, model.providerModelId, model.state],
      );
      await tx.query(
        "INSERT INTO ai_model_versions(id,model_id,version,provider_version_id,provider_model_id,provider_model_version,license_version_id,input_schema_version,output_schema_version,capabilities,parameter_schema,limits_json,moderation_policy_ref,label_policy_ref,test_report_id) VALUES($1,$2,$3,$4,$5,$6,$7,1,1,$8,$9,$10,$11,$12,$13)",
        [
          model.id,
          base,
          model.version,
          provider.id,
          model.providerModelId,
          model.providerModelVersion,
          license.id,
          Object.fromEntries(model.capabilities.map((c) => [c, true])),
          model.parameterSchema,
          { sizes: model.sizes ?? { "1:1": { width: 1024, height: 1024 } } },
          model.moderationPolicyVersion,
          model.labelPolicyVersion,
          model.testReportId,
        ],
      );
      await audit(
        tx,
        actor,
        {},
        "ai.model.published",
        "ai_model_version",
        model.id,
        "Publish verified model",
        { version: model.version },
      );
    });
  }
  async publishPreset(actor: Actor, p: PresetVersion) {
    return this.db.transaction(async (tx) => {
      await requireRoles(tx, this.auth, actor, ["content"]);
      validateLicense(
        await readLicense(tx, p.licenseRef),
        new Date(),
        this.territory,
        false,
      );
      if (
        p.state !== "published" ||
        !p.modelVersionIds.length ||
        !p.moderationPolicyVersion ||
        !p.labelPolicyVersion
      )
        fail("PRESET_UNVERIFIED", 422);
      renderPresetPrompt(String(p.parameterTemplate.prompt ?? ""), "test");
      const models = (
        await tx.query(
          "SELECT v.id,v.moderation_policy_ref,v.label_policy_ref FROM ai_model_versions v JOIN ai_models m ON m.id=v.model_id WHERE v.id=ANY($1::text[]) AND m.state='ready'",
          [p.modelVersionIds],
        )
      ).rows;
      if (
        models.some(
          (m) =>
            m.moderation_policy_ref !== p.moderationPolicyVersion ||
            m.label_policy_ref !== p.labelPolicyVersion,
        )
      )
        fail("GENERATION_POLICY_MISMATCH", 422);
      if (models.length !== new Set(p.modelVersionIds).size)
        fail("MODEL_UNVERIFIED", 409);
      if (
        !(
          await tx.query("SELECT 1 FROM cost_rule_versions WHERE id=$1", [
            p.pricingVersionId,
          ])
        ).rowCount
      )
        fail("AI_PRICING_UNCONFIGURED", 409);
      const base = digest(p.category + ":" + p.name);
      await tx.query(
        "INSERT INTO ai_presets(id,name,category,state) VALUES($1,$2,$3,'published') ON CONFLICT(id) DO UPDATE SET state='published',revision=ai_presets.revision+1",
        [base, p.name, p.category],
      );
      await tx.query(
        "INSERT INTO ai_preset_versions(id,preset_id,version,license_version_id,cost_rule_version_id,parameter_template,editable_parameters,moderation_policy_ref,label_policy_ref) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [
          p.id,
          base,
          p.version,
          p.licenseRef.id,
          p.pricingVersionId,
          p.parameterTemplate,
          p.editableParameters,
          p.moderationPolicyVersion,
          p.labelPolicyVersion,
        ],
      );
      for (const model of p.modelVersionIds)
        await tx.query(
          "INSERT INTO ai_preset_models(id,preset_version_id,model_version_id) VALUES($1,$2,$3)",
          [id(), p.id, model],
        );
      await audit(
        tx,
        actor,
        {},
        "ai.preset.published",
        "ai_preset_version",
        p.id,
        "Publish licensed preset",
        { version: p.version },
      );
    });
  }
  async retire(
    actor: Actor,
    kind: "model" | "preset",
    entityId: string,
    reason: string,
  ) {
    requireReason(reason);
    return this.db.transaction(async (tx) => {
      await requireRoles(tx, this.auth, actor, [
        kind === "model" ? "platform_ops" : "content",
      ]);
      const table = kind === "model" ? "ai_models" : "ai_presets";
      const r = await tx.query(
        `UPDATE ${table} SET state='retired',revision=revision+1 WHERE id=$1 RETURNING id`,
        [entityId],
      );
      if (!r.rowCount) fail("NOT_FOUND", 404);
      await audit(
        tx,
        actor,
        {},
        "ai." + kind + ".retired",
        kind,
        entityId,
        reason,
      );
    });
  }
}
