import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { digest, id, type Actor } from "@album/server-core";
import { testDatabase } from "../../test/database";
import { AuthService } from "../auth/identity";
import { ReauthService } from "../auth/reauthentication";
import { ConfigService, ReleaseCache } from "./service";
import {
  CONFIG_REGISTRY,
  validateConfigPayload,
  type ConfigPayload,
  type ConfigRelease,
  type SecretPort,
} from "./types";
import { SecretService } from "./secrets";
import { publicCapabilities } from "./capabilities";
import { assertApprovedHttps, createNetworkPolicy } from "./network-policy";

const schema = JSON.parse(
  readFileSync(
    new URL(
      "../../../../docs/release-v1.0/contracts/schemas/config.schema.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
function example(s: any): any {
  if (s.$ref) return example(schema.$defs[s.$ref.split("/").at(-1)]);
  if ("const" in s) return s.const;
  if (s.enum) return s.enum[0];
  if (s.type === "object")
    return Object.fromEntries(
      s.required.map((key: string) => [key, example(s.properties[key])]),
    );
  if (s.type === "array")
    return Array.from({ length: s.minItems ?? 0 }, () => example(s.items));
  if (s.type === "integer" || s.type === "number") return s.minimum ?? 1;
  if (s.type === "boolean") return false;
  if (s.pattern === "^#[A-Fa-f0-9]{6}$") return "#ffffff";
  return s.pattern?.startsWith("^https://") || s.format === "uri"
    ? "https://provider.example"
    : "fixture";
}
const share = (): ConfigPayload => ({
  kind: "share",
  defaultPrivate: true,
  sharingEnabled: true,
  maxShareTtlSeconds: 3600,
  downloadTtlSeconds: 60,
  revokeMode: "shortLivedUrl",
  allowOriginalDownload: false,
});
const layout = (): ConfigPayload =>
  ({
    kind: "layout",
    algorithmVersion: "v1",
    candidateCount: 1,
    minPhotosPerSpread: 1,
    maxPhotosPerSpread: 10,
    selectionPolicy: "all",
    duplicatePolicy: "forbid",
    weights: {
      subject: 0.2,
      timeline: 0.2,
      whitespace: 0.2,
      variety: 0.2,
      color: 0.2,
    },
  }) as ConfigPayload;
const binding = { secretRef: "credential", secretVersion: "version1" };
const connection = (): ConfigPayload => ({
  ...example(schema.$defs.aiConnection),
  credential: binding,
  enabled: true,
  dailyBudgetFen: 1000,
});
const now = new Date("2026-10-23T12:00:00Z");

it("registers every authoritative root kind including albumDefaults with permissions, tests, dependencies and snapshot policy", () => {
  const kinds = schema.$defs.root.oneOf.map((r: any) =>
    r.$ref.split("/").at(-1),
  );
  expect(Object.keys(CONFIG_REGISTRY).sort()).toEqual(kinds.sort());
  for (const kind of kinds) {
    const rule = CONFIG_REGISTRY[kind as keyof typeof CONFIG_REGISTRY];
    expect(rule.roles.length).toBeGreaterThan(0);
    expect(rule.requiredTests).toContain("schema");
    expect(rule).toHaveProperty("secretFields");
    expect(rule).toHaveProperty("dependencies");
    expect(rule).toHaveProperty("snapshotImpact");
    expect(rule.defaultState).toBe("unconfigured");
    const value = example(schema.$defs[kind]);
    // Schema coverage is independent of the semantic checks exercised below.
    expect(() =>
      validateConfigPayload(kind, value, { schemaOnly: true }),
    ).not.toThrow();
    expect(() =>
      validateConfigPayload(kind, { ...value, apiKey: "never persist" }),
    ).toThrow("CONFIG_INVALID");
  }
});
it("rejects unsafe cross-field combinations and namespace mismatches", () => {
  const queue = {
    ...example(schema.$defs.queue),
    leaseSeconds: 30,
    heartbeatSeconds: 30,
    retryLimit: 3,
    retryBackoffSeconds: [10, 30, 90],
  };
  expect(() => validateConfigPayload("queue", queue)).toThrow("CONFIG_INVALID");
  expect(() => validateConfigPayload("share", layout())).toThrow(
    "CONFIG_NAMESPACE_MISMATCH",
  );
  const route = {
    ...example(schema.$defs.aiRoute),
    capability: "textSuggestion",
    enabled: true,
  };
  expect(() => validateConfigPayload("aiRoute", route)).toThrow(
    "CONFIG_INVALID",
  );
  expect(() =>
    validateConfigPayload("layout", {
      ...layout(),
      minPhotosPerSpread: 20,
      maxPhotosPerSpread: 1,
    }),
  ).toThrow("CONFIG_INVALID");
});
it("capabilities expose only public statuses and generic reasons; integrations default unconfigured", () => {
  const empty = publicCapabilities(null);
  expect(empty.cloudUpload.state).toBe("unconfigured");
  const snapshot = {
    releaseId: "release",
    effectiveAt: now.toISOString(),
    versionIds: ["v"],
    versions: {
      aiConnection: {
        id: "v",
        namespace: "aiConnection",
        environment: "dev",
        revision: 1,
        version: 1,
        state: "published",
        payloadHash: digest("x"),
        payload: connection(),
      },
    },
  } as ConfigRelease;
  const capabilities = publicCapabilities(snapshot);
  expect(capabilities.generation.state).toBe("unconfigured");
  expect(JSON.stringify(capabilities)).not.toMatch(
    /secretRef|secretVersion|provider\.example|bucket|credential/,
  );
});

describe("approved HTTPS policy", () => {
  it("rejects numeric loopback, metadata, credentials, non-HTTPS and unapproved hosts", async () => {
    for (const url of [
      "https://127.0.0.1/model",
      "https://[::1]/",
      "https://169.254.169.254/",
      "https://user:pass@provider.example/",
      "http://provider.example/",
      "https://provider.example.evil/",
    ]) {
      await expect(
        assertApprovedHttps(url, ["provider.example"]),
      ).rejects.toThrow("ENDPOINT_FORBIDDEN");
    }
  });
  it("rejects every private DNS answer including mixed public/private and mapped IPv6", async () => {
    for (const address of [
      "10.1.2.3",
      "172.16.2.3",
      "192.168.1.1",
      "100.100.100.200",
      "0.0.0.0",
      "198.18.0.1",
      "fc00::1",
      "fe80::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
    ]) {
      const policy = createNetworkPolicy({
        resolve: async () => [
          { address: "93.184.216.34", family: 4 },
          { address, family: address.includes(":") ? 6 : 4 },
        ],
      });
      await expect(
        policy.assertApprovedHttps("https://provider.example/", [
          "provider.example",
        ]),
      ).rejects.toThrow("ENDPOINT_FORBIDDEN");
    }
  });
  it("pins the verified DNS address into the TLS request lookup and retains hostname/SNI", async () => {
    let resolutions = 0;
    let requestOptions: any;
    const policy = createNetworkPolicy({
      resolve: async () => {
        resolutions++;
        return [{ address: "93.184.216.34", family: 4 }];
      },
      request: ((url: URL, options: any, callback: any) => {
        requestOptions = options;
        expect(url.hostname).toBe("provider.example");
        options.lookup(
          "provider.example",
          { all: false },
          (_: any, address: string, family: number) => {
            expect(address).toBe("93.184.216.34");
            expect(family).toBe(4);
          },
        );
        const req = new EventEmitter() as any;
        req.end = () => {
          const res = Readable.from([Buffer.from("ok")]) as any;
          res.statusCode = 200;
          res.headers = {};
          callback(res);
        };
        req.destroy = (e: Error) => req.emit("error", e);
        return req;
      }) as any,
    });
    expect(
      Buffer.from(
        await policy.fetchApprovedHttps(
          "https://provider.example/a",
          {},
          ["provider.example"],
          { maxBytes: 10, timeoutMs: 1000 },
        ),
      ).toString(),
    ).toBe("ok");
    expect(resolutions).toBe(1);
    expect(requestOptions.servername).toBe("provider.example");
    expect(requestOptions.rejectUnauthorized).toBe(true);
    expect(requestOptions.agent).toBe(false);
  });
  it("validates redirect destinations before opening a second request", async () => {
    let requests = 0;
    const policy = createNetworkPolicy({
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: ((_url: any, _opts: any, callback: any) => {
        requests++;
        const req = new EventEmitter() as any;
        req.end = () => {
          const res = Readable.from([]) as any;
          res.statusCode = 302;
          res.headers = { location: "https://127.0.0.1/private" };
          callback(res);
        };
        req.destroy = (e: Error) => req.emit("error", e);
        return req;
      }) as any,
    });
    await expect(
      policy.fetchApprovedHttps(
        "https://provider.example",
        {},
        ["provider.example"],
        { maxBytes: 10, timeoutMs: 1000 },
      ),
    ).rejects.toThrow("ENDPOINT_FORBIDDEN");
    expect(requests).toBe(1);
  });
  it("enforces byte limits on streaming responses", async () => {
    const policy = createNetworkPolicy({
      resolve: async () => [{ address: "93.184.216.34", family: 4 }],
      request: ((_url: any, _opts: any, callback: any) => {
        const req = new EventEmitter() as any;
        req.end = () => {
          const res = Readable.from([Buffer.alloc(11)]) as any;
          res.statusCode = 200;
          res.headers = {};
          callback(res);
        };
        req.destroy = (e: Error) => req.emit("error", e);
        return req;
      }) as any,
    });
    await expect(
      policy.fetchApprovedHttps(
        "https://provider.example",
        {},
        ["provider.example"],
        { maxBytes: 10, timeoutMs: 1000 },
      ),
    ).rejects.toThrow("ENDPOINT_RESPONSE_TOO_LARGE");
  });
});

// This suite deliberately fails without a disposable database; skipped SQL is not evidence.
describe("configuration transactions on PostgreSQL", () => {
  let db: Awaited<ReturnType<typeof testDatabase>>,
    auth: AuthService,
    reauth: ReauthService,
    service: ConfigService,
    ops: Actor;
  let milliseconds = now.getTime();
  const values = new Map<string, Uint8Array>();
  const revoked = new Set<string>();
  const secretPort: SecretPort = {
    async write(name, value) {
      const secretVersion = id();
      values.set(`${name}:${secretVersion}`, value.slice());
      return { secretRef: name, secretVersion };
    },
    async read(ref, version) {
      const value = values.get(`${ref}:${version}`);
      if (!value) throw Error("SECRET_UNCONFIGURED");
      return value.slice();
    },
    async isRevoked(ref, version) {
      return revoked.has(`${ref}:${version}`);
    },
  };
  beforeAll(async () => {
    if (!process.env.C3_TEST_DATABASE_URL)
      throw Error("C3_TEST_DATABASE_URL_REQUIRED");
    db = await testDatabase();
    auth = new AuthService(db.database, {
      secret: "local-test-signing-secret-at-least-32-characters",
      environment: "dev",
    });
    reauth = new ReauthService(db.database, auth, {});
  }, 60000);
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.pool.query(
      "TRUNCATE ai_album.config_drafts,ai_album.config_releases,ai_album.config_tests,ai_album.secret_references,ai_album.audit_events CASCADE",
    );
    milliseconds = now.getTime();
    values.clear();
    revoked.clear();
    const login = await auth.login(
      {
        exchange: async () => ({
          provider: "wechat",
          appId: "app",
          subject: id(),
          unionId: null,
          openPlatformId: null,
        }),
      },
      id(),
      "mini",
    );
    ops = {
      ...login.actor,
      platformPermissions: [
        "config:publish",
        "secrets:write",
        "operations:write",
      ],
    };
    await db.database.transaction((tx) =>
      tx.query(
        "INSERT INTO admin_role_assignments(id,user_id,role) VALUES($1,$2,'platform_ops')",
        [id(), ops.userId],
      ),
    );
    service = new ConfigService(db.database, auth, secretPort, {
      environment: "dev",
      now: () => new Date(milliseconds),
      reauth,
      dependencies: { assertAvailable: async () => undefined },
      allowedHosts: ["provider.example"],
      assertEndpoint: async () => undefined,
    });
  });
  async function proof(actor = ops, purpose = "admin_publish") {
    const token = id();
    await db.database.transaction((tx) =>
      tx.query(
        "INSERT INTO reauth_proofs(token_hash,user_id,session_id,purpose,expires_at) VALUES($1,$2,$3,$4,now()+interval '5 minutes')",
        [auth.hash(token), actor.userId, actor.sessionId, purpose],
      ),
    );
    return token;
  }
  async function publish(
    drafts: string[],
    tests: string[],
    current: string | null = null,
  ) {
    return service
      .withRequest({
        reauthProof: await proof(),
        requestId: id(),
        idempotencyKey: id(),
      })
      .publishConfig(ops, drafts, tests, "Approved rollout", current);
  }
  async function tested(payload: ConfigPayload = share()) {
    const draft = await service.createConfigDraft(
      ops,
      payload.kind,
      payload,
      null,
    );
    const test = await service.testConfigDraft(ops, draft.id, "schema");
    return { draft, test };
  }
  it("permits exactly one concurrent CAS write and leaves the original published payload immutable", async () => {
    const { draft, test } = await tested();
    const writes = await Promise.allSettled([
      service.updateConfigDraft(ops, draft.id, draft.revision, {
        ...share(),
        sharingEnabled: false,
      } as ConfigPayload),
      service.updateConfigDraft(ops, draft.id, draft.revision, {
        ...share(),
        maxShareTtlSeconds: 7200,
      } as ConfigPayload),
    ]);
    expect(writes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (writes.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.message,
    ).toBe("REVISION_CONFLICT");
    await expect(publish([draft.id], [test.id])).rejects.toThrow(
      "CONFIG_TEST_STALE",
    );
  });
  it("rejects a test older than five minutes and a fresh test bound to a different hash", async () => {
    const { draft, test } = await tested();
    milliseconds += 300_001;
    await expect(publish([draft.id], [test.id])).rejects.toThrow(
      "CONFIG_TEST_EXPIRED",
    );
    milliseconds = now.getTime();
    await service.updateConfigDraft(ops, draft.id, 1, {
      ...share(),
      sharingEnabled: false,
    } as ConfigPayload);
    await expect(publish([draft.id], [test.id])).rejects.toThrow(
      "CONFIG_TEST_STALE",
    );
  });
  it("requires live platform role, explicit publish permission, and a fresh session-bound proof", async () => {
    const { draft, test } = await tested();
    await expect(
      service.publishConfig(ops, [draft.id], [test.id], "no proof", null),
    ).rejects.toThrow("REAUTH_REQUIRED");
    const noPermission = { ...ops, platformPermissions: [] };
    await expect(
      service
        .withRequest({ reauthProof: await proof() })
        .publishConfig(
          noPermission,
          [draft.id],
          [test.id],
          "missing permission",
          null,
        ),
    ).rejects.toThrow("FORBIDDEN");
    await db.database.transaction((tx) =>
      tx.query(
        "UPDATE admin_role_assignments SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [ops.userId],
      ),
    );
    await expect(
      service.updateConfigDraft(ops, draft.id, 1, share()),
    ).rejects.toThrow("FORBIDDEN");
  });
  it("restricts finance to commercial configuration and content to content namespaces", async () => {
    await db.database.transaction((tx) =>
      tx.query(
        "UPDATE admin_role_assignments SET role='finance' WHERE user_id=$1",
        [ops.userId],
      ),
    );
    await expect(
      service.createConfigDraft(ops, "share", share(), null),
    ).rejects.toThrow("FORBIDDEN");
    await db.database.transaction((tx) =>
      tx.query(
        "UPDATE admin_role_assignments SET role='content' WHERE user_id=$1",
        [ops.userId],
      ),
    );
    const payload = example(schema.$defs.albumDefaults);
    expect(
      (await service.createConfigDraft(ops, "albumDefaults", payload, null))
        .namespace,
    ).toBe("albumDefaults");
  });
  it("publishes the whole manifest atomically; concurrent expected-current publishes have one winner and append one audit", async () => {
    const one = await tested();
    const other = await tested(layout());
    const [p1, p2] = await Promise.all([proof(), proof()]);
    const results = await Promise.allSettled(
      [p1, p2].map((token) =>
        service
          .withRequest({ reauthProof: token })
          .publishConfig(
            ops,
            [one.draft.id, other.draft.id],
            [one.test.id, other.test.id],
            "atomic publish",
            null,
          ),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(
      (results.find((r) => r.status === "rejected") as PromiseRejectedResult)
        .reason.message,
    ).toBe("CONFIG_RELEASE_CONFLICT");
    const release = await service.loadRelease();
    expect(Object.keys(release.versions).sort()).toEqual(["layout", "share"]);
    expect(
      (await db.pool.query("SELECT count(*) FROM ai_album.config_releases"))
        .rows[0].count,
    ).toBe("1");
    expect(
      (
        await db.pool.query(
          "SELECT count(*) FROM ai_album.audit_events WHERE action='config.publish'",
        )
      ).rows[0].count,
    ).toBe("1");
    expect(Object.isFrozen(release.versions.share.payload)).toBe(true);
    await expect(
      service.updateConfigDraft(ops, one.draft.id, 1, share()),
    ).rejects.toThrow("CONFIG_PUBLISHED_IMMUTABLE");
  });
  it("replays an idempotent publish without consuming another proof; changed payload conflicts", async () => {
    const { draft, test } = await tested();
    const request = service.withRequest({
      reauthProof: await proof(),
      idempotencyKey: "same-publication",
    });
    const first = await request.publishConfig(
      ops,
      [draft.id],
      [test.id],
      "rollout",
      null,
    );
    expect(
      await request.publishConfig(ops, [draft.id], [test.id], "rollout", null),
    ).toEqual(first);
    await expect(
      request.publishConfig(ops, [draft.id], [test.id], "changed", null),
    ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
  });
  it("carries unchanged namespaces forward and rejects stale base versions", async () => {
    const first = await tested();
    const initial = await publish([first.draft.id], [first.test.id]);
    const second = await tested(layout());
    const release = await publish(
      [second.draft.id],
      [second.test.id],
      initial.releaseId,
    );
    expect(release.versions.share).toEqual(initial.versions.share);
    await expect(
      service.createConfigDraft(ops, "share", share(), 999),
    ).rejects.toThrow("REVISION_CONFLICT");
    const next = await service.createConfigDraft(
      ops,
      "share",
      { ...share(), sharingEnabled: false } as ConfigPayload,
      1,
    );
    expect(next.state).toBe("draft");
    expect(
      (await service.loadRelease(initial.releaseId)).versions.share.payload,
    ).toEqual(share());
  });
  it("cannot publish a credential with a mismatched environment or purpose", async () => {
    await db.database.transaction((tx) =>
      tx.query(
        "INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose) VALUES($1,'staging',$2,$3,'ai')",
        [id(), binding.secretRef, binding.secretVersion],
      ),
    );
    await expect(
      service.createConfigDraft(ops, "aiConnection", connection(), null),
    ).rejects.toThrow("SECRET_UNAVAILABLE");
  });
  it("requires real functional tests and a matching immutable secret version", async () => {
    await seedSecret();
    const draft = await service.createConfigDraft(
      ops,
      "aiConnection",
      connection(),
      null,
    );
    const test = await service.testConfigDraft(ops, draft.id, "schema");
    await expect(publish([draft.id], [test.id])).rejects.toThrow(
      "CONFIG_TEST_REQUIRED",
    );
    await expect(
      service.testConfigDraft(ops, draft.id, "connection"),
    ).rejects.toThrow("CONFIG_INTEGRATION_UNCONFIGURED");
  });
  async function seedSecret() {
    await db.database.transaction((tx) =>
      tx.query(
        "INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose) VALUES($1,'dev',$2,$3,'ai')",
        [id(), binding.secretRef, binding.secretVersion],
      ),
    );
    values.set(
      `${binding.secretRef}:${binding.secretVersion}`,
      Buffer.from("do-not-leak"),
    );
  }
  it("rechecks carried-forward secret revocation before publishing an unrelated namespace", async () => {
    await seedSecret();
    const configured = service.withIntegrations({
      aiConnection: {
        test: async () => ({
          verifiedChecks: ["dns", "authentication", "contract"],
          state: "passed",
        }),
      },
    });
    const draft = await configured.createConfigDraft(
      ops,
      "aiConnection",
      connection(),
      null,
    );
    const schemaTest = await configured.testConfigDraft(
      ops,
      draft.id,
      "schema",
    );
    const functional = await configured.testConfigDraft(
      ops,
      draft.id,
      "connection",
    );
    const first = await configured
      .withRequest({ reauthProof: await proof() })
      .publishConfig(
        ops,
        [draft.id],
        [schemaTest.id, functional.id],
        "first",
        null,
      );
    const other = await tested();
    revoked.add(`${binding.secretRef}:${binding.secretVersion}`);
    await expect(
      configured
        .withRequest({ reauthProof: await proof() })
        .publishConfig(
          ops,
          [other.draft.id],
          [other.test.id],
          "unrelated change",
          first.releaseId,
        ),
    ).rejects.toThrow("SECRET_REVOKED");
    expect((await service.loadRelease()).releaseId).toBe(first.releaseId);
  });
  it("does not allow a rollback when revalidation became older than five minutes while waiting", async () => {
    await seedSecret();
    let ageDuringTest = false;
    const configured = service.withIntegrations({
      aiConnection: {
        test: async () => {
          if (ageDuringTest) milliseconds += 300_001;
          return {
            verifiedChecks: ["dns", "authentication", "contract"],
            state: "passed",
          };
        },
      },
    });
    const draft = await configured.createConfigDraft(
      ops,
      "aiConnection",
      connection(),
      null,
    );
    const schemaTest = await configured.testConfigDraft(
      ops,
      draft.id,
      "schema",
    );
    const functional = await configured.testConfigDraft(
      ops,
      draft.id,
      "connection",
    );
    const first = await configured
      .withRequest({ reauthProof: await proof() })
      .publishConfig(
        ops,
        [draft.id],
        [schemaTest.id, functional.id],
        "first",
        null,
      );
    ageDuringTest = true;
    await expect(
      configured
        .withRequest({ reauthProof: await proof() })
        .rollbackConfig(
          ops,
          first.releaseId,
          first.releaseId,
          "restore after slow test",
        ),
    ).rejects.toThrow("CONFIG_TEST_EXPIRED");
  });
  it("refuses unsupported multipart, KMS and CDN capability settings", async () => {
    const multipart = example(schema.$defs.upload);
    multipart.multipartEnabled = true;
    multipart.multipartThresholdBytes = 1;
    multipart.multipartPartBytes = 1;
    await expect(
      service.createConfigDraft(ops, "upload", multipart, null),
    ).rejects.toThrow("CONFIG_ADAPTER_CAPABILITY_UNSUPPORTED");
  });
  it("rollback rejects revoked old secrets and leaves the active release untouched", async () => {
    await seedSecret();
    const configured = service.withIntegrations({
      aiConnection: {
        test: async () => ({
          verifiedChecks: ["dns", "authentication", "contract"],
          state: "passed",
        }),
      },
    });
    const draft = await configured.createConfigDraft(
      ops,
      "aiConnection",
      connection(),
      null,
    );
    const schemaTest = await configured.testConfigDraft(
      ops,
      draft.id,
      "schema",
    );
    const functional = await configured.testConfigDraft(
      ops,
      draft.id,
      "connection",
    );
    const first = await configured
      .withRequest({ reauthProof: await proof() })
      .publishConfig(
        ops,
        [draft.id],
        [schemaTest.id, functional.id],
        "first",
        null,
      );
    revoked.add(`${binding.secretRef}:${binding.secretVersion}`);
    await expect(
      configured
        .withRequest({ reauthProof: await proof() })
        .rollbackConfig(ops, first.releaseId, first.releaseId, "restore"),
    ).rejects.toThrow("SECRET_REVOKED");
    expect((await service.loadRelease()).releaseId).toBe(first.releaseId);
  });
  it("rollback creates a new release after fresh revalidation and never changes old snapshots", async () => {
    const a = await tested();
    const first = await publish([a.draft.id], [a.test.id]);
    const draft = await service.createConfigDraft(
      ops,
      "share",
      { ...share(), sharingEnabled: false } as ConfigPayload,
      1,
    );
    const test = await service.testConfigDraft(ops, draft.id, "schema");
    const second = await publish([draft.id], [test.id], first.releaseId);
    const restored = await service
      .withRequest({ reauthProof: await proof() })
      .rollbackConfig(
        ops,
        first.releaseId,
        second.releaseId,
        "restore reviewed version",
      );
    expect(restored.releaseId).not.toBe(first.releaseId);
    expect(restored.versions.share.payload).toEqual(share());
    expect(
      (await service.loadRelease(second.releaseId)).versions.share.payload,
    ).toHaveProperty("sharingEnabled", false);
  });
  it("can open a new draft after rollback and never edits a historically published draft revision", async () => {
    const a = await tested();
    const first = await publish([a.draft.id], [a.test.id]);
    const draft = await service.createConfigDraft(
      ops,
      "share",
      { ...share(), sharingEnabled: false } as ConfigPayload,
      1,
    );
    const test = await service.testConfigDraft(ops, draft.id, "schema");
    const second = await publish([draft.id], [test.id], first.releaseId);
    const restored = await service
      .withRequest({ reauthProof: await proof() })
      .rollbackConfig(
        ops,
        first.releaseId,
        second.releaseId,
        "restore reviewed version",
      );
    await expect(
      service.updateConfigDraft(ops, draft.id, draft.revision, share()),
    ).rejects.toThrow("CONFIG_PUBLISHED_IMMUTABLE");
    expect((await service.getConfigDraft(ops, draft.id)).state).toBe("retired");
    expect(
      (
        await service.createConfigDraft(
          ops,
          "share",
          share(),
          restored.versions.share.version,
        )
      ).state,
    ).toBe("draft");
  });
  it("keeps publication replay stable even when its retired secret is later revoked", async () => {
    await seedSecret();
    const configured = service.withIntegrations({
      aiConnection: {
        test: async () => ({
          verifiedChecks: ["dns", "authentication", "contract"],
          state: "passed",
        }),
      },
    });
    const draft = await configured.createConfigDraft(
      ops,
      "aiConnection",
      connection(),
      null,
    );
    const a = await configured.testConfigDraft(ops, draft.id, "schema"),
      b = await configured.testConfigDraft(ops, draft.id, "connection");
    const request = configured.withRequest({
      reauthProof: await proof(),
      idempotencyKey: "stable-publication",
    });
    const first = await request.publishConfig(
      ops,
      [draft.id],
      [a.id, b.id],
      "stable result",
      null,
    );
    revoked.add(`${binding.secretRef}:${binding.secretVersion}`);
    expect(
      await request.publishConfig(
        ops,
        [draft.id],
        [a.id, b.id],
        "stable result",
        null,
      ),
    ).toEqual(first);
  });
  it("checks external revocation for a verification key stored as a secret-reference id", async () => {
    const payload = example(schema.$defs.payment);
    payload.credential = binding;
    payload.verificationKeyRef = "verify_ref";
    await db.database.transaction(async (tx) => {
      await tx.query(
        "INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose) VALUES($1,'dev',$2,$3,'payment')",
        [id(), binding.secretRef, binding.secretVersion],
      );
      await tx.query(
        "INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose) VALUES('verify_ref','dev','verify_key','v1','payment')",
      );
    });
    revoked.add("verify_key:v1");
    await expect(
      service.createConfigDraft(ops, "payment", payload, null),
    ).rejects.toThrow("SECRET_REVOKED");
  });
  it("rejects unresolved dependencies without claiming integration readiness", async () => {
    await db.database.transaction((tx) =>
      tx.query(
        "UPDATE admin_role_assignments SET role='content' WHERE user_id=$1",
        [ops.userId],
      ),
    );
    const strict = new ConfigService(db.database, auth, secretPort, {
      environment: "dev",
      reauth,
    });
    const draft = await strict.createConfigDraft(
      ops,
      "albumDefaults",
      example(schema.$defs.albumDefaults),
      null,
    );
    await expect(
      strict.testConfigDraft(ops, draft.id, "schema"),
    ).rejects.toThrow("CONFIG_DEPENDENCY_UNAVAILABLE");
  });
  it("records storage round-trip hash verification and warns when deleting only its new test object fails", async () => {
    const payload = example(schema.$defs.storage);
    payload.credential = binding;
    await db.database.transaction((tx) =>
      tx.query(
        "INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose) VALUES($1,'dev',$2,$3,'storage_write')",
        [id(), binding.secretRef, binding.secretVersion],
      ),
    );
    const objects = new Map<string, Uint8Array>([
      ["existing-object", Buffer.from("keep")],
    ]);
    const removed: string[] = [];
    const configured = service.withStorageProbe({
      async put(key, bytes) {
        objects.set(key, bytes);
      },
      async get(key) {
        return objects.get(key)!;
      },
      async delete(key) {
        removed.push(key);
        throw Error("raw provider error do-not-leak");
      },
    });
    const draft = await configured.createConfigDraft(
      ops,
      "storage",
      payload,
      null,
    );
    const result = await configured.testConfigDraft(
      ops,
      draft.id,
      "storage_roundtrip",
    );
    expect(result.state).toBe("cleanup_required");
    expect(result.verifiedChecks).toContain("object_hash");
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/^config-tests\//);
    expect(objects.has("existing-object")).toBe(true);
    expect(JSON.stringify(result)).not.toContain("do-not-leak");
    const schemaTest = await configured.testConfigDraft(
      ops,
      draft.id,
      "schema",
    );
    await expect(
      configured
        .withRequest({ reauthProof: await proof() })
        .publishConfig(
          ops,
          [draft.id],
          [schemaTest.id, result.id],
          "blocked cleanup",
          null,
        ),
    ).rejects.toThrow("CONFIG_TEST_FAILED");
  });
  it("rollback requires the same complete functional checks as a new publication", async () => {
    await seedSecret();
    let incomplete = false;
    const configured = service.withIntegrations({
      aiConnection: {
        test: async () => ({
          verifiedChecks: incomplete
            ? ["dns"]
            : ["dns", "authentication", "contract"],
          state: "passed",
        }),
      },
    });
    const draft = await configured.createConfigDraft(
      ops,
      "aiConnection",
      connection(),
      null,
    );
    const a = await configured.testConfigDraft(ops, draft.id, "schema"),
      b = await configured.testConfigDraft(ops, draft.id, "connection");
    const first = await configured
      .withRequest({ reauthProof: await proof() })
      .publishConfig(ops, [draft.id], [a.id, b.id], "first", null);
    incomplete = true;
    await expect(
      configured
        .withRequest({ reauthProof: await proof() })
        .rollbackConfig(
          ops,
          first.releaseId,
          first.releaseId,
          "incomplete retest",
        ),
    ).rejects.toThrow("CONFIG_TEST_FAILED");
  });
  it("storage rollback performs a new isolated PUT/GET/hash/DELETE test", async () => {
    const payload = example(schema.$defs.storage);
    payload.credential = binding;
    await db.database.transaction((tx) =>
      tx.query(
        "INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose) VALUES($1,'dev',$2,$3,'storage_write')",
        [id(), binding.secretRef, binding.secretVersion],
      ),
    );
    const objects = new Map<string, Uint8Array>();
    let putCount = 0;
    const configured = service.withStorageProbe({
      async put(key, bytes) {
        putCount++;
        objects.set(key, bytes.slice());
      },
      async get(key) {
        return objects.get(key)!;
      },
      async delete(key) {
        objects.delete(key);
      },
    });
    const draft = await configured.createConfigDraft(
      ops,
      "storage",
      payload,
      null,
    );
    const a = await configured.testConfigDraft(ops, draft.id, "schema"),
      b = await configured.testConfigDraft(ops, draft.id, "storage_roundtrip");
    const first = await configured
      .withRequest({ reauthProof: await proof() })
      .publishConfig(ops, [draft.id], [a.id, b.id], "first", null);
    const second = await configured
      .withRequest({ reauthProof: await proof() })
      .rollbackConfig(ops, first.releaseId, first.releaseId, "tested rollback");
    expect(second.releaseId).not.toBe(first.releaseId);
    expect(putCount).toBe(2);
    expect(objects.size).toBe(0);
    const tests = await db.pool.query(
      "SELECT test_kind,report FROM ai_album.config_tests WHERE release_id=$1",
      [first.releaseId],
    );
    expect(
      tests.rows.some(
        (row) =>
          row.test_kind === "storage_roundtrip" &&
          row.report.verifiedChecks.includes("object_delete"),
      ),
    ).toBe(true);
  });
  it("storage roundtrip detects corrupted reads and deletes only its own new object", async () => {
    const payload = example(schema.$defs.storage);
    payload.credential = binding;
    await db.database.transaction((tx) =>
      tx.query(
        "INSERT INTO secret_references(id,environment,secret_ref,secret_version,purpose) VALUES($1,'dev',$2,$3,'storage_write')",
        [id(), binding.secretRef, binding.secretVersion],
      ),
    );
    const removed: string[] = [];
    const configured = service.withStorageProbe({
      async put() {},
      async get() {
        return Buffer.from("corrupted");
      },
      async delete(key) {
        removed.push(key);
      },
    });
    const draft = await configured.createConfigDraft(
      ops,
      "storage",
      payload,
      null,
    );
    const result = await configured.testConfigDraft(
      ops,
      draft.id,
      "storage_roundtrip",
    );
    expect(result.state).toBe("failed");
    expect(result.verifiedChecks).not.toContain("object_hash");
    expect(removed).toHaveLength(1);
  });
  it("replays an emergency secret revocation without needing a second step-up proof", async () => {
    await seedSecret();
    const reference = (
      await db.pool.query(
        "SELECT id FROM ai_album.secret_references WHERE secret_ref=$1",
        [binding.secretRef],
      )
    ).rows[0].id;
    const secrets = new SecretService(db.database, auth, secretPort, {
      environment: "dev",
      reauth,
    }).withRequest({
      reauthProof: await proof(ops, "admin_secret"),
      idempotencyKey: "one-revoke",
    });
    const first = await secrets.revokeSecret(
      ops,
      reference,
      true,
      "emergency revoke",
    );
    expect(
      await secrets.revokeSecret(ops, reference, true, "emergency revoke"),
    ).toEqual(first);
  });
  it("normal secret revocation also protects bindings still used by the active release", async () => {
    await seedSecret();
    const configured = service.withIntegrations({
      aiConnection: {
        test: async () => ({
          verifiedChecks: ["dns", "authentication", "contract"],
          state: "passed",
        }),
      },
    });
    const draft = await configured.createConfigDraft(
      ops,
      "aiConnection",
      connection(),
      null,
    );
    const a = await configured.testConfigDraft(ops, draft.id, "schema"),
      b = await configured.testConfigDraft(ops, draft.id, "connection");
    await configured
      .withRequest({ reauthProof: await proof() })
      .publishConfig(ops, [draft.id], [a.id, b.id], "first", null);
    const reference = (
      await db.pool.query(
        "SELECT id FROM ai_album.secret_references WHERE secret_ref=$1",
        [binding.secretRef],
      )
    ).rows[0].id;
    const secrets = new SecretService(db.database, auth, secretPort, {
      environment: "dev",
      reauth,
      assertNotInUse: async () => undefined,
    });
    await expect(
      secrets
        .withRequest({ reauthProof: await proof(ops, "admin_secret") })
        .revokeSecret(ops, reference, false, "must rotate active config first"),
    ).rejects.toThrow("SECRET_IN_USE");
  });
  it("resolves a masked metadata reference to the vault binding only inside the trusted test executor", async () => {
    const secrets = new SecretService(db.database, auth, secretPort, {
      environment: "dev",
      reauth,
    });
    const metadata = await secrets
      .withRequest({ reauthProof: await proof(ops, "admin_secret") })
      .writeSecret(
        ops,
        "ai",
        Buffer.from("secret-selected-from-mask"),
        "create",
      );
    const payload = {
      ...connection(),
      credential: { secretRef: metadata.id, secretVersion: metadata.versionId },
    } as ConfigPayload;
    const configured = service.withIntegrations({
      aiConnection: {
        test: async (p, _level, read) => {
          if (p.kind !== "aiConnection") throw Error("wrong kind");
          expect(Buffer.from(await read(p.credential)).toString()).toBe(
            "secret-selected-from-mask",
          );
          return {
            state: "passed",
            verifiedChecks: ["dns", "authentication", "contract"],
          };
        },
      },
    });
    const draft = await configured.createConfigDraft(
      ops,
      "aiConnection",
      payload,
      null,
    );
    expect(
      (await configured.testConfigDraft(ops, draft.id, "connection")).state,
    ).toBe("passed");
  });
  it("secret rotation writes a new version and returns a fixed mask; revoke blocks pinned uses", async () => {
    const secrets = new SecretService(db.database, auth, secretPort, {
      environment: "dev",
      reauth,
      assertNotInUse: async () => {
        throw Error("SECRET_IN_USE");
      },
    });
    const first = await secrets
      .withRequest({ reauthProof: await proof(ops, "admin_secret") })
      .writeSecret(
        ops,
        "ai",
        Buffer.from("sensitive-original"),
        "new credential",
      );
    const second = await secrets
      .withRequest({ reauthProof: await proof(ops, "admin_secret") })
      .rotateSecret(
        ops,
        first.id,
        Buffer.from("sensitive-rotated"),
        "rotation",
      );
    expect(second.versionId).not.toBe(first.versionId);
    expect(
      new Set([...values.keys()].map((key) => key.split(":")[0])).size,
    ).toBe(1);
    expect(second.maskedHint).toBe("••••••••");
    expect(JSON.stringify([first, second])).not.toMatch(/sensitive|secretRef/);
    await expect(
      secrets
        .withRequest({ reauthProof: await proof(ops, "admin_secret") })
        .revokeSecret(ops, first.id, false, "normal revoke"),
    ).rejects.toThrow("SECRET_IN_USE");
    const audit = await db.pool.query(
      "SELECT redacted_details FROM ai_album.audit_events",
    );
    expect(JSON.stringify(audit.rows)).not.toContain("sensitive");
  });
  it("refresh failure keeps one complete previous snapshot and emits only a generic alert", async () => {
    const a = await tested();
    const first = await publish([a.draft.id], [a.test.id]);
    const alerts: string[] = [];
    let fail = false;
    const cache = new ReleaseCache(
      async () => {
        if (fail) throw Error("secretRef do-not-leak");
        return service.loadRelease();
      },
      (code) => alerts.push(code),
    );
    await cache.refresh();
    fail = true;
    expect((await cache.refresh()).releaseId).toBe(first.releaseId);
    expect(cache.snapshot.releaseId).toBe(first.releaseId);
    expect(alerts).toEqual(["CONFIG_REFRESH_FAILED"]);
  });
  it("emergency disable is durable and stops new requests while preserving queries and finalization", async () => {
    await service
      .withRequest({ reauthProof: await proof(ops, "admin_operations") })
      .emergencyDisable(ops, "generation", true, "incident response");
    await expect(
      service.assertNewRequestsAllowed("generation"),
    ).rejects.toThrow("CAPABILITY_DISABLED");
    const freshProcess = new ConfigService(db.database, auth, secretPort, {
      environment: "dev",
      reauth,
    });
    await expect(
      freshProcess.assertNewRequestsAllowed("generation"),
    ).rejects.toThrow("CAPABILITY_DISABLED");
    expect((await freshProcess.capabilities()).generation.state).toBe(
      "disabled",
    );
    expect(
      freshProcess.assertExistingOperationAllowed("generation", "finalize"),
    ).toBeUndefined();
    expect(
      freshProcess.assertExistingOperationAllowed("generation", "query"),
    ).toBeUndefined();
  });
});
