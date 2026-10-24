import { createHmac, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { canonicalJson, parseDocument } from "@album/document";
import {
  freezeSnapshot,
  allSurfaceIds,
  planSurfaces,
  MAX_ENCODED_BYTES,
  type ExportOptions,
  type ExportSnapshot,
  type PreflightReport,
} from "@album/export";
import { createJob, type JobRecord, type TerminalCommit } from "@album/jobs";
import {
  digest,
  fail,
  id,
  type Actor,
  type Database,
} from "@album/server-core";
import type { components } from "../../../../packages/contracts/src/api";
import type { ConfigRelease, ConfigPayload } from "../config/types";
import type {
  ObjectStore,
  StorageConfig,
  StorageLocator,
} from "../assets/types";
import { rowToLocator } from "../assets/upload";
import type { RevisionAuthorization } from "../projects/revisions";

export type EntitlementSnapshot = {
  workspaceId: string;
  at: string;
  grantIds: string[];
  maxDpi: 72 | 150 | 300;
  maxConcurrentExports: number;
  brandWatermark: boolean;
  storageLimitBytes: number;
};
export interface EntitlementPort {
  /** Real commerce authority rechecks source eligibility in the acceptance transaction. */
  verifyAcceptance?(
    tx: PoolClient,
    workspaceId: string,
    snapshot: EntitlementSnapshot,
  ): Promise<void>;
  getEntitlements(
    workspaceId: string,
    at: string,
  ): Promise<EntitlementSnapshot>;
}
export type RendererIdentity = { version: string; imageDigest: string };
export type PinnedResource = {
  objectId: string;
  workspaceId: string;
  profileVersionId: string;
  locator: StorageLocator;
  bytes: number;
  mime: string;
  fontVersionId: string | null;
};
/** Trusted server adapter; performs C1 preflight and, when ack is supplied, C1 authorizeExport. */
export interface ExportPreflightPort {
  check(
    snapshot: ExportSnapshot,
    pins: PinnedResource[],
    signal: AbortSignal,
    ack?: string[],
  ): Promise<PreflightReport>;
}
export type ExportPolicy = Extract<ConfigPayload, { kind: "export" }>;
export type FrozenExport = {
  schemaVersion: 1;
  snapshot: ExportSnapshot;
  pins: PinnedResource[];
  renderer: RendererIdentity;
  policy: ExportPolicy;
  entitlements: EntitlementSnapshot;
  report: PreflightReport;
  reservedBytes: number;
  outputStorage: StorageConfig;
};
export type ExportDependencies = {
  db: Database;
  authorization: RevisionAuthorization;
  objects: ObjectStore;
  storage: StorageConfig;
  entitlements: EntitlementPort;
  config: { loadRelease(releaseId?: string): Promise<Readonly<ConfigRelease>> };
  preflight: ExportPreflightPort;
  renderer: RendererIdentity;
  tokenSecret: string;
  clock?: () => string;
};
type AcceptInput = {
  projectId: string;
  revision: number;
  options: ExportOptions;
  snapshotHash: string;
  acknowledgedWarningIds: string[];
};
type Token = {
  v: 1;
  actor: string;
  wid: string;
  pid: string;
  revision: number;
  preflightId: string;
  options: ExportOptions;
  hash: string;
  expiresAt: string;
};
type PackedToken = Omit<Token, "options"> & {
  options: Omit<ExportOptions, "pageIds"> & { pageIds: number[] };
};
const canonical = (value: unknown) => canonicalJson(value);
const policyEntitlement = ({ at: _, ...rest }: EntitlementSnapshot) => rest;
const same = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const terminal = ["succeeded", "failed", "cancelled"];

/** SQL-only, once-only hook. Compose with other terminal hooks when constructing JobRepository. */
export const exportTerminalHook: TerminalCommit = async (tx, job, outcome) => {
  if (job.kind !== "export") return;
  const r = (
    await tx.query(
      "SELECT * FROM storage_quota_reservations WHERE workspace_id=$1 AND operation_id=$2 AND state='held' FOR UPDATE",
      [job.workspaceId, job.jobId],
    )
  ).rows[0];
  if (r) {
    const actual =
      outcome.state === "succeeded"
        ? Number(
            (
              await tx.query(
                "SELECT COALESCE(sum(byte_size),0) AS n FROM job_outputs WHERE workspace_id=$1 AND job_id=$2",
                [job.workspaceId, job.jobId],
              )
            ).rows[0].n,
          )
        : 0;
    if (actual > Number(r.bytes)) fail("STORAGE_QUOTA", 409);
    await tx.query(
      "UPDATE storage_usage_accounts SET reserved_bytes=reserved_bytes-$2,used_bytes=used_bytes+$3,revision=revision+1 WHERE workspace_id=$1 AND id=$4",
      [job.workspaceId, r.bytes, actual, r.usage_account_id],
    );
    await tx.query(
      "UPDATE storage_quota_reservations SET state=$2 WHERE id=$1",
      [r.id, outcome.state === "succeeded" ? "consumed" : "released"],
    );
  }
  await tx.query(
    "UPDATE resource_pins SET released_at=clock_timestamp() WHERE workspace_id=$1 AND job_id=$2 AND released_at IS NULL",
    [job.workspaceId, job.jobId],
  );
};

export class ExportService {
  private clock: () => string;
  constructor(private deps: ExportDependencies) {
    this.clock = deps.clock ?? (() => new Date().toISOString());
    if (Buffer.byteLength(deps.tokenSecret) < 32)
      fail("EXPORT_TOKEN_UNCONFIGURED", 503);
    if (
      !deps.renderer.version ||
      !/^sha256:[0-9a-f]{64}$/.test(deps.renderer.imageDigest)
    )
      fail("RENDERER_UNCONFIGURED", 503);
  }
  private async lockKey(tx: PoolClient, wid: string, key: string) {
    if (!key || key.length > 128) fail("IDEMPOTENCY_KEY_REQUIRED", 428);
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "workspace:" + wid + ":" + key,
    ]);
  }
  private async surfaceOrder(
    tx: PoolClient,
    wid: string,
    pid: string,
    revision: number,
    options: Pick<ExportOptions, "view" | "includeCover">,
  ) {
    const row = (
      await tx.query(
        "SELECT p.document FROM project_revisions r JOIN project_revision_payloads p ON p.revision_id=r.id WHERE r.workspace_id=$1 AND r.project_id=$2 AND r.number=$3",
        [wid, pid, revision],
      )
    ).rows[0];
    if (!row) fail("PREFLIGHT_STALE", 409);
    return allSurfaceIds(
      parseDocument(row.document),
      options.view,
      options.includeCover,
    );
  }
  private async token(tx: PoolClient, value: Token) {
    // Compact page ordinals refer to this immutable saved revision. IDs themselves may each be 128 characters.
    const order = await this.surfaceOrder(
      tx,
      value.wid,
      value.pid,
      value.revision,
      value.options,
    );
    const packed: PackedToken = {
      ...value,
      options: {
        ...value.options,
        pageIds: value.options.pageIds.map((pageId) => order.indexOf(pageId)),
      },
    };
    if (packed.options.pageIds.some((index) => index < 0))
      fail("PREFLIGHT_STALE", 409);
    const body = Buffer.from(canonical(packed)).toString("base64url");
    const token =
      body +
      "." +
      createHmac("sha256", this.deps.tokenSecret)
        .update(body)
        .digest("base64url");
    if (token.length > 4096) fail("PREFLIGHT_TOKEN_BUDGET", 422);
    return token;
  }
  private parseToken(raw: string): PackedToken {
    try {
      if (typeof raw !== "string" || raw.length > 4096) throw Error();
      const [body, sig, extra] = raw.split(".");
      const actual = Buffer.from(sig ?? "", "base64url"),
        expected = createHmac("sha256", this.deps.tokenSecret)
          .update(body ?? "")
          .digest();
      if (
        extra ||
        actual.length !== expected.length ||
        !timingSafeEqual(actual, expected)
      )
        throw Error();
      const token = JSON.parse(
        Buffer.from(body, "base64url").toString(),
      ) as PackedToken;
      if (
        token.v !== 1 ||
        !token.actor ||
        !token.wid ||
        !token.pid ||
        !token.preflightId ||
        !Number.isSafeInteger(token.revision) ||
        !Array.isArray(token.options?.pageIds) ||
        token.options.pageIds.some(
          (index) => !Number.isInteger(index) || index < 0 || index > 101,
        ) ||
        !/^([0-9a-f]{64})$/.test(token.hash) ||
        !Number.isFinite(Date.parse(token.expiresAt))
      )
        throw Error();
      return token;
    } catch {
      fail("PREFLIGHT_STALE", 409);
    }
  }
  private async prepare(
    tx: PoolClient,
    actor: Actor,
    wid: string,
    pid: string,
    revision: number,
    options: ExportOptions,
    ack?: string[],
  ) {
    await this.deps.authorization.authorize(actor, wid, "edit", tx);
    if (!Number.isSafeInteger(revision) || revision < 1)
      fail("INVALID_REVISION", 422);
    const row = (
      await tx.query(
        "SELECT r.*,p.document,p.resources FROM project_revisions r JOIN project_revision_payloads p ON p.revision_id=r.id JOIN projects pr ON pr.workspace_id=r.workspace_id AND pr.id=r.project_id WHERE r.workspace_id=$1 AND r.project_id=$2 AND r.number=$3 AND pr.state='active' AND pr.deleted_at IS NULL FOR SHARE OF pr",
        [wid, pid, revision],
      )
    ).rows[0];
    if (!row) fail("REVISION_NOT_FOUND", 404);
    const snapshot = await freezeSnapshot(
      {
        doc: parseDocument(row.document),
        docHash: row.document_hash,
        resources: row.resources,
        savedAt: new Date(row.created_at).toISOString(),
      },
      options,
      new Date(row.created_at).toISOString(),
    );
    if (snapshot.projectId !== pid || snapshot.revision !== revision)
      fail("STORAGE_CORRUPT", 500);
    const release = await this.deps.config.loadRelease();
    const policies = Object.values(release.versions)
      .map((v) => v.payload)
      .filter((p): p is ExportPolicy => p.kind === "export");
    if (policies.length !== 1) fail("EXPORT_UNCONFIGURED", 503);
    const policy = policies[0];
    if (
      !policy.allowedDpis.includes(options.dpi) ||
      !policy.allowedFormats.includes(options.format)
    )
      fail("EXPORT_DISABLED", 403);
    const entitlements = structuredClone(
      await this.deps.entitlements.getEntitlements(wid, this.clock()),
    );
    if (
      entitlements.workspaceId !== wid ||
      ![72, 150, 300].includes(entitlements.maxDpi) ||
      !Number.isSafeInteger(entitlements.maxConcurrentExports) ||
      entitlements.maxConcurrentExports < 0 ||
      !Number.isSafeInteger(entitlements.storageLimitBytes) ||
      entitlements.storageLimitBytes < 0 ||
      !Array.isArray(entitlements.grantIds) ||
      typeof entitlements.brandWatermark !== "boolean"
    )
      fail("ENTITLEMENTS_UNCONFIGURED", 503);
    if (options.dpi > entitlements.maxDpi) fail("EXPORT_ENTITLEMENT", 402);
    const surfaces = planSurfaces(snapshot);
    if (
      !surfaces.length ||
      surfaces.some(
        (s) =>
          s.pixelWidth * s.pixelHeight >
          Math.min(50_000_000, policy.maxSurfacePixels),
      )
    )
      fail("PIXEL_BUDGET", 422);
    const objectRows = (
      await tx.query(
        "SELECT o.*,r.font_version_id FROM project_revision_resources r JOIN storage_objects o ON o.workspace_id=r.storage_workspace_id AND o.id=r.storage_object_id WHERE r.revision_id=$1 ORDER BY o.workspace_id,o.id FOR SHARE OF o",
        [row.id],
      )
    ).rows;
    const pins: PinnedResource[] = [];
    for (const o of objectRows) {
      if (o.state !== "verified" || o.deleted_at)
        fail("RESOURCE_UNAVAILABLE", 422);
      pins.push({
        objectId: o.id,
        workspaceId: o.workspace_id,
        profileVersionId: o.profile_version_id,
        locator: await rowToLocator(tx, o),
        bytes: Number(o.byte_size),
        mime: o.mime_type,
        fontVersionId: o.font_version_id ?? null,
      });
    }
    const hashes = new Set(pins.map((p) => p.locator.sha256));
    for (const hash of [
      snapshot.docHash,
      ...snapshot.resources.assets.flatMap((a) =>
        Object.values(a.variants).map((v) => v.sha256),
      ),
      ...snapshot.resources.fonts.flatMap((f) =>
        f.faces.map((face) => face.sha256),
      ),
    ])
      if (!hashes.has(hash)) fail("RESOURCE_MANIFEST_INCOMPLETE", 422);
    for (const asset of snapshot.resources.assets) {
      const a = (
        await tx.query(
          "SELECT id FROM assets WHERE workspace_id=$1 AND id=$2 AND state='ready' AND deleted_at IS NULL FOR SHARE",
          [wid, asset.id],
        )
      ).rows[0];
      if (!a || !asset.license.usable) fail("RESOURCE_UNAVAILABLE", 422);
    }
    for (const font of snapshot.resources.fonts) {
      const licensed = (
        await tx.query(
          "SELECT l.id FROM editor_font_bundles b JOIN license_versions l ON l.id=b.license_version_id WHERE b.workspace_id=$1 AND b.id=$2 AND b.version=$3 AND b.state='published' AND l.embedding_allowed AND l.valid_from<=clock_timestamp() AND (l.valid_until IS NULL OR l.valid_until>clock_timestamp()) UNION ALL SELECT l.id FROM font_versions v JOIN fonts f ON f.id=v.font_id JOIN license_versions l ON l.id=v.license_version_id WHERE v.font_id=$2 AND v.version=$3 AND f.state='published' AND v.embedding_allowed AND l.embedding_allowed AND l.valid_from<=clock_timestamp() AND (l.valid_until IS NULL OR l.valid_until>clock_timestamp())",
          [wid, font.id, font.version],
        )
      ).rows;
      if (!font.license.usable || !licensed.length)
        fail("FONT_UNLICENSED", 422);
    }
    // Read immutable old locators, never current asset/profile routing. This includes every original.
    for (const pin of pins) {
      const bytes = await this.deps.objects.read(pin.locator);
      if (bytes.length !== pin.bytes || digest(bytes) !== pin.locator.sha256)
        fail("RESOURCE_HASH_MISMATCH", 422);
    }
    const report = await this.deps.preflight.check(
      snapshot,
      pins,
      new AbortController().signal,
      ack,
    );
    if (
      report.estimatedBytes >
      Math.min(768, policy.browserBudgetMiB, policy.workerBudgetMiB) * 1024 ** 2
    )
      fail("MEMORY_BUDGET", 422);
    if (
      report.snapshotHash !== snapshot.snapshotHash ||
      !same(report.surfaces, surfaces)
    )
      fail("PREFLIGHT_STALE", 409);
    const hash = digest(
      canonical({
        snapshotHash: snapshot.snapshotHash,
        pins,
        releaseId: release.releaseId,
        policy,
        entitlements: policyEntitlement(entitlements),
        renderer: this.deps.renderer,
        warnings: report.warnings,
        blockers: report.blockers,
      }),
    );
    return { row, snapshot, pins, release, policy, entitlements, report, hash };
  }
  async createPreflight(
    actor: Actor,
    wid: string,
    pid: string,
    input: components["schemas"]["PreflightRequest"],
    key: string,
  ): Promise<components["schemas"]["PreflightResult"]> {
    return this.deps.db.transaction(async (tx) => {
      await this.deps.authorization.authorize(actor, wid, "edit", tx);
      await this.lockKey(tx, wid, key);
      const requestHash = digest(
        canonical({ actor: actor.userId, wid, pid, input }),
      );
      const old = (
        await tx.query(
          "SELECT * FROM idempotency_keys WHERE workspace_id=$1 AND principal_scope='workspace' AND idempotency_key=$2",
          [wid, key],
        )
      ).rows[0];
      if (old) {
        if (
          old.operation !== "export.preflight" ||
          old.request_hash !== requestHash
        )
          fail("IDEMPOTENCY_CONFLICT", 409);
        const result =
          old.response_json as components["schemas"]["PreflightResult"];
        return result.blocked
          ? result
          : {
              ...result,
              preflightToken: await this.token(tx, {
                v: 1,
                actor: actor.userId,
                wid,
                pid,
                revision: result.revision,
                preflightId: result.id,
                options: result.normalizedSpec,
                hash: result.normalizedSpecHash,
                expiresAt: result.expiresAt,
              }),
            };
      }
      const p = await this.prepare(
        tx,
        actor,
        wid,
        pid,
        input.revision,
        input.exportSpec,
      );
      const preflightId = id(),
        expiresAt = new Date(Date.parse(this.clock()) + 300000).toISOString();

      const token = await this.token(tx, {
        v: 1,
        actor: actor.userId,
        wid,
        pid,
        revision: input.revision,
        preflightId,
        options: p.snapshot.options,
        hash: p.hash,
        expiresAt,
      });
      await tx.query(
        "INSERT INTO export_preflights(id,workspace_id,project_id,revision_id,normalized_spec_hash,schema_version,format,dpi,max_face_pixels,warnings,blockers,token_hash,expires_at) VALUES($1,$2,$3,$4,$5,1,$6,$7,$8,$9,$10,$11,$12)",
        [
          preflightId,
          wid,
          pid,
          p.row.id,
          p.hash,
          p.snapshot.options.format,
          p.snapshot.options.dpi,
          Math.max(
            ...p.report.surfaces.map((s) => s.pixelWidth * s.pixelHeight),
          ),
          JSON.stringify(p.report.warnings),
          JSON.stringify(p.report.blockers),
          digest(token),
          expiresAt,
        ],
      );
      const result: components["schemas"]["PreflightResult"] = {
        id: preflightId,
        projectId: pid,
        revision: input.revision,
        blocked: !!p.report.blockers.length,
        issues: [...p.report.blockers, ...p.report.warnings].map((i) => ({
          id: i.id,
          code: i.code,
          severity:
            i.severity === "blocker"
              ? "blocker"
              : i.level === "strong"
                ? "strong_warning"
                : "warning",
          message: i.message,
          acknowledgementRequired: i.severity !== "blocker",
          ...(i.layerId ? { layerId: i.layerId } : {}),
          ...(i.ppi !== undefined ? { effectivePpi: i.ppi } : {}),
        })),
        surfaces: p.report.surfaces.map((s) => ({
          id: s.id,
          pixelWidth: s.pixelWidth,
          pixelHeight: s.pixelHeight,
          pixelCount: s.pixelWidth * s.pixelHeight,
        })),
        normalizedSpec: p.snapshot.options,
        normalizedSpecHash: p.hash,
        expiresAt,
        ...(!p.report.blockers.length ? { preflightToken: token } : {}),
      };
      // Only a digest of the bearer token is stored. The signed body contains no resource locators.
      const { preflightToken: _, ...storedResult } = result;
      await tx.query(
        "INSERT INTO idempotency_keys(id,workspace_id,principal_scope,idempotency_key,request_hash,operation,state,response_status,response_json,expires_at) VALUES($1,$2,'workspace',$3,$4,'export.preflight','completed',200,$5,clock_timestamp()+interval '7 days')",
        [id(), wid, key, requestHash, JSON.stringify(storedResult)],
      );
      return result;
    });
  }
  async acceptPreflightExport(
    actor: Actor,
    input: components["schemas"]["ExportJobCreate"],
    key: string,
  ): Promise<JobRecord> {
    const packed = this.parseToken(input.preflightToken);
    const token: Token = {
      ...packed,
      options: { ...packed.options, pageIds: [] },
    };
    if (
      token.actor !== actor.userId ||
      token.wid !== input.workspaceId ||
      token.pid !== input.projectId ||
      token.revision !== input.revision ||
      token.hash !== input.normalizedSpecHash
    )
      fail("PREFLIGHT_STALE", 409);
    token.options = await this.deps.db.transaction(async (tx) => {
      await this.deps.authorization.authorize(
        actor,
        input.workspaceId,
        "edit",
        tx,
      );
      const order = await this.surfaceOrder(
        tx,
        token.wid,
        token.pid,
        token.revision,
        token.options,
      );
      const pageIds = packed.options.pageIds.map((index) => order[index]);
      if (pageIds.some((pageId) => !pageId)) fail("PREFLIGHT_STALE", 409);
      return { ...packed.options, pageIds };
    });
    return this.accept(
      actor,
      input.workspaceId,
      {
        projectId: input.projectId,
        revision: input.revision,
        options: token.options,
        snapshotHash: input.normalizedSpecHash,
        acknowledgedWarningIds: input.warningsAcknowledged,
      },
      key,
      digest(canonical(input)),
      token,
      input.preflightToken,
    );
  }
  async acceptExport(
    actor: Actor,
    wid: string,
    input: AcceptInput,
    key: string,
  ): Promise<JobRecord> {
    return this.accept(actor, wid, input, key, digest(canonical(input)));
  }
  private async accept(
    actor: Actor,
    wid: string,
    input: AcceptInput,
    key: string,
    requestHash: string,
    token?: Token,
    rawToken?: string,
  ): Promise<JobRecord> {
    return this.deps.db.transaction(async (tx) => {
      await this.deps.authorization.authorize(actor, wid, "edit", tx);
      await this.lockKey(tx, wid, key);
      const old = (
        await tx.query(
          "SELECT * FROM idempotency_keys WHERE workspace_id=$1 AND principal_scope='workspace' AND idempotency_key=$2",
          [wid, key],
        )
      ).rows[0];
      const jobInput = (releaseId: string, snapshotId: string) => ({
        workspaceId: wid,
        kind: "export" as const,
        configReleaseId: releaseId,
        snapshotId,
        inputHash: input.snapshotHash,
        payload: { exportRequestHash: requestHash },
        createdBy: actor.userId,
      });
      if (old) {
        const stored = (
          await tx.query(
            "SELECT s.id,s.config_release_id FROM jobs j JOIN job_snapshots s ON s.workspace_id=j.workspace_id AND s.id=j.snapshot_id WHERE j.workspace_id=$1 AND j.id=$2",
            [wid, old.resource_id],
          )
        ).rows[0];
        if (!stored) fail("IDEMPOTENCY_CONFLICT", 409);
        return createJob(
          tx,
          jobInput(stored.config_release_id, stored.id),
          key,
        );
      }
      if (token && Date.parse(token.expiresAt) <= Date.parse(this.clock()))
        fail("PREFLIGHT_STALE", 409);
      const p = await this.prepare(
        tx,
        actor,
        wid,
        input.projectId,
        input.revision,
        input.options,
      );
      if (input.snapshotHash !== p.hash) fail("PREFLIGHT_STALE", 409);
      if (p.report.blockers.length) fail("PREFLIGHT_BLOCKED", 422);
      const expected = p.report.warnings.map((i) => i.id);
      if (
        new Set(input.acknowledgedWarningIds).size !==
          input.acknowledgedWarningIds.length ||
        !same([...expected].sort(), [...input.acknowledgedWarningIds].sort())
      )
        fail("WARNINGS_UNACKNOWLEDGED", 422);
      // Reuse the exact C1 authority boundary, including strong warning acknowledgement.
      await this.deps.preflight.check(
        p.snapshot,
        p.pins,
        new AbortController().signal,
        input.acknowledgedWarningIds,
      );
      const preflight = (
        await tx.query(
          "SELECT * FROM export_preflights WHERE workspace_id=$1 AND project_id=$2 AND revision_id=$3 AND normalized_spec_hash=$4 AND expires_at>$5::timestamptz" +
            (token ? " AND id=$6 AND token_hash=$7" : "") +
            " ORDER BY created_at DESC LIMIT 1 FOR SHARE",
          [
            wid,
            input.projectId,
            p.row.id,
            p.hash,
            this.clock(),
            ...(token ? [token.preflightId, digest(rawToken!)] : []),
          ],
        )
      ).rows[0];
      if (
        !preflight ||
        preflight.blockers.length ||
        !same(preflight.warnings, p.report.warnings)
      )
        fail("PREFLIGHT_STALE", 409);
      await this.deps.entitlements.verifyAcceptance?.(tx, wid, p.entitlements);
      // Same lock as C3 asset admission; all category rows are counted while serialized.
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
        wid + ":assets",
      ]);
      const active = Number(
        (
          await tx.query(
            "SELECT count(*) AS n FROM jobs WHERE workspace_id=$1 AND kind='export' AND NOT(state=ANY($2::text[]))",
            [wid, terminal],
          )
        ).rows[0].n,
      );
      if (active >= p.entitlements.maxConcurrentExports)
        fail("EXPORT_CONCURRENCY", 429);
      const reservedBytes = Math.max(
        1,
        Math.min(MAX_ENCODED_BYTES, Math.ceil(p.report.estimatedBytes)),
      );
      await tx.query(
        "INSERT INTO storage_usage_accounts(id,workspace_id,category,limit_bytes) VALUES($1,$2,'export',$3) ON CONFLICT(workspace_id,category) DO NOTHING",
        [id(), wid, p.entitlements.storageLimitBytes],
      );
      const accounts = (
        await tx.query(
          "SELECT * FROM storage_usage_accounts WHERE workspace_id=$1 ORDER BY id FOR UPDATE",
          [wid],
        )
      ).rows;
      const used = accounts.reduce(
        (n, a) => n + Number(a.used_bytes) + Number(a.reserved_bytes),
        0,
      );
      if (
        !Number.isSafeInteger(used + reservedBytes) ||
        used + reservedBytes > p.entitlements.storageLimitBytes
      )
        fail("STORAGE_QUOTA", 413);
      const snapshotId = id();
      const frozen: FrozenExport = {
        schemaVersion: 1,
        snapshot: p.snapshot,
        pins: p.pins,
        renderer: this.deps.renderer,
        policy: p.policy,
        entitlements: p.entitlements,
        report: p.report,
        reservedBytes,
        outputStorage: structuredClone(this.deps.storage),
      };
      await tx.query(
        "INSERT INTO job_snapshots(id,workspace_id,kind,project_id,revision_id,preflight_id,config_release_id,schema_version,normalized_spec_hash,manifest_hash,manifest,entitlement_snapshot,warnings_acknowledged,renderer_version,renderer_image_digest) VALUES($1,$2,'export',$3,$4,$5,$6,1,$7,$8,$9,$10,$11,$12,$13)",
        [
          snapshotId,
          wid,
          input.projectId,
          p.row.id,
          preflight.id,
          p.release.releaseId,
          p.hash,
          digest(canonical(frozen)),
          JSON.stringify(frozen),
          JSON.stringify(p.entitlements),
          JSON.stringify(input.acknowledgedWarningIds),
          this.deps.renderer.version,
          this.deps.renderer.imageDigest,
        ],
      );
      const job = await createJob(
        tx,
        jobInput(p.release.releaseId, snapshotId),
        key,
      );
      for (const pin of p.pins)
        await tx.query(
          "INSERT INTO resource_pins(id,workspace_id,job_id,storage_workspace_id,storage_object_id,font_version_id) VALUES($1,$2,$3,$4,$5,$6)",
          [
            id(),
            wid,
            job.jobId,
            pin.workspaceId,
            pin.objectId,
            pin.fontVersionId,
          ],
        );
      const account = accounts.find((a) => a.category === "export")!;
      await tx.query(
        "UPDATE storage_usage_accounts SET reserved_bytes=reserved_bytes+$3,limit_bytes=$4,revision=revision+1 WHERE workspace_id=$1 AND id=$2",
        [wid, account.id, reservedBytes, p.entitlements.storageLimitBytes],
      );
      await tx.query(
        "INSERT INTO storage_quota_reservations(id,workspace_id,usage_account_id,operation_id,bytes,expires_at) VALUES($1,$2,$3,$4,$5,clock_timestamp()+interval '7 days')",
        [id(), wid, account.id, job.jobId, reservedBytes],
      );
      return job;
    });
  }
  async listArtifacts(
    actor: Actor,
    wid: string,
    jobId: string,
  ): Promise<components["schemas"]["Output"][]> {
    return this.deps.db.transaction(async (tx) => {
      await this.deps.authorization.authorize(actor, wid, "read", tx);
      const job = (
        await tx.query(
          "SELECT j.state,s.manifest FROM jobs j JOIN job_snapshots s ON s.workspace_id=j.workspace_id AND s.id=j.snapshot_id WHERE j.workspace_id=$1 AND j.id=$2",
          [wid, jobId],
        )
      ).rows[0];
      if (!job) fail("JOB_NOT_FOUND", 404);
      if (job.state !== "succeeded") return [];
      const frozen = job.manifest as FrozenExport;
      return (
        await tx.query(
          "SELECT x.*,o.mime_type,o.object_key,o.state AS object_state FROM job_outputs x JOIN storage_objects o ON o.workspace_id=x.workspace_id AND o.id=x.storage_object_id WHERE x.workspace_id=$1 AND x.job_id=$2 ORDER BY artifact_index",
          [wid, jobId],
        )
      ).rows.map((r) => ({
        id: r.id,
        jobId,
        projectId: frozen.snapshot.projectId,
        revision: frozen.snapshot.revision,
        format: r.format,
        filename: r.object_key.split("/").at(-1),
        mime: r.mime_type,
        sizeBytes: Number(r.byte_size),
        sha256: r.sha256,
        ...(r.width ? { width: r.width, height: r.height } : {}),
        createdAt: new Date(r.created_at).toISOString(),
        expiresAt: new Date(r.expires_at).toISOString(),
        state:
          Date.parse(this.clock()) >= new Date(r.expires_at).getTime()
            ? "expired"
            : r.object_state === "verified"
              ? "ready"
              : "revoked",
      }));
    });
  }
  async authorizeArtifactDownload(
    actor: Actor,
    wid: string,
    artifactId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    return this.deps.db.transaction(async (tx) => {
      await this.deps.authorization.authorize(actor, wid, "read", tx);
      const row = (
        await tx.query(
          "SELECT o.*,x.expires_at FROM job_outputs x JOIN jobs j ON j.workspace_id=x.workspace_id AND j.id=x.job_id JOIN storage_objects o ON o.workspace_id=x.workspace_id AND o.id=x.storage_object_id WHERE x.workspace_id=$1 AND x.id=$2 AND j.state='succeeded' AND j.fence=x.committed_fence AND o.state='verified' AND o.deleted_at IS NULL FOR SHARE OF j,o",
          [wid, artifactId],
        )
      ).rows[0];
      if (!row) fail("OUTPUT_NOT_FOUND", 404);
      const left =
        new Date(row.expires_at).getTime() - Date.parse(this.clock());
      if (left < 1000) fail("OUTPUT_EXPIRED", 410);
      const ttl = Math.min(300, Math.floor(left / 1000));
      return {
        url: await this.deps.objects.sign(
          await rowToLocator(tx, row),
          "download",
          ttl,
        ),
        expiresAt: new Date(
          Date.parse(this.clock()) + ttl * 1000,
        ).toISOString(),
      };
    });
  }
  /** Reentrant retention sweep. Only expired, committed export objects are eligible. */
  async expireArtifacts(limit = 100): Promise<number> {
    const candidates = await this.deps.db.transaction(async (tx) => {
      const rows = (
        await tx.query(
          "SELECT o.* FROM storage_objects o JOIN job_outputs x ON x.workspace_id=o.workspace_id AND x.storage_object_id=o.id JOIN jobs j ON j.workspace_id=x.workspace_id AND j.id=x.job_id WHERE o.kind='export' AND o.state IN ('verified','deleting') AND j.state='succeeded' AND x.expires_at<=$1::timestamptz ORDER BY o.id LIMIT $2 FOR UPDATE OF o SKIP LOCKED",
          [this.clock(), Math.max(1, Math.min(1000, limit))],
        )
      ).rows;
      const result = [];
      for (const row of rows) {
        await tx.query(
          "UPDATE storage_objects SET state='deleting' WHERE workspace_id=$1 AND id=$2",
          [row.workspace_id, row.id],
        );
        result.push({ row, locator: await rowToLocator(tx, row) });
      }
      return result;
    });
    let removed = 0;
    for (const { row, locator } of candidates) {
      try {
        await this.deps.objects.remove(locator);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") continue;
      }
      removed += await this.deps.db.transaction(async (tx) => {
        const changed = await tx.query(
          "UPDATE storage_objects SET state='deleted',deleted_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 AND state='deleting' RETURNING id",
          [row.workspace_id, row.id],
        );
        if (!changed.rowCount) return 0;
        await tx.query(
          "UPDATE storage_usage_accounts SET used_bytes=used_bytes-$2,revision=revision+1 WHERE workspace_id=$1 AND category='export'",
          [row.workspace_id, row.byte_size],
        );
        return 1;
      });
    }
    return removed;
  }
}
