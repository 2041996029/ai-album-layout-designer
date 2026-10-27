import { testDatabase } from "./database";
import { AuthService } from "../src/auth/identity";
import { WorkspaceService } from "../src/workspaces/service";
import { id } from "@album/server-core";
import { payloadHash, type ConfigRelease } from "../src/config/types";
import { ProviderRegistry, ReplayProvider } from "@album/providers";
export async function aiFixture() {
  const db = await testDatabase();
  const auth = new AuthService(db.database, {
    secret: "ai-contract-test-secret-at-least-thirty-two",
    environment: "dev",
  });
  const actor = (
    await auth.login(
      {
        exchange: async () => ({
          provider: "email",
          appId: "email",
          subject: "ai-test@example.com",
          unionId: null,
          openPlatformId: null,
        }),
      },
      id(),
      "web",
    )
  ).actor;
  const workspaces = new WorkspaceService(db.database, auth),
    wid = (await workspaces.createWorkspace(actor, "personal", "AI contract"))
      .workspaceId;
  const ids = Object.fromEntries(
    [
      "account",
      "connection",
      "secret",
      "license",
      "report",
      "modelBase",
      "model",
      "routeBase",
      "route",
      "cost",
      "presetBase",
      "preset",
      "release",
    ].map((k) => [k, id()]),
  );
  const registry = new ProviderRegistry();
  registry.register(new ReplayProvider({ scenario: "success" }));
  const payloads: any = {
    aiConnection: {
      kind: "aiConnection",
      adapterId: "replay",
      adapterVersion: "v1",
      name: "Contract replay",
      baseUrl: "https://images.example.com",
      credential: { secretRef: ids.secret, secretVersion: "v1" },
      accountBillingId: ids.account,
      connectTimeoutMs: 5000,
      requestTimeoutMs: 60000,
      maxConcurrent: 1,
      requestsPerMinute: 100,
      dailyBudgetFen: 100,
      budgetTimezone: "Asia/Shanghai",
      dataUsePolicyRef: { id: "data-policy", version: 1 },
      enabled: true,
    },
    aiRoute: {
      kind: "aiRoute",
      capability: "textToImage",
      primaryModelRef: { id: ids.model, version: 1 },
      fallbackModelRefs: [],
      fallbackPolicy: "beforeAcceptanceOnly",
      enabled: true,
    },
    aiPricing: {
      kind: "aiPricing",
      costRuleId: ids.cost,
      modelRef: { id: ids.model, version: 1 },
      presetRef: { id: ids.preset, version: 1 },
      creditsPerImage: 1,
      estimatedProviderCostFen: 10,
      quoteTtlSeconds: 300,
      unknownFinalTimeoutSeconds: 1800,
      countPerChildTask: 1,
      enabled: true,
    },
    content: {
      kind: "content",
      moderationRouteRef: { id: "moderation", version: 1 },
      labelPolicyRef: { id: "label", version: 1 },
      licensePolicyVersion: { id: "policy", version: 1 },
      allowedOrigins: ["generated", "uploaded"],
      referenceConsentRequired: true,
      quarantineOnUnverified: true,
    },
    queue: {
      kind: "queue",
      workerKind: "generation",
      enabled: true,
      maxGlobalConcurrency: 4,
      maxWorkspaceConcurrency: 1,
      leaseSeconds: 60,
      maxAttemptsPerTask: 1,
      retryLimit: 0,
      retryBackoffSeconds: [],
      heartbeatSeconds: 10,
    },
  };
  const versions: any = {};
  for (const [k, p] of Object.entries(payloads))
    versions[k] = {
      id:
        k === "aiConnection"
          ? (ids.provider ?? ids.connection)
          : k === "aiRoute"
            ? ids.route
            : id(),
      namespace: k,
      version: 1,
      environment: "dev",
      payload: p,
      revision: 1,
      state: "published",
      payloadHash: payloadHash(p),
    };
  // provider version ID is stable and distinct from logical connection.
  ids.provider = id();
  versions.aiConnection.id = ids.provider;
  const manifest = {
    versions,
    sourceDrafts: {},
    reason: "Isolated contract fixture",
    previousReleaseId: null,
  };
  const release: ConfigRelease = {
    releaseId: ids.release,
    versionIds: Object.values(versions).map((v: any) => v.id),
    versions,
    effectiveAt: new Date().toISOString(),
  };
  await db.database.transaction(async (tx) => {
    for (const role of ["platform_ops", "content", "finance"])
      await tx.query(
        "INSERT INTO admin_role_assignments(id,user_id,role) VALUES($1,$2,$3)",
        [id(), actor.userId, role],
      );
    await tx.query(
      "INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose) VALUES($1,'dev','contract-only','v1','ai')",
      [ids.secret],
    );
    await tx.query(
      "INSERT INTO license_versions(id,license_key,version,source_uri,terms_hash,commercial_allowed,reference_input_allowed,valid_from,territories,restrictions) VALUES($1,'original-contract',1,'original:contract',$2,true,true,now()-interval '1 day',ARRAY['CN'],$3)",
      [
        ids.license,
        "a".repeat(64),
        {
          author: "Fixture",
          allowModification: true,
          allowRedistribution: true,
        },
      ],
    );
    await tx.query(
      "INSERT INTO ai_billing_accounts(id,environment,account_billing_id,provider_name,daily_budget_fen) VALUES($1,'dev',$1,'replay',100)",
      [ids.account],
    );
    await tx.query(
      "INSERT INTO ai_provider_connections(id,environment,billing_account_id,name,state) VALUES($1,'dev',$2,'Replay','ready')",
      [ids.connection, ids.account],
    );
    await tx.query(
      "INSERT INTO ai_provider_versions(id,connection_id,billing_account_id,environment,version,adapter_id,adapter_version,base_url,secret_reference_id,auth_mode,max_concurrent,requests_per_minute,daily_budget_fen,allowed_data_use,capabilities) VALUES($1,$2,$3,'dev',1,'replay','v1','https://images.example.com',$4,'bearer',4,100,100,$5,$6)",
      [
        ids.provider,
        ids.connection,
        ids.account,
        ids.secret,
        { policyVersion: "data-policy@1", training: false, retentionDays: 0 },
        { textToImage: true },
      ],
    );
    await tx.query(
      "INSERT INTO config_tests(id,environment,subject_kind,subject_id,subject_hash,test_kind,state,report,executed_by) VALUES($1,'dev','model',$2,$3,'sample','passed',$4,$5)",
      [
        ids.report,
        ids.model,
        payloadHash({}),
        { verifiedChecks: ["inference"], actualServiceMode: "replay" },
        actor.userId,
      ],
    );
    await tx.query(
      "INSERT INTO ai_models(id,name,state) VALUES($1,'Contract model','ready')",
      [ids.modelBase],
    );
    await tx.query(
      "INSERT INTO ai_model_versions(id,model_id,version,provider_version_id,provider_model_id,provider_model_version,license_version_id,input_schema_version,output_schema_version,capabilities,parameter_schema,limits_json,moderation_policy_ref,label_policy_ref,test_report_id) VALUES($1,$2,1,$3,'contract','v1',$4,1,1,$5,'{}',$6,'moderation@1','label@1',$7)",
      [
        ids.model,
        ids.modelBase,
        ids.provider,
        ids.license,
        { textToImage: true },
        { sizes: { "1:1": { width: 128, height: 128 } } },
        ids.report,
      ],
    );
    await tx.query(
      "INSERT INTO ai_routes(id,capability,name,state) VALUES($1,'textToImage','Contract','active')",
      [ids.routeBase],
    );
    await tx.query(
      "INSERT INTO ai_route_versions(id,route_id,version,primary_model_version_id) VALUES($1,$2,1,$3)",
      [ids.route, ids.routeBase, ids.model],
    );
    await tx.query(
      "INSERT INTO cost_rule_versions(id,rule_key,version,credit_cost,estimated_cost_fen,max_cost_fen,parameters) VALUES($1::text,$1::text,1,1,10,10,'{}')",
      [ids.cost],
    );
    await tx.query(
      "INSERT INTO ai_presets(id,name,category,state) VALUES($1,'山水水墨','ink','published')",
      [ids.presetBase],
    );
    await tx.query(
      "INSERT INTO ai_preset_versions(id,preset_id,version,license_version_id,cost_rule_version_id,parameter_template,editable_parameters,moderation_policy_ref,label_policy_ref) VALUES($1,$2,1,$3,$4,$5,ARRAY['description'],'moderation@1','label@1')",
      [
        ids.preset,
        ids.presetBase,
        ids.license,
        ids.cost,
        { prompt: "水墨：{{description}}" },
      ],
    );
    await tx.query(
      "INSERT INTO ai_preset_models(id,preset_version_id,model_version_id) VALUES($1,$2,$3)",
      [id(), ids.preset, ids.model],
    );
    await tx.query(
      "INSERT INTO config_releases(id,environment,release_number,schema_version,manifest_hash,manifest,published_by) VALUES($1,'dev',1,1,$2,$3,$4)",
      [ids.release, payloadHash(manifest), manifest, actor.userId],
    );
    for (const [k, v] of Object.entries(versions) as any)
      await tx.query(
        "INSERT INTO config_release_items(id,release_id,namespace,schema_version,body_hash,body) VALUES($1,$2,$3,1,$4,$5)",
        [id(), ids.release, k, v.payloadHash, v.payload],
      );
    await tx.query(
      "INSERT INTO config_active_releases(id,environment,release_id) VALUES($1,'dev',$2)",
      [id(), ids.release],
    );
    const sku = id(),
      sv = id(),
      order = id(),
      grant = id();
    await tx.query(
      "INSERT INTO billing_skus(id,code,name,state) VALUES($1::text,$1::text,'Contract credits','active')",
      [sku],
    );
    await tx.query(
      "INSERT INTO sku_versions(id,sku_id,version,price_fen,duration_days,credit_grant,features) VALUES($1,$2,1,1,30,100,'{}')",
      [sv, sku],
    );
    await tx.query(
      "INSERT INTO orders(id,workspace_id,sku_version_id,buyer_user_id,amount_fen,state,channel,client_platform,expires_at) VALUES($1,$2,$3,$4,1,'paid','wechat_pay','web',now()+interval '1 day')",
      [order, wid, sv, actor.userId],
    );
    await tx.query(
      "INSERT INTO entitlement_grants(id,workspace_id,source_order_id,grant_type,starts_at,ends_at,features) VALUES($1,$2,$3,'credits',now(),now()+interval '30 days','{}')",
      [grant, wid, order],
    );
    await tx.query(
      "INSERT INTO credit_lots(id,workspace_id,source_grant_id,granted,available,expires_at) VALUES($1,$2,$3,100,100,now()+interval '30 days')",
      [id(), wid, grant],
    );
  });
  return {
    ...db,
    auth,
    actor,
    workspaces,
    wid,
    ids,
    registry,
    release,
    input: {
      workspaceId: wid,
      presetVersionId: ids.preset,
      capability: "textToImage" as const,
      description: "晨光中的群山",
      ratio: "1:1",
      imageCount: 1 as const,
    },
  };
}
