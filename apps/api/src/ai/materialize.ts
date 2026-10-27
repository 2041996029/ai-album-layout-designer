import { digest, fail, id } from "@album/server-core";
import type { PoolClient } from "pg";
import type { ConfigRelease, Environment } from "../config/types";
import type { ProviderRegistry } from "@album/providers";
import { readLicense, validateLicense } from "./catalog";
/** Runs in the C4 publication transaction. Logical account caps are finance-owned and never reset by credential rotation. */
export async function materializeAiConfig(
  tx: PoolClient,
  release: ConfigRelease,
  environment: Environment,
  registry?: ProviderRegistry,
) {
  const connection = release.versions.aiConnection;
  if (
    connection?.payload.kind === "aiConnection" &&
    !(
      await tx.query("SELECT 1 FROM ai_provider_versions WHERE id=$1", [
        connection.id,
      ])
    ).rowCount
  ) {
    const p = connection.payload;
    if (!registry) fail("AI_ADAPTER_UNCONFIGURED", 503);
    const adapter = registry.get(p.adapterId, p.adapterVersion);
    if (environment !== "dev" && adapter.mode !== "live")
      fail("AI_ADAPTER_UNCONFIGURED", 503);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "ai-catalog:" + environment,
    ]);
    let account = (
      await tx.query(
        "SELECT * FROM ai_billing_accounts WHERE environment=$1 AND account_billing_id=$2 FOR UPDATE",
        [environment, p.accountBillingId],
      )
    ).rows[0];
    if (!account) {
      account = (
        await tx.query(
          "INSERT INTO ai_billing_accounts(id,environment,account_billing_id,provider_name,daily_budget_fen) VALUES($1,$2,$3,$4,0) RETURNING *",
          [id(), environment, p.accountBillingId, p.adapterId],
        )
      ).rows[0];
    }
    let logical = (
      await tx.query(
        "SELECT * FROM ai_provider_connections WHERE environment=$1 AND name=$2 FOR UPDATE",
        [environment, p.name],
      )
    ).rows[0];
    if (logical && logical.billing_account_id !== account.id)
      fail("AI_BILLING_IDENTITY_CONFLICT", 409);
    if (!logical)
      logical = (
        await tx.query(
          "INSERT INTO ai_provider_connections(id,environment,billing_account_id,name,state) VALUES($1,$2,$3,$4,$5) RETURNING *",
          [
            id(),
            environment,
            account.id,
            p.name,
            p.enabled && p.dailyBudgetFen > 0 ? "ready" : "disabled",
          ],
        )
      ).rows[0];
    else
      await tx.query(
        "UPDATE ai_provider_connections SET state=$2,revision=revision+1 WHERE id=$1",
        [logical.id, p.enabled && p.dailyBudgetFen > 0 ? "ready" : "disabled"],
      );
    const secret = (
      await tx.query(
        "SELECT id FROM secret_references WHERE environment=$1 AND (id::text=$2::text OR secret_ref=$2::text) AND secret_version=$3 AND purpose='ai' AND state='available' ORDER BY (id::text=$2::text) DESC LIMIT 1",
        [environment, p.credential.secretRef, p.credential.secretVersion],
      )
    ).rows[0];
    if (!secret) fail("SECRET_UNAVAILABLE", 409);
    await tx.query(
      "INSERT INTO ai_provider_versions(id,connection_id,billing_account_id,environment,version,adapter_id,adapter_version,base_url,secret_reference_id,auth_mode,connect_timeout_ms,request_timeout_ms,max_concurrent,requests_per_minute,daily_budget_fen,allowed_data_use,capabilities) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'bearer',$10,$11,$12,$13,$14,$15,$16)",
      [
        connection.id,
        logical.id,
        account.id,
        environment,
        connection.version,
        p.adapterId,
        p.adapterVersion,
        p.baseUrl,
        secret.id,
        p.connectTimeoutMs,
        p.requestTimeoutMs,
        p.maxConcurrent,
        p.requestsPerMinute,
        p.dailyBudgetFen,
        { policyRef: p.dataUsePolicyRef },
        Object.fromEntries([...adapter.capabilities].map((c) => [c, true])),
      ],
    );
  }
  if (connection?.payload.kind === "aiConnection")
    await tx.query(
      "UPDATE ai_provider_connections SET state=$2,revision=revision+1 WHERE id=(SELECT connection_id FROM ai_provider_versions WHERE id=$1) AND state<>$2",
      [
        connection.id,
        connection.payload.enabled && connection.payload.dailyBudgetFen > 0
          ? "ready"
          : "disabled",
      ],
    );
  const route = release.versions.aiRoute;
  if (
    route?.payload.kind === "aiRoute" &&
    !(await tx.query("SELECT 1 FROM ai_route_versions WHERE id=$1", [route.id]))
      .rowCount
  ) {
    const p = route.payload;
    if (p.capability === "textSuggestion") fail("CAPABILITY_RESERVED", 422);
    if (p.fallbackModelRefs.length) fail("AI_FALLBACK_UNAVAILABLE", 422);
    for (const ref of [p.primaryModelRef, ...p.fallbackModelRefs]) {
      const m = (
        await tx.query(
          "SELECT v.*,b.state,p.environment FROM ai_model_versions v JOIN ai_models b ON b.id=v.model_id JOIN ai_provider_versions p ON p.id=v.provider_version_id WHERE v.id=$1 AND v.version=$2",
          [ref.id, ref.version],
        )
      ).rows[0];
      if (
        !m ||
        m.state !== "ready" ||
        m.environment !== environment ||
        !m.capabilities[p.capability]
      )
        fail("MODEL_UNVERIFIED", 409);
      validateLicense(
        await readLicense(tx, { id: m.license_version_id }),
        new Date(),
        "CN",
        p.capability === "imageToImage",
      );
    }
    const base = digest(environment + ":route:" + p.capability);
    await tx.query(
      "INSERT INTO ai_routes(id,capability,name,state) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET state=excluded.state,revision=ai_routes.revision+1",
      [
        base,
        p.capability,
        environment + " " + p.capability,
        p.enabled ? "active" : "retired",
      ],
    );
    await tx.query(
      "INSERT INTO ai_route_versions(id,route_id,version,primary_model_version_id,fallback_model_version_id,fallback_policy) VALUES($1,$2,$3,$4,NULL,'none')",
      [route.id, base, route.version, p.primaryModelRef.id],
    );
  }
  if (route?.payload.kind === "aiRoute")
    await tx.query(
      "UPDATE ai_routes SET state=$2,revision=revision+1 WHERE id=(SELECT route_id FROM ai_route_versions WHERE id=$1) AND state<>$2",
      [route.id, route.payload.enabled ? "active" : "retired"],
    );
  const pricing = release.versions.aiPricing;
  if (pricing?.payload.kind === "aiPricing" && pricing.payload.enabled) {
    const p = pricing.payload;
    const cost = (
      await tx.query("SELECT * FROM cost_rule_versions WHERE id=$1", [
        p.costRuleId,
      ])
    ).rows[0];
    if (
      !cost ||
      Number(cost.credit_cost) !== p.creditsPerImage ||
      Number(cost.estimated_cost_fen) !== p.estimatedProviderCostFen
    )
      fail("AI_PRICING_UNCONFIGURED", 409);
  }
}
