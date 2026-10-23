import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { components } from "../../../../packages/contracts/src/api";
import schema from "../../../../docs/release-v1.0/contracts/schemas/config.schema.json";
import { digest, fail } from "@album/server-core";
import type { PoolClient } from "pg";

/** Generated contract is the only payload model. */
export type ConfigPayload = components["schemas"]["config.schema_$defs-root"];
export type ConfigKind = ConfigPayload["kind"];
export type Environment = "dev" | "staging" | "prod";
export type ConfigVersion = {
  id: string;
  namespace: string;
  version: number;
  environment: Environment;
  payload: ConfigPayload;
  revision: number;
  state: "draft" | "validated" | "published" | "retired";
  payloadHash: string;
};
export type ConfigRelease = {
  releaseId: string;
  versionIds: string[];
  versions: Readonly<Record<string, ConfigVersion>>;
  effectiveAt: string;
};
export type SecretPort = {
  write(
    name: string,
    value: Uint8Array,
  ): Promise<{ secretRef: string; secretVersion: string }>;
  read(ref: string, version: string): Promise<Uint8Array>;
  isRevoked(ref: string, version: string): Promise<boolean>;
};
export type SecretBinding = { secretRef: string; secretVersion: string };
export type TestLevel =
  "schema" | "connection" | "capability" | "sample" | "storage_roundtrip";
export type PlatformRole = "platform_ops" | "finance" | "content";
export type DependencyRule = { field: string; target: string };
export type RegistryRule = {
  roles: readonly PlatformRole[];
  secretFields: readonly string[];
  secretPurposes: readonly string[];
  dependencies: readonly DependencyRule[];
  requiredTests: readonly TestLevel[];
  defaultState: "unconfigured";
  snapshotImpact: string;
  endpointFields: readonly string[];
};
function rule(
  roles: readonly PlatformRole[],
  snapshotImpact: string,
  options: Partial<RegistryRule> = {},
): RegistryRule {
  return Object.freeze({
    roles,
    secretFields: [],
    secretPurposes: [],
    dependencies: [],
    requiredTests: ["schema"] as readonly TestLevel[],
    defaultState: "unconfigured",
    endpointFields: [],
    snapshotImpact,
    ...options,
  });
}
const dependency = (field: string, target: string): DependencyRule => ({
  field,
  target,
});
/** No catch-all entry: adding a contract kind requires an explicit security policy. */
export const CONFIG_REGISTRY: Readonly<Record<ConfigKind, RegistryRule>> =
  Object.freeze({
    storage: rule(
      ["platform_ops"],
      "New writes use this profile; existing objects and pins keep their locators",
      {
        secretFields: ["credential"],
        secretPurposes: ["storage_read", "storage_write", "storage_cleanup"],
        dependencies: [
          dependency("retentionPolicyRef", "retention"),
          dependency("quotaPolicyRef", "workspace"),
        ],
        requiredTests: ["schema", "storage_roundtrip"],
        endpointFields: ["endpoint", "downloadDomain", "allowedOrigins[]"],
      },
    ),
    aiConnection: rule(
      ["platform_ops"],
      "Accepted generation keeps provider, credential and budget snapshots",
      {
        secretFields: ["credential"],
        secretPurposes: ["ai"],
        dependencies: [dependency("dataUsePolicyRef", "policy")],
        requiredTests: ["schema", "connection"],
        endpointFields: ["baseUrl"],
      },
    ),
    auth: rule(
      ["platform_ops"],
      "New logins use the published application configuration",
      {
        secretFields: ["webCredential", "miniCredential"],
        secretPurposes: ["wechat"],
        dependencies: [dependency("smsConnectionRef", "sms")],
        requiredTests: ["schema", "connection", "capability"],
        endpointFields: ["callbackOrigins[]"],
      },
    ),
    payment: rule(
      ["platform_ops"],
      "New payment attempts only; pending queries and refunds keep their original adapter",
      {
        secretFields: ["credential", "verificationKeyRef"],
        secretPurposes: ["payment"],
        dependencies: [
          dependency("platformCapabilityRef", "paymentCapability"),
        ],
        requiredTests: ["schema", "connection", "capability"],
        endpointFields: ["callbackUrl"],
      },
    ),
    sku: rule(
      ["finance"],
      "New orders freeze published price and entitlement; existing orders never change",
      { dependencies: [dependency("refundPolicyRef", "refundPolicy")] },
    ),
    editor: rule(
      ["content"],
      "New editing sessions use catalog versions; stored documents keep version references",
      {
        dependencies: [
          dependency("filterManifestVersion", "filterCatalog"),
          dependency("fontCatalogVersion", "fontCatalog"),
          dependency("templateCatalogVersion", "templateCatalog"),
        ],
      },
    ),
    layout: rule(
      ["platform_ops", "content"],
      "Accepted layout tasks retain their algorithm and scoring weights",
    ),
    export: rule(
      ["platform_ops"],
      "Accepted exports retain renderer budgets, DPI and retention policy",
    ),
    queue: rule(
      ["platform_ops"],
      "Only new leases use revised scheduling limits; terminal fences stay valid",
    ),
    content: rule(
      ["content"],
      "New requests freeze moderation, labels, consent and license policies",
      {
        dependencies: [
          dependency("moderationRouteRef", "aiRoute"),
          dependency("labelPolicyRef", "labelPolicy"),
          dependency("licensePolicyVersion", "licensePolicy"),
        ],
        endpointFields: ["allowedOrigins[]"],
      },
    ),
    share: rule(
      ["platform_ops"],
      "New shares use defaults; explicit revocation and old URL expiry are preserved",
    ),
    notification: rule(
      ["platform_ops"],
      "New notifications require consent and configured templates",
      {
        secretFields: ["credential"],
        secretPurposes: ["notify"],
        dependencies: [dependency("templateRefs[]", "notificationTemplate")],
      },
    ),
    retention: rule(
      ["platform_ops"],
      "Cleanup honors old pins, tombstones and legal retention before deleting",
    ),
    monitor: rule(
      ["platform_ops"],
      "New alerts use thresholds; historical procurement facts stay immutable",
    ),
    workspace: rule(
      ["platform_ops"],
      "New defaults never expand purchased entitlement or seat grants",
    ),
    account: rule(
      ["platform_ops"],
      "New account actions use policy versions; legal and deletion facts remain",
      {
        dependencies: [
          dependency("privacyPolicyVersion", "privacyPolicy"),
          dependency("termsVersion", "terms"),
        ],
      },
    ),
    site: rule(
      ["platform_ops"],
      "New sessions use public site flags and approved policy versions",
      {
        dependencies: [
          dependency("privacyPolicyVersion", "privacyPolicy"),
          dependency("termsVersion", "terms"),
        ],
        endpointFields: ["publicOrigin"],
      },
    ),
    upload: rule(
      ["platform_ops"],
      "New upload sessions freeze storage profile and source limits",
      { dependencies: [dependency("activeStorageProfileRef", "storage")] },
    ),
    aiRoute: rule(
      ["platform_ops"],
      "Fallback before acceptance only; accepted jobs retain route and model",
      {
        dependencies: [
          dependency("primaryModelRef", "aiModel"),
          dependency("fallbackModelRefs[]", "aiModel"),
        ],
        requiredTests: ["schema", "capability"],
      },
    ),
    aiPricing: rule(
      ["finance"],
      "New quotes freeze cost rules; accepted reservations and ledger never change",
      {
        dependencies: [
          dependency("modelRef", "aiModel"),
          dependency("presetRef", "aiPreset"),
        ],
      },
    ),
    albumDefaults: rule(
      ["content"],
      "New albums use these defaults; existing document dimensions stay unchanged",
      { dependencies: [dependency("templateRef", "template")] },
    ),
  });
export type DependencyPort = {
  assertAvailable(
    target: string,
    ref: { id: string; version: number },
    environment: Environment,
    tx: PoolClient,
  ): Promise<void>;
};
export type TestResult = {
  id: string;
  draftId: string;
  configHash: string;
  credentialVersionIds: string[];
  level: TestLevel;
  state: "passed" | "failed" | "cleanup_required";
  verifiedChecks: string[];
  expiresAt: string;
  createdAt: string;
  durationMs: number;
  errorCode?: string;
};
export type IntegrationTestResult = {
  state: "passed" | "failed" | "cleanup_required";
  verifiedChecks: string[];
};
export type ConfigIntegration = {
  test(
    payload: ConfigPayload,
    level: TestLevel,
    secret: (binding: SecretBinding) => Promise<Uint8Array>,
  ): Promise<IntegrationTestResult>;
  supports?(payload: ConfigPayload): boolean;
};
export type StorageProbeContext = {
  payload: Extract<ConfigPayload, { kind: "storage" }>;
  secret: (binding: SecretBinding) => Promise<Uint8Array>;
};
export type StorageProbe = {
  put(
    key: string,
    bytes: Uint8Array,
    context: StorageProbeContext,
  ): Promise<void>;
  get(key: string, context: StorageProbeContext): Promise<Uint8Array>;
  delete(key: string, context: StorageProbeContext): Promise<void>;
};
export type RequestContext = {
  reauthProof?: string;
  requestId?: string;
  idempotencyKey?: string;
};
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);
export function validateConfigPayload(
  namespace: string,
  payload: unknown,
  options: { schemaOnly?: boolean } = {},
): asserts payload is ConfigPayload {
  if (!validate(payload)) fail("CONFIG_INVALID", 422);
  const p = payload as ConfigPayload;
  if (p.kind !== namespace || !Object.hasOwn(CONFIG_REGISTRY, namespace))
    fail("CONFIG_NAMESPACE_MISMATCH", 422);
  if (options.schemaOnly) return;
  const invalid = () => fail("CONFIG_INVALID", 422);
  switch (p.kind) {
    case "editor":
      if (p.autosaveIdleMs > p.autosaveMaxMs) invalid();
      break;
    case "layout":
      if (
        p.minPhotosPerSpread > p.maxPhotosPerSpread ||
        Math.abs(Object.values(p.weights).reduce((a, b) => a + b, 0) - 1) > 1e-9
      )
        invalid();
      break;
    case "queue":
      if (
        p.heartbeatSeconds >= p.leaseSeconds ||
        p.maxWorkspaceConcurrency > p.maxGlobalConcurrency ||
        p.retryBackoffSeconds.length !== p.retryLimit ||
        p.maxAttemptsPerTask < p.retryLimit + 1
      )
        invalid();
      break;
    case "aiConnection":
      if (p.connectTimeoutMs > p.requestTimeoutMs) invalid();
      break;
    case "auth":
      if (p.smsEnabled && !p.smsConnectionRef) invalid();
      break;
    case "storage":
      if (
        (p.encryptionMode === "kms" && !p.kmsKeyRef) ||
        (p.cdnMode === "signed" && !p.downloadDomain) ||
        /%|\\|(^|\/)\.\.?($|\/)/.test(p.basePrefix)
      )
        invalid();
      break;
    case "notification":
      if (p.channels.some((c) => c !== "inApp") && !p.credential) invalid();
      break;
    case "upload":
      if (
        p.multipartEnabled &&
        (!p.multipartThresholdBytes ||
          !p.multipartPartBytes ||
          p.multipartPartBytes > p.maxFileBytes ||
          p.multipartThresholdBytes > p.maxFileBytes)
      )
        invalid();
      break;
    case "aiRoute":
      if (p.enabled && p.capability === "textSuggestion") invalid();
      break;
    case "site":
    case "account":
    case "sku":
    case "export":
    case "content":
    case "share":
    case "retention":
    case "monitor":
    case "workspace":
    case "aiPricing":
    case "payment":
    case "albumDefaults":
      break;
  }
}
export function fieldValues(payload: ConfigPayload, field: string): unknown[] {
  const array = field.endsWith("[]");
  const value = (payload as unknown as Record<string, unknown>)[
    array ? field.slice(0, -2) : field
  ];
  return value === undefined ? [] : array ? (value as unknown[]) : [value];
}
/** Canonical hashing survives JSONB key reordering and rejects non-JSON values. */
export function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value))
    return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object" && value)
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  fail("CONFIG_INVALID", 422);
}
export const payloadHash = (payload: unknown) => digest(canonical(payload));
export function deepFreeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
