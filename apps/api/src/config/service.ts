import { randomBytes } from "node:crypto";
import {
  type Actor,
  type Database,
  digest,
  fail,
  id,
  runIdempotent,
} from "@album/server-core";
import type { PoolClient } from "pg";
import type { AuthService } from "../auth/identity";
import type { ReauthService } from "../auth/reauthentication";
import { assertApprovedHttps } from "./network-policy";
import { audit, requireReason, requireRoles } from "./secrets";
import {
  publicCapabilities,
  type CapabilityName,
  type Readiness,
} from "./capabilities";
import {
  CONFIG_REGISTRY,
  deepFreeze,
  fieldValues,
  payloadHash,
  validateConfigPayload,
  type ConfigIntegration,
  type ConfigKind,
  type ConfigPayload,
  type ConfigRelease,
  type ConfigVersion,
  type DependencyPort,
  type Environment,
  type RequestContext,
  type SecretBinding,
  type SecretPort,
  type StorageProbe,
  type TestLevel,
  type TestResult,
} from "./types";
export type {
  ConfigPayload,
  ConfigVersion,
  ConfigRelease,
  SecretPort,
} from "./types";

type AuthPort = Pick<AuthService, "assertActor">;
export type ConfigOptions = {
  environment: Environment;
  reauth: Pick<ReauthService, "verifyFresh">;
  /** Controlled clock for tests. Production uses the database clock inside transactions. */
  now?: () => Date;
  dependencies?: DependencyPort;
  integrations?: Partial<Record<ConfigKind, ConfigIntegration>>;
  storageProbe?: StorageProbe;
  allowedHosts?: string[];
  assertEndpoint?: typeof assertApprovedHttps;
  readiness?: Readiness;
  /** Deployment limits are authoritative even if the dynamic schema permits more. */
  hardCaps?: {
    maxGlobalConcurrency?: number;
    maxWorkspaceConcurrency?: number;
    browserBudgetMiB?: number;
    workerBudgetMiB?: number;
    maxSurfacePixels?: number;
  };
};
type DraftRow = {
  id: string;
  namespace: string;
  environment: Environment;
  revision: string;
  body: ConfigPayload;
  body_hash: string;
};
type SourceDraft = { id: string; revision: number };
type Manifest = {
  versions: Record<string, ConfigVersion>;
  sourceDrafts: Record<string, SourceDraft>;
  reason: string;
  previousReleaseId: string | null;
};
type ReleaseRow = {
  id: string;
  created_at: Date;
  manifest: Manifest;
  manifest_hash: string;
};
const levels: TestLevel[] = [
  "schema",
  "connection",
  "capability",
  "sample",
  "storage_roundtrip",
];
const names: CapabilityName[] = [
  "cloudUpload",
  "generation",
  "purchase",
  "cloudExport",
  "sharing",
  "notification",
  "login",
];
const isBinding = (v: unknown): v is SecretBinding =>
  !!v && typeof v === "object" && "secretRef" in v && "secretVersion" in v;
function secretBindings(payload: ConfigPayload): SecretBinding[] {
  return CONFIG_REGISTRY[payload.kind].secretFields.flatMap((field) =>
    fieldValues(payload, field).filter(isBinding),
  );
}
function requiredTests(payload: ConfigPayload): readonly TestLevel[] {
  return "enabled" in payload && !payload.enabled
    ? ["schema"]
    : CONFIG_REGISTRY[payload.kind].requiredTests;
}

/** One mutable draft per environment/namespace; immutable release items own published versions. */
export class ConfigService {
  constructor(
    private db: Database,
    private auth: AuthPort,
    private secrets: SecretPort,
    private options: ConfigOptions,
    private request: RequestContext = {},
  ) {}
  withRequest(request: RequestContext) {
    return new ConfigService(
      this.db,
      this.auth,
      this.secrets,
      this.options,
      request,
    );
  }
  withIntegrations(integrations: ConfigOptions["integrations"]) {
    return new ConfigService(
      this.db,
      this.auth,
      this.secrets,
      {
        ...this.options,
        integrations: { ...this.options.integrations, ...integrations },
      },
      this.request,
    );
  }
  withStorageProbe(storageProbe: StorageProbe) {
    return new ConfigService(
      this.db,
      this.auth,
      this.secrets,
      { ...this.options, storageProbe },
      this.request,
    );
  }
  private async clock(tx: PoolClient) {
    return (
      this.options.now?.() ??
      new Date((await tx.query("SELECT clock_timestamp() AS at")).rows[0].at)
    );
  }
  private async authorize(tx: PoolClient, actor: Actor, namespace: string) {
    if (!Object.hasOwn(CONFIG_REGISTRY, namespace))
      fail("CONFIG_NAMESPACE_MISMATCH", 422);
    await requireRoles(
      tx,
      this.auth,
      actor,
      CONFIG_REGISTRY[namespace as ConfigKind].roles,
    );
  }
  private async stepUp(
    tx: PoolClient,
    actor: Actor,
    purpose: "admin_publish" | "admin_operations" = "admin_publish",
  ) {
    if (
      purpose === "admin_publish" &&
      !actor.platformPermissions.includes("config:publish")
    )
      fail("FORBIDDEN", 403);
    await this.options.reauth.verifyFresh(
      actor,
      this.request.reauthProof ?? "",
      purpose,
      tx,
    );
  }
  private async active(tx: PoolClient): Promise<ReleaseRow | null> {
    return (
      (
        await tx.query(
          "SELECT r.* FROM config_active_releases a JOIN config_releases r ON r.id=a.release_id AND r.environment=a.environment WHERE a.environment=$1",
          [this.options.environment],
        )
      ).rows[0] ?? null
    );
  }
  private version(
    row: DraftRow,
    active: ReleaseRow | null,
    state: ConfigVersion["state"] = "draft",
  ): ConfigVersion {
    const source = active?.manifest.sourceDrafts[row.namespace];
    const current = active?.manifest.versions[row.namespace];
    if (
      source?.id === row.id &&
      source.revision === Number(row.revision) &&
      current?.payloadHash === row.body_hash
    )
      state = "published";
    return {
      id: row.id,
      namespace: row.namespace,
      version:
        state === "published" ? current!.version : (current?.version ?? 0) + 1,
      environment: row.environment,
      payload: row.body,
      revision: Number(row.revision),
      state,
      payloadHash: row.body_hash,
    };
  }
  private async publishedDraft(
    tx: PoolClient,
    row: DraftRow,
  ): Promise<ConfigVersion | null> {
    const { rows } = await tx.query(
      "SELECT manifest->'versions'->$2 AS version FROM config_releases WHERE environment=$1 AND manifest->'sourceDrafts'->$2->>'id'=$3 AND manifest->'sourceDrafts'->$2->>'revision'=$4 ORDER BY release_number DESC LIMIT 1",
      [
        this.options.environment,
        row.namespace,
        row.id,
        row.revision.toString(),
      ],
    );
    return rows[0]?.version ?? null;
  }
  private async replay(
    tx: PoolClient,
    scope: string,
    hash: string,
  ): Promise<ConfigRelease | undefined> {
    if (!this.request.idempotencyKey) return undefined;
    const { rows } = await tx.query(
      "SELECT request_hash,response_json FROM idempotency_keys WHERE principal_scope=$1 AND idempotency_key=$2 AND expires_at>clock_timestamp()",
      [scope, this.request.idempotencyKey],
    );
    if (!rows[0]) return undefined;
    if (rows[0].request_hash !== hash) fail("IDEMPOTENCY_CONFLICT", 409);
    return rows[0].response_json as ConfigRelease;
  }
  private async draft(
    tx: PoolClient,
    id: string,
    lock = false,
  ): Promise<DraftRow> {
    const { rows } = await tx.query(
      `SELECT * FROM config_drafts WHERE id=$1 AND environment=$2${lock ? " FOR UPDATE" : ""}`,
      [id, this.options.environment],
    );
    if (!rows[0]) fail("CONFIG_NOT_FOUND", 404);
    return rows[0];
  }
  private validate(
    namespace: string,
    payload: unknown,
  ): asserts payload is ConfigPayload {
    validateConfigPayload(namespace, payload);
    const p = payload as ConfigPayload,
      caps = this.options.hardCaps;
    if (
      p.kind === "queue" &&
      ((caps?.maxGlobalConcurrency !== undefined &&
        p.maxGlobalConcurrency > caps.maxGlobalConcurrency) ||
        (caps?.maxWorkspaceConcurrency !== undefined &&
          p.maxWorkspaceConcurrency > caps.maxWorkspaceConcurrency))
    )
      fail("CONFIG_HARD_CAP_EXCEEDED", 422);
    if (
      p.kind === "export" &&
      (p.maxSurfacePixels > (caps?.maxSurfacePixels ?? 50_000_000) ||
        p.browserBudgetMiB > (caps?.browserBudgetMiB ?? 2048) ||
        p.workerBudgetMiB > (caps?.workerBudgetMiB ?? 2048))
    )
      fail("CONFIG_HARD_CAP_EXCEEDED", 422);
  }
  private async vaultBinding(binding: SecretBinding): Promise<SecretBinding> {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        "SELECT secret_ref,secret_version,state FROM secret_references WHERE environment=$1 AND (id=$2 OR secret_ref=$2) AND secret_version=$3 ORDER BY (id=$2) DESC LIMIT 1",
        [this.options.environment, binding.secretRef, binding.secretVersion],
      );
      if (!rows[0]) fail("SECRET_UNAVAILABLE", 409);
      if (rows[0].state !== "available") fail("SECRET_REVOKED", 409);
      return {
        secretRef: rows[0].secret_ref,
        secretVersion: rows[0].secret_version,
      };
    });
  }
  private async preflight(payloads: ConfigPayload[]) {
    // No database locks or transactions span DNS or the external secrets service.
    for (const payload of payloads) {
      this.validate(payload.kind, payload);
      const bindings: SecretBinding[] = [];
      for (const binding of secretBindings(payload))
        bindings.push(await this.vaultBinding(binding));
      for (const field of CONFIG_REGISTRY[payload.kind].secretFields)
        for (const value of fieldValues(payload, field))
          if (typeof value === "string") {
            const rows = await this.db.transaction(
              async (tx) =>
                (
                  await tx.query(
                    "SELECT secret_ref,secret_version FROM secret_references WHERE id=$1 AND environment=$2",
                    [value, this.options.environment],
                  )
                ).rows,
            );
            if (!rows[0]) fail("SECRET_UNAVAILABLE", 409);
            bindings.push({
              secretRef: rows[0].secret_ref,
              secretVersion: rows[0].secret_version,
            });
          }
      for (const binding of bindings)
        if (
          await this.secrets.isRevoked(binding.secretRef, binding.secretVersion)
        )
          fail("SECRET_REVOKED", 409);
      for (const field of CONFIG_REGISTRY[payload.kind].endpointFields)
        for (const value of fieldValues(payload, field))
          await (this.options.assertEndpoint ?? assertApprovedHttps)(
            value as string,
            this.options.allowedHosts ?? [],
          );
      const integration = this.options.integrations?.[payload.kind];
      const special =
        (payload.kind === "upload" && payload.multipartEnabled) ||
        (payload.kind === "storage" &&
          (payload.encryptionMode === "kms" || payload.cdnMode === "signed")) ||
        (payload.kind === "auth" && payload.smsEnabled) ||
        (payload.kind === "payment" && payload.refundEnabled);
      if (
        (special && !integration?.supports?.(payload)) ||
        (integration?.supports && !integration.supports(payload))
      )
        fail("CONFIG_ADAPTER_CAPABILITY_UNSUPPORTED", 422);
    }
  }
  private async validateSecrets(tx: PoolClient, payload: ConfigPayload) {
    const rule = CONFIG_REGISTRY[payload.kind];
    for (const field of rule.secretFields)
      for (const value of fieldValues(payload, field)) {
        const { rows } = isBinding(value)
          ? await tx.query(
              "SELECT id,state,purpose FROM secret_references WHERE environment=$1 AND (id=$2 OR secret_ref=$2) AND secret_version=$3 ORDER BY (id=$2) DESC LIMIT 1 FOR SHARE",
              [this.options.environment, value.secretRef, value.secretVersion],
            )
          : await tx.query(
              "SELECT id,state,purpose FROM secret_references WHERE environment=$1 AND id=$2 FOR SHARE",
              [this.options.environment, value],
            );
        if (!rows[0] || !rule.secretPurposes.includes(rows[0].purpose))
          fail("SECRET_UNAVAILABLE", 409);
        if (rows[0].state !== "available") fail("SECRET_REVOKED", 409);
      }
  }
  private async dependencies(
    tx: PoolClient,
    payload: ConfigPayload,
    versions: Record<string, ConfigVersion>,
  ) {
    for (const rule of CONFIG_REGISTRY[payload.kind].dependencies)
      for (const value of fieldValues(payload, rule.field)) {
        const ref = value as { id: string; version: number };
        const internal = Object.values(versions).find(
          (v) =>
            v.id === ref.id &&
            v.version === ref.version &&
            v.namespace === rule.target &&
            v.environment === this.options.environment,
        );
        if (internal) continue;
        if (!this.options.dependencies)
          fail("CONFIG_DEPENDENCY_UNAVAILABLE", 409);
        await this.options.dependencies.assertAvailable(
          rule.target,
          ref,
          this.options.environment,
          tx,
        );
      }
  }
  async createConfigDraft(
    actor: Actor,
    namespace: string,
    payload: ConfigPayload,
    baseVersion: number | null,
  ): Promise<ConfigVersion> {
    this.validate(namespace, payload);
    // Permission first: unauthorized callers cannot trigger endpoint probes.
    await this.db.transaction((tx) => this.authorize(tx, actor, namespace));
    await this.preflight([payload]);
    return this.db.transaction(async (tx) => {
      await this.authorize(tx, actor, namespace);
      const work = async () => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `config:draft:${this.options.environment}:${namespace}`,
        ]);
        const active = await this.active(tx),
          current = active?.manifest.versions[namespace];
        if ((current?.version ?? null) !== baseVersion)
          fail("REVISION_CONFLICT", 409);
        await this.validateSecrets(tx, payload);
        const existing = (
          await tx.query(
            "SELECT * FROM config_drafts WHERE environment=$1 AND namespace=$2 FOR UPDATE",
            [this.options.environment, namespace],
          )
        ).rows[0] as DraftRow | undefined;
        if (existing && !(await this.publishedDraft(tx, existing)))
          fail("CONFIG_DRAFT_EXISTS", 409);
        const { rows } = existing
          ? await tx.query(
              "UPDATE config_drafts SET revision=revision+1,body=$2,body_hash=$3,updated_by=$4 WHERE id=$1 RETURNING *",
              [existing.id, payload, payloadHash(payload), actor.userId],
            )
          : await tx.query(
              "INSERT INTO config_drafts(id,environment,namespace,body,body_hash,updated_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
              [
                id(),
                this.options.environment,
                namespace,
                payload,
                payloadHash(payload),
                actor.userId,
              ],
            );
        await audit(
          tx,
          actor,
          this.request,
          "config.draft.create",
          "config",
          rows[0].id,
          "Create configuration draft",
          {
            environment: this.options.environment,
            namespace,
            afterHash: rows[0].body_hash,
          },
        );
        return this.version(rows[0], active);
      };
      return this.request.idempotencyKey
        ? runIdempotent(
            tx,
            `config:create:${this.options.environment}:${actor.userId}`,
            this.request.idempotencyKey,
            payloadHash({ namespace, payload, baseVersion }),
            work,
          )
        : work();
    });
  }
  async updateConfigDraft(
    actor: Actor,
    draftId: string,
    expectedRevision: number,
    payload: ConfigPayload,
  ): Promise<ConfigVersion> {
    this.validate(payload.kind, payload);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      fail("REVISION_CONFLICT", 409);
    await this.db.transaction(async (tx) => {
      const draft = await this.draft(tx, draftId);
      await this.authorize(tx, actor, draft.namespace);
      if (draft.namespace !== payload.kind)
        fail("CONFIG_NAMESPACE_MISMATCH", 422);
    });
    await this.preflight([payload]);
    return this.db.transaction(async (tx) => {
      const draft = await this.draft(tx, draftId, true);
      await this.authorize(tx, actor, draft.namespace);
      if (draft.namespace !== payload.kind)
        fail("CONFIG_NAMESPACE_MISMATCH", 422);
      const active = await this.active(tx);
      if (await this.publishedDraft(tx, draft))
        fail("CONFIG_PUBLISHED_IMMUTABLE", 409);
      await this.validateSecrets(tx, payload);
      const { rows } = await tx.query(
        "UPDATE config_drafts SET revision=revision+1,body=$3,body_hash=$4,updated_by=$5 WHERE id=$1 AND revision=$2 RETURNING *",
        [
          draftId,
          expectedRevision,
          payload,
          payloadHash(payload),
          actor.userId,
        ],
      );
      if (!rows[0]) fail("REVISION_CONFLICT", 409);
      await audit(
        tx,
        actor,
        this.request,
        "config.draft.update",
        "config",
        draftId,
        "Update configuration draft",
        {
          environment: this.options.environment,
          namespace: draft.namespace,
          beforeHash: draft.body_hash,
          afterHash: rows[0].body_hash,
        },
      );
      return this.version(rows[0], active);
    });
  }
  async getConfigDraft(actor: Actor, draftId: string): Promise<ConfigVersion> {
    return this.db.transaction(async (tx) => {
      const row = await this.draft(tx, draftId);
      await this.authorize(tx, actor, row.namespace);
      const currentTime = await this.clock(tx);
      const tested = await tx.query(
        "SELECT 1 FROM config_tests WHERE draft_id=$1 AND subject_hash=$2 AND test_kind='schema' AND state='passed' AND created_at>$3::timestamptz-interval '5 minutes'",
        [draftId, row.body_hash, currentTime],
      );
      const active = await this.active(tx),
        historical = await this.publishedDraft(tx, row);
      const version = this.version(
        row,
        active,
        historical ? "retired" : tested.rowCount ? "validated" : "draft",
      );
      if (version.state === "retired") version.version = historical!.version;
      return version;
    });
  }
  private credentialVersions(payload: ConfigPayload): string[] {
    return secretBindings(payload)
      .map((b) => `${b.secretRef}:${b.secretVersion}`)
      .sort();
  }
  private async runChecks(
    payload: ConfigPayload,
    level: TestLevel,
  ): Promise<{
    state: TestResult["state"];
    checks: string[];
    errorCode?: string;
  }> {
    let state: TestResult["state"] = "passed",
      checks: string[] = ["schema", "dependencies", "secret_versions"],
      errorCode: string | undefined;
    if (level === "storage_roundtrip" && payload.kind === "storage") {
      if (!this.options.storageProbe)
        fail("CONFIG_INTEGRATION_UNCONFIGURED", 503);
      const key = `config-tests/${id()}`,
        bytes = randomBytes(32),
        probe = this.options.storageProbe;
      let attempted = false;
      try {
        attempted = true;
        await probe.put(key, bytes);
        checks = ["dns", "object_put"];
        const got = await probe.get(key);
        checks.push("object_get");
        if (digest(got) !== digest(bytes)) throw Error("HASH_MISMATCH");
        checks.push("object_hash");
      } catch {
        state = "failed";
        errorCode = "CONFIG_STORAGE_TEST_FAILED";
      } finally {
        if (attempted)
          try {
            await probe.delete(key);
            checks.push("object_delete");
          } catch {
            state = "cleanup_required";
            errorCode = "CONFIG_TEST_CLEANUP_REQUIRED";
          }
        bytes.fill(0);
      }
    } else if (level !== "schema") {
      const integration = this.options.integrations?.[payload.kind];
      if (!integration) fail("CONFIG_INTEGRATION_UNCONFIGURED", 503);
      try {
        const result = await integration.test(
          payload,
          level,
          async (binding) => {
            if (
              !secretBindings(payload).some(
                (b) =>
                  b.secretRef === binding.secretRef &&
                  b.secretVersion === binding.secretVersion,
              )
            )
              fail("SECRET_UNAVAILABLE", 403);
            const vault = await this.vaultBinding(binding);
            if (
              await this.secrets.isRevoked(vault.secretRef, vault.secretVersion)
            )
              fail("SECRET_REVOKED", 409);
            return this.secrets.read(vault.secretRef, vault.secretVersion);
          },
        );
        const allow = [
          "dns",
          "authentication",
          "contract",
          "capability",
          "inference",
          "object_put",
          "object_get",
          "object_hash",
          "object_delete",
        ];
        checks = [
          ...new Set(
            result.verifiedChecks.filter((check) => allow.includes(check)),
          ),
        ];
        state = result.state;
        if (
          !checks.length ||
          (level === "connection" &&
            !["dns", "authentication", "contract"].every((check) =>
              checks.includes(check),
            )) ||
          (level === "capability" && !checks.includes("capability"))
        ) {
          state = "failed";
          errorCode = "CONFIG_TEST_INCOMPLETE";
        }
      } catch {
        state = "failed";
        checks = [];
        errorCode = "CONFIG_INTEGRATION_TEST_FAILED";
      }
    }
    return { state, checks, ...(errorCode ? { errorCode } : {}) };
  }
  async testConfigDraft(
    actor: Actor,
    draftId: string,
    level: TestLevel,
  ): Promise<TestResult> {
    if (!levels.includes(level)) fail("CONFIG_TEST_LEVEL_INVALID", 422);
    // Paid inference needs a separate budgeted executor; never charge by merely asking for a test.
    if (level === "sample") fail("CONFIG_PAID_TEST_CONFIRMATION_REQUIRED", 422);
    const draft = await this.db.transaction(async (tx) => {
      const draft = await this.draft(tx, draftId);
      await this.authorize(tx, actor, draft.namespace);
      this.validate(draft.namespace, draft.body);
      await this.validateSecrets(tx, draft.body);
      await this.dependencies(
        tx,
        draft.body,
        (await this.active(tx))?.manifest.versions ?? {},
      );
      return draft;
    });
    await this.preflight([draft.body]);
    const started = Date.now();
    const { state, checks, errorCode } = await this.runChecks(
      draft.body,
      level,
    );
    return this.db.transaction(async (tx) => {
      const current = await this.draft(tx, draftId, true);
      await this.authorize(tx, actor, current.namespace);
      if (
        current.body_hash !== draft.body_hash ||
        current.revision !== draft.revision
      )
        fail("CONFIG_TEST_STALE", 409);
      await this.validateSecrets(tx, current.body);
      const at = await this.clock(tx),
        testId = id();
      const result: TestResult = {
        id: testId,
        draftId,
        configHash: draft.body_hash,
        credentialVersionIds: this.credentialVersions(draft.body),
        level,
        state,
        verifiedChecks: checks,
        createdAt: at.toISOString(),
        expiresAt: new Date(at.getTime() + 300_000).toISOString(),
        durationMs: Math.max(0, Date.now() - started),
        ...(errorCode ? { errorCode } : {}),
      };
      await tx.query(
        "INSERT INTO config_tests(id,created_at,environment,draft_id,subject_kind,subject_id,subject_hash,test_kind,state,report,executed_by) VALUES($1,$2,$3,$4,$5,$4,$6,$7,$8,$9,$10)",
        [
          testId,
          at,
          this.options.environment,
          draftId,
          draft.namespace,
          draft.body_hash,
          level,
          state,
          result,
          actor.userId,
        ],
      );
      await audit(
        tx,
        actor,
        this.request,
        "config.test",
        "config_test",
        testId,
        "Run configuration validation",
        {
          environment: this.options.environment,
          configHash: draft.body_hash,
          level,
          state,
        },
      );
      return result;
    });
  }
  private async validateTests(
    tx: PoolClient,
    drafts: DraftRow[],
    testIds: string[],
  ) {
    const at = await this.clock(tx);
    const results = (
      await tx.query(
        "SELECT * FROM config_tests WHERE id=ANY($1::text[]) AND environment=$2",
        [testIds, this.options.environment],
      )
    ).rows;
    if (results.length !== new Set(testIds).size)
      fail("CONFIG_TEST_REQUIRED", 409);
    for (const draft of drafts) {
      const tests = results.filter((t) => t.draft_id === draft.id);
      for (const test of tests) {
        if (
          at.getTime() >= new Date(test.created_at).getTime() + 300_000 ||
          at.getTime() < new Date(test.created_at).getTime()
        )
          fail("CONFIG_TEST_EXPIRED", 409);
        if (
          test.subject_hash !== draft.body_hash ||
          payloadHash(test.report.credentialVersionIds) !==
            payloadHash(this.credentialVersions(draft.body))
        )
          fail("CONFIG_TEST_STALE", 409);
        if (test.state !== "passed") fail("CONFIG_TEST_FAILED", 409);
      }
      for (const level of requiredTests(draft.body))
        if (!tests.some((test) => test.test_kind === level))
          fail("CONFIG_TEST_REQUIRED", 409);
    }
    if (
      results.some(
        (test) => !drafts.some((draft) => draft.id === test.draft_id),
      )
    )
      fail("CONFIG_TEST_STALE", 409);
  }
  async publishConfig(
    actor: Actor,
    versionIds: string[],
    testIds: string[],
    reason: string,
    expectedCurrentRelease: string | null,
  ): Promise<ConfigRelease> {
    requireReason(reason);
    if (
      !versionIds.length ||
      new Set(versionIds).size !== versionIds.length ||
      versionIds.length > Object.keys(CONFIG_REGISTRY).length
    )
      fail("CONFIG_INVALID", 422);
    const scope = `config:publish:${this.options.environment}:${actor.userId}`;
    const hash = payloadHash({
      versionIds: [...versionIds].sort(),
      testIds: [...testIds].sort(),
      reason,
      expectedCurrentRelease,
    });
    const input = await this.db.transaction(async (tx) => {
      const drafts = [];
      for (const draftId of [...versionIds].sort()) {
        const row = await this.draft(tx, draftId);
        await this.authorize(tx, actor, row.namespace);
        drafts.push(row);
      }
      return {
        drafts,
        active: await this.active(tx),
        replay: await this.replay(tx, scope, hash),
      };
    });
    if (input.replay) return deepFreeze(input.replay);
    const candidates = input.drafts;
    const allPayloads = new Map(
      Object.values(input.active?.manifest.versions ?? {}).map((version) => [
        version.namespace,
        version.payload,
      ]),
    );
    for (const draft of candidates)
      allPayloads.set(draft.namespace, draft.body);
    await this.preflight([...allPayloads.values()]);
    return this.db.transaction(async (tx) => {
      // Replays are authorized using current roles, but do not need a second step-up proof.
      for (const row of candidates)
        await this.authorize(tx, actor, row.namespace);
      const work = async () => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `config:publish:${this.options.environment}`,
        ]);
        const active = await this.active(tx);
        if ((active?.id ?? null) !== expectedCurrentRelease)
          fail("CONFIG_RELEASE_CONFLICT", 409);
        await this.stepUp(tx, actor);
        const drafts: DraftRow[] = [];
        for (const candidate of candidates) {
          const draft = await this.draft(tx, candidate.id, true);
          if (
            draft.body_hash !== candidate.body_hash ||
            draft.revision !== candidate.revision
          )
            fail("CONFIG_TEST_STALE", 409);
          if (await this.publishedDraft(tx, draft))
            fail("CONFIG_PUBLISHED_IMMUTABLE", 409);
          drafts.push(draft);
        }
        await this.validateTests(tx, drafts, testIds);
        const versions = { ...active?.manifest.versions },
          sources = { ...active?.manifest.sourceDrafts };
        for (const draft of drafts) {
          this.validate(draft.namespace, draft.body);
          versions[draft.namespace] = {
            ...this.version(draft, active),
            id: id(),
            state: "published",
          };
          sources[draft.namespace] = {
            id: draft.id,
            revision: Number(draft.revision),
          };
        }
        // Validate the complete carried-forward set, not just edited namespaces.
        for (const version of Object.values(versions)) {
          this.validate(version.namespace, version.payload);
          await this.validateSecrets(tx, version.payload);
          await this.dependencies(tx, version.payload, versions);
        }
        return this.insertRelease(
          tx,
          actor,
          versions,
          sources,
          active?.id ?? null,
          reason,
          "config.publish",
        );
      };
      const result = this.request.idempotencyKey
        ? await runIdempotent(
            tx,
            scope,
            this.request.idempotencyKey,
            hash,
            work,
          )
        : await work();
      return deepFreeze(result);
    });
  }
  private async insertRelease(
    tx: PoolClient,
    actor: Actor,
    versions: Record<string, ConfigVersion>,
    sourceDrafts: Record<string, SourceDraft>,
    previousReleaseId: string | null,
    reason: string,
    action: string,
  ): Promise<ConfigRelease> {
    const releaseId = id(),
      at = await this.clock(tx);
    const number = Number(
      (
        await tx.query(
          "SELECT coalesce(max(release_number),0)+1 AS next FROM config_releases WHERE environment=$1",
          [this.options.environment],
        )
      ).rows[0].next,
    );
    const manifest: Manifest = {
      versions,
      sourceDrafts,
      reason,
      previousReleaseId,
    };
    await tx.query(
      "INSERT INTO config_releases(id,created_at,environment,release_number,schema_version,manifest_hash,manifest,published_by,previous_release_id) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)",
      [
        releaseId,
        at,
        this.options.environment,
        number,
        payloadHash(manifest),
        manifest,
        actor.userId,
        previousReleaseId,
      ],
    );
    for (const [namespace, version] of Object.entries(versions))
      await tx.query(
        "INSERT INTO config_release_items(id,release_id,namespace,schema_version,body_hash,body) VALUES($1,$2,$3,1,$4,$5)",
        [id(), releaseId, namespace, version.payloadHash, version.payload],
      );
    if (previousReleaseId) {
      const changed = await tx.query(
        "UPDATE config_active_releases SET release_id=$3,revision=revision+1 WHERE environment=$1 AND release_id=$2 RETURNING id",
        [this.options.environment, previousReleaseId, releaseId],
      );
      if (!changed.rowCount) fail("CONFIG_RELEASE_CONFLICT", 409);
    } else
      await tx.query(
        "INSERT INTO config_active_releases(id,environment,release_id) VALUES($1,$2,$3)",
        [id(), this.options.environment, releaseId],
      );
    await audit(
      tx,
      actor,
      this.request,
      action,
      "config_release",
      releaseId,
      reason,
      {
        environment: this.options.environment,
        manifestHash: payloadHash(manifest),
        previousReleaseId,
      },
    );
    return deepFreeze({
      releaseId,
      versions,
      versionIds: Object.values(versions).map((v) => v.id),
      effectiveAt: at.toISOString(),
    });
  }
  async rollbackConfig(
    actor: Actor,
    releaseId: string,
    expectedCurrentRelease: string,
    reason: string,
  ): Promise<ConfigRelease> {
    requireReason(reason);
    const source = await this.loadRelease(releaseId);
    const scope = `config:rollback:${this.options.environment}:${actor.userId}`,
      hash = payloadHash({ releaseId, expectedCurrentRelease, reason });
    const replay = await this.db.transaction(async (tx) => {
      for (const namespace of Object.keys(source.versions))
        await this.authorize(tx, actor, namespace);
      return this.replay(tx, scope, hash);
    });
    if (replay) return deepFreeze(replay);
    await this.preflight(Object.values(source.versions).map((v) => v.payload));
    // Re-run functional tests outside the publication lock, rather than reviving an old test result.
    const validationStarted = this.options.now?.().getTime() ?? Date.now();
    const checks: Record<
      string,
      { level: TestLevel; verifiedChecks: string[] }[]
    > = {};
    for (const version of Object.values(source.versions)) {
      checks[version.namespace] = [];
      for (const level of requiredTests(version.payload)) {
        const result = await this.runChecks(version.payload, level);
        if (result.state !== "passed") fail("CONFIG_TEST_FAILED", 409);
        checks[version.namespace].push({
          level,
          verifiedChecks: result.checks,
        });
      }
    }
    return this.db.transaction(async (tx) => {
      for (const namespace of Object.keys(source.versions))
        await this.authorize(tx, actor, namespace);
      const work = async () => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `config:publish:${this.options.environment}`,
        ]);
        const active = await this.active(tx);
        if (active?.id !== expectedCurrentRelease)
          fail("CONFIG_RELEASE_CONFLICT", 409);
        await this.stepUp(tx, actor);
        if ((await this.clock(tx)).getTime() - validationStarted >= 300_000)
          fail("CONFIG_TEST_EXPIRED", 409);
        const versions: Record<string, ConfigVersion> = {},
          sources = {};
        for (const old of Object.values(source.versions))
          versions[old.namespace] = {
            ...old,
            id: id(),
            version:
              (active.manifest.versions[old.namespace]?.version ?? 0) + 1,
            state: "published",
          };
        for (const version of Object.values(versions)) {
          this.validate(version.namespace, version.payload);
          await this.validateSecrets(tx, version.payload);
          await this.dependencies(tx, version.payload, versions);
          for (const check of checks[version.namespace]) {
            const testId = id(),
              at = await this.clock(tx);
            await tx.query(
              "INSERT INTO config_tests(id,created_at,environment,release_id,subject_kind,subject_id,subject_hash,test_kind,state,report,executed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'passed',$9,$10)",
              [
                testId,
                at,
                this.options.environment,
                releaseId,
                version.namespace,
                version.id,
                version.payloadHash,
                check.level,
                {
                  credentialVersionIds: this.credentialVersions(
                    version.payload,
                  ),
                  verifiedChecks: check.verifiedChecks,
                  sourceReleaseId: releaseId,
                },
                actor.userId,
              ],
            );
          }
        }
        return this.insertRelease(
          tx,
          actor,
          versions,
          sources,
          active.id,
          reason,
          "config.rollback",
        );
      };
      return this.request.idempotencyKey
        ? runIdempotent(tx, scope, this.request.idempotencyKey, hash, work)
        : work();
    });
  }
  async loadRelease(releaseId?: string): Promise<Readonly<ConfigRelease>> {
    return this.db.transaction(async (tx) => {
      const row = releaseId
        ? ((
            await tx.query(
              "SELECT * FROM config_releases WHERE id=$1 AND environment=$2",
              [releaseId, this.options.environment],
            )
          ).rows[0] as ReleaseRow | undefined)
        : await this.active(tx);
      if (!row) fail("CONFIG_UNCONFIGURED", 503);
      const manifest = row.manifest;
      if (payloadHash(manifest) !== row.manifest_hash || !manifest.versions)
        fail("CONFIG_RELEASE_CORRUPT", 503);
      const items = (
        await tx.query(
          "SELECT * FROM config_release_items WHERE release_id=$1 ORDER BY namespace",
          [row.id],
        )
      ).rows;
      if (items.length !== Object.keys(manifest.versions).length)
        fail("CONFIG_RELEASE_CORRUPT", 503);
      for (const item of items) {
        const version = manifest.versions[item.namespace];
        if (
          !version ||
          version.namespace !== item.namespace ||
          version.environment !== this.options.environment ||
          version.payloadHash !== item.body_hash ||
          payloadHash(item.body) !== item.body_hash ||
          payloadHash(version.payload) !== item.body_hash
        )
          fail("CONFIG_RELEASE_CORRUPT", 503);
        this.validate(item.namespace, item.body);
      }
      return deepFreeze({
        releaseId: row.id,
        versionIds: Object.values(manifest.versions).map((v) => v.id),
        versions: manifest.versions,
        effectiveAt: new Date(row.created_at).toISOString(),
      });
    });
  }
  async emergencyDisable(
    actor: Actor,
    capability: CapabilityName,
    disabled: boolean,
    reason: string,
  ) {
    if (!names.includes(capability) || typeof disabled !== "boolean")
      fail("CONFIG_INVALID", 422);
    requireReason(reason);
    return this.db.transaction(async (tx) => {
      await requireRoles(tx, this.auth, actor, ["platform_ops"]);
      const work = async () => {
        await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
          `config:emergency:${this.options.environment}:${capability}`,
        ]);
        await this.stepUp(tx, actor, "admin_operations");
        await audit(
          tx,
          actor,
          this.request,
          "config.emergency",
          "capability",
          capability,
          reason,
          { environment: this.options.environment, capability, disabled },
        );
      };
      return this.request.idempotencyKey
        ? runIdempotent(
            tx,
            `config:emergency:${this.options.environment}:${actor.userId}`,
            this.request.idempotencyKey,
            payloadHash({ capability, disabled, reason }),
            work,
          )
        : work();
    });
  }
  private async emergency() {
    return this.db.transaction(async (tx) => {
      const { rows } = await tx.query(
        "SELECT DISTINCT ON (target_id) target_id,redacted_details FROM audit_events WHERE action='config.emergency' AND redacted_details->>'environment'=$1 ORDER BY target_id,created_at DESC,id DESC",
        [this.options.environment],
      );
      return Object.fromEntries(
        rows.map((row) => [row.target_id, row.redacted_details.disabled]),
      ) as Partial<Record<CapabilityName, boolean>>;
    });
  }
  async assertNewRequestsAllowed(capability: CapabilityName): Promise<void> {
    if ((await this.emergency())[capability]) fail("CAPABILITY_DISABLED", 503);
  }
  assertExistingOperationAllowed(
    _capability: CapabilityName,
    operation: "query" | "finalize" | "safe_delete",
  ): void {
    if (!["query", "finalize", "safe_delete"].includes(operation))
      fail("FORBIDDEN", 403);
  }
  async capabilities() {
    let release: Readonly<ConfigRelease> | null = null;
    try {
      release = await this.loadRelease();
    } catch (error) {
      if (!(error instanceof Error) || error.message !== "CONFIG_UNCONFIGURED")
        throw error;
    }
    return publicCapabilities(
      release,
      this.options.readiness,
      await this.emergency(),
    );
  }
}
/** Atomic in-process replacement; failed loads never partially refresh a live snapshot. */
export class ReleaseCache {
  private current: Readonly<ConfigRelease> | null = null;
  constructor(
    private load: () => Promise<Readonly<ConfigRelease>>,
    private alert: (code: "CONFIG_REFRESH_FAILED") => void,
  ) {}
  get snapshot(): Readonly<ConfigRelease> {
    if (!this.current) fail("CONFIG_UNCONFIGURED", 503);
    return this.current;
  }
  async refresh(): Promise<Readonly<ConfigRelease>> {
    try {
      const next = await this.load();
      this.current = deepFreeze(next);
    } catch {
      try {
        this.alert("CONFIG_REFRESH_FAILED");
      } catch {
        /* Alert delivery cannot replace the usable snapshot. */
      }
    }
    return this.snapshot;
  }
}
