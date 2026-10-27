import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { testDatabase } from "../../api/test/database";
import { storageFixture } from "../../api/test/asset-fixtures";
import { AuthService } from "../../api/src/auth/identity";
import { WorkspaceService } from "../../api/src/workspaces/service";
import { RevisionService } from "../../api/src/projects/revisions";
import { UploadService, rowToLocator } from "../../api/src/assets/upload";
import { BrowserPreflight } from "./preflight";
import { LocalObjectStore } from "../../api/src/assets/object-store";
import {
  ExportService,
  exportTerminalHook,
  type ExportDependencies,
  type ExportPolicy,
  type EntitlementSnapshot,
} from "../../api/src/exports/service";
import {
  ExportWorker,
  CliRenderer,
  verifyPdf,
  runBoundedNode,
} from "./render-job";
import { JobRepository, type JobLease } from "@album/jobs";
import { digest, id, type Actor } from "@album/server-core";
import {
  preflight,
  freezeSnapshot,
  planSurfaces,
  encodePdf,
  authorizeExport,
  type ExportOptions,
  type ExportSnapshot,
} from "@album/export";
import type { DocumentModel } from "@album/document";
import fixture from "../../../tests/fixtures/documents/minimal.json";

describe.skipIf(!process.env.C3_TEST_DATABASE_URL)(
  "immutable entitled exports on disposable PostgreSQL",
  () => {
    let db: Awaited<ReturnType<typeof testDatabase>>,
      root: string,
      actor: Actor,
      wid: string,
      pid: string;
    let objects: LocalObjectStore,
      storage: Awaited<ReturnType<typeof storageFixture>>,
      revisions: RevisionService;
    let service: ExportService,
      worker: ExportWorker,
      jobs: JobRepository,
      entitlement: EntitlementSnapshot,
      releaseId: string;
    const chromiumPath =
      process.env.CHROMIUM_PATH ??
      (existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
    const rendererIdentity = {
      version: "c1-cpu-fabric-v1",
      imageDigest: "sha256:" + digest("local-controlled-c1-runtime"),
    };
    let now: Date;
    let dependencies: ExportDependencies;
    const options: ExportOptions = {
      format: "png",
      dpi: 300,
      view: "spread",
      pageIds: ["spread_1"],
      includeCover: false,
      bleedMm: 3,
      jpegMatte: "#FFFFFF",
    };
    const rows = async (sql: string, args: unknown[] = []) =>
      db.database.transaction(async (tx) => (await tx.query(sql, args)).rows);
    const clock = () => now.toISOString();
    const check = {
      check: async (
        snapshot: ExportSnapshot,
        _pins: unknown[],
        signal: AbortSignal,
        ack?: string[],
      ) => {
        const report = await preflight(
          snapshot,
          {
            read: async () => {
              throw Error("unexpected resource");
            },
          },
          signal,
          { memoryBudgetBytes: 2 * 1024 ** 3 },
        );
        if (ack) authorizeExport(snapshot, report, ack);
        return report;
      },
    };
    async function prepare(spec = options) {
      return service.createPreflight(
        actor,
        wid,
        pid,
        { revision: 12, exportSpec: spec },
        id(),
      );
    }
    async function accept(spec = options, key = id()) {
      const p = await prepare(spec);
      return service.acceptPreflightExport(
        actor,
        {
          workspaceId: wid,
          projectId: pid,
          revision: 12,
          preflightToken: p.preflightToken!,
          normalizedSpecHash: p.normalizedSpecHash,
          warningsAcknowledged: p.issues
            .filter((i: any) => i.acknowledgementRequired)
            .map((i: any) => i.id),
        },
        key,
      );
    }
    async function lease(jobId: string) {
      return (await jobs.claimJob(jobId, "export-test", clock()))!;
    }
    beforeAll(async () => {
      for (const config of [
        "apps/web/vite.config.ts",
        "apps/export-worker/vite.config.ts",
      ])
        execFileSync(
          process.execPath,
          ["node_modules/vite/bin/vite.js", "build", "--config", config],
          { stdio: "pipe" },
        );
      db = await testDatabase();
      root = await mkdtemp(tmpdir() + "/c4-exports-");
    }, 60000);
    afterAll(async () => {
      await db?.close();
      if (root) await rm(root, { recursive: true, force: true });
    });
    beforeEach(async () => {
      await rows("TRUNCATE users CASCADE");
      now = new Date();
      const auth = new AuthService(db.database, {
        secret: "x".repeat(40),
        environment: "dev",
      });
      actor = (
        await auth.login(
          {
            exchange: async () => ({
              provider: "wechat",
              appId: "export-tests",
              subject: id(),
              unionId: null,
              openPlatformId: null,
            }),
          },
          id(),
          "web",
        )
      ).actor;
      const workspaces = new WorkspaceService(db.database, auth);
      wid = (await workspaces.createWorkspace(actor, "personal", id()))
        .workspaceId;
      storage = await storageFixture(db.database);
      objects = new LocalObjectStore({
        root,
        secret: "x".repeat(40),
        environment: "dev",
        baseUrl: "http://localhost",
      });
      revisions = new RevisionService(
        db.database,
        workspaces,
        objects,
        storage,
      );
      pid = id();
      const doc = structuredClone(fixture) as DocumentModel;
      doc.projectId = pid;
      doc.pageSize = { width: (300 * 96) / 25.4, height: (300 * 96) / 25.4 };
      await revisions.createInitialProject(
        actor,
        wid,
        doc,
        { assets: [], fonts: [] },
        id(),
        "Print",
      );
      for (let n = 1; n < 12; n++)
        await revisions.saveCloudRevision(
          actor,
          wid,
          doc,
          n,
          { assets: [], fonts: [] },
          id(),
        );
      releaseId = id();
      await rows(
        "INSERT INTO config_releases(id,environment,release_number,schema_version,manifest_hash,manifest,published_by) VALUES($1,'dev',1,1,$2,'{}',$3)",
        [releaseId, digest("release"), actor.userId],
      );
      await rows(
        "INSERT INTO config_active_releases(id,environment,release_id) VALUES($1,'dev',$2) ON CONFLICT(environment) DO UPDATE SET release_id=excluded.release_id",
        [id(), releaseId],
      );
      entitlement = {
        workspaceId: wid,
        at: clock(),
        grantIds: ["grant-paid"],
        maxDpi: 300,
        maxConcurrentExports: 3,
        brandWatermark: false,
        storageLimitBytes: 2 * 1024 ** 3,
      };
      const payload: ExportPolicy = {
        kind: "export",
        allowedFormats: ["png", "jpeg", "pdf"],
        allowedDpis: [72, 150, 300],
        maxSurfacePixels: 50_000_000,
        browserBudgetMiB: 768,
        workerBudgetMiB: 2048,
        ppiWarning: 200,
        ppiStrongWarning: 100,
        outputRetentionDays: 7,
        jpegQuality: 0.9,
        jpegMatte: "#FFFFFF",
      };
      dependencies = {
        db: db.database,
        authorization: workspaces,
        objects,
        storage,
        entitlements: {
          getEntitlements: async (_wid: string, at: string) => ({
            ...structuredClone(entitlement),
            at,
          }),
        },
        config: {
          loadRelease: async () => ({
            releaseId,
            versionIds: ["version-export"],
            versions: {
              export: {
                id: "version-export",
                namespace: "export",
                version: 1,
                environment: "dev",
                payload,
                revision: 1,
                state: "published",
                payloadHash: digest(JSON.stringify(payload)),
              },
            },
            effectiveAt: clock(),
          }),
        },
        preflight: check,
        renderer: rendererIdentity,
        tokenSecret: "t".repeat(40),
        clock,
      };
      service = new ExportService(dependencies);
      jobs = new JobRepository(
        db.database,
        async () => ({
          deployment: { global: 10, workspace: 10 },
          release: { global: 10, workspace: 10 },
          entitlement: { global: 10, workspace: 3 },
          leaseSeconds: 120,
          maxAttempts: 4,
          retryBackoffSeconds: [10, 30, 90],
        }),
        exportTerminalHook,
      );
      worker = new ExportWorker({
        db: db.database,
        jobs,
        objects,
        storage,
        renderer: new CliRenderer({
          objects,
          chromiumPath,
        }),
        identity: rendererIdentity,
      });
    });

    it("freezes revision 12, entitlement and exact resource locators atomically, then renders 7157×3614 after membership expires", async () => {
      const job = await accept();
      const snapshot = (
        await rows(
          "SELECT * FROM job_snapshots WHERE id=(SELECT snapshot_id FROM jobs WHERE id=$1)",
          [job.jobId],
        )
      )[0];
      expect(snapshot.entitlement_snapshot.maxDpi).toBe(300);
      expect(
        await rows(
          "SELECT * FROM resource_pins WHERE job_id=$1 AND released_at IS NULL",
          [job.jobId],
        ),
      ).toHaveLength(1);
      const doc = (await revisions.load(actor, wid, pid, 12)).doc;
      await revisions.saveCloudRevision(
        actor,
        wid,
        doc,
        12,
        { assets: [], fonts: [] },
        id(),
      );
      entitlement.maxDpi = 72;
      entitlement.grantIds = [];
      const held = await lease(job.jobId);
      expect(held).toBeTruthy();
      await worker.renderExportJob(held, new AbortController().signal);
      expect(
        (await rows("SELECT state FROM jobs WHERE id=$1", [job.jobId]))[0]
          .state,
      ).toBe("succeeded");
      const [artifact] = await service.listArtifacts(actor, wid, job.jobId);
      expect(artifact.revision).toBe(12);
      const row = (
        await rows(
          "SELECT o.* FROM storage_objects o JOIN job_outputs x ON x.storage_object_id=o.id WHERE x.id=$1",
          [artifact.id],
        )
      )[0];
      const { rowToLocator } = await import("../../api/src/assets/upload");
      const locator = await db.database.transaction((tx) =>
        rowToLocator(tx, row),
      );
      const bytes = await objects.read(locator);
      const decoded = await sharp(bytes)
        .raw()
        .toBuffer({ resolveWithObject: true });
      expect({
        width: decoded.info.width,
        height: decoded.info.height,
      }).toEqual({ width: 7157, height: 3614 });
      expect((await sharp(bytes).metadata()).density).toBeCloseTo(300, 0);
      expect(
        new Date(artifact.expiresAt).getTime() -
          new Date(artifact.createdAt).getTime(),
      ).toBe(7 * 86400_000);
      expect(
        await rows(
          "SELECT id FROM resource_pins WHERE job_id=$1 AND released_at IS NULL",
          [job.jobId],
        ),
      ).toHaveLength(0);
      expect(
        (await service.authorizeArtifactDownload(actor, wid, artifact.id)).url,
      ).toContain("/v1/dev-objects/");
    }, 180000);

    it("releases project/session locks during external storage and revalidates saves and revocation before acceptance", async () => {
      const saved = await revisions.load(actor, wid, pid, 12);
      const originalRead = objects.read.bind(objects);
      let entered!: () => void, resume!: () => void;
      let seen = new Promise<void>((r) => {
        entered = r;
      });
      let gate = new Promise<void>((r) => {
        resume = r;
      });
      const suspendedRead = async (
        locator: Parameters<typeof originalRead>[0],
        signal?: AbortSignal,
      ) => {
        entered();
        await gate;
        return originalRead(locator, signal);
      };
      objects.read = suspendedRead;
      const running = prepare({ ...options, dpi: 72 });
      await seen;
      expect(db.pool.totalCount).toBe(db.pool.idleCount);
      objects.read = originalRead;
      try {
        await db.database.transaction((tx) =>
          tx.query(
            "SELECT id FROM projects WHERE workspace_id=$1 AND id=$2 FOR UPDATE NOWAIT",
            [wid, pid],
          ),
        );
        await revisions.saveCloudRevision(
          actor,
          wid,
          saved.doc,
          12,
          saved.resources,
          id(),
        );
      } finally {
        resume();
      }
      const p = await running;
      expect(p.revision).toBe(12); // immutable saved input survives a concurrent save
      expect(
        (
          await rows("SELECT current_revision FROM projects WHERE id=$1", [pid])
        )[0].current_revision,
      ).toBe("13");
      expect(await rows("SELECT id FROM jobs")).toHaveLength(0);
      seen = new Promise<void>((r) => {
        entered = r;
      });
      gate = new Promise<void>((r) => {
        resume = r;
      });
      objects.read = suspendedRead;
      const acceptance = service.acceptPreflightExport(
        actor,
        {
          workspaceId: wid,
          projectId: pid,
          revision: 12,
          preflightToken: p.preflightToken!,
          normalizedSpecHash: p.normalizedSpecHash,
          warningsAcknowledged: [],
        },
        id(),
      );
      // Attach rejection before resuming the race, so test code never leaves an unhandled promise.
      const denied = expect(acceptance).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
      await seen;
      await rows(
        "UPDATE workspace_members SET role='viewer' WHERE workspace_id=$1 AND user_id=$2",
        [wid, actor.userId],
      );
      resume();
      await denied;
      expect(await rows("SELECT id FROM jobs")).toHaveLength(0);
      expect(await rows("SELECT id FROM resource_pins")).toHaveLength(0);
      objects.read = originalRead;
    });
    it("bounds stalled preflight I/O and aborts it without retaining a SQL connection", async () => {
      const originalRead = objects.read.bind(objects),
        originalTimer = globalThis.setTimeout;
      const timer = vi
        .spyOn(globalThis, "setTimeout")
        .mockImplementation(((
          fn: (...args: any[]) => void,
          ms?: number,
          ...args: any[]
        ) =>
          originalTimer(
            fn,
            ms === 120_000 ? 20 : ms,
            ...args,
          )) as typeof setTimeout);
      let aborted = false;
      objects.read = async (_locator, signal) =>
        new Promise((_resolve, reject) => {
          signal!.addEventListener(
            "abort",
            () => {
              aborted = true;
              reject(signal!.reason);
            },
            { once: true },
          );
        });
      try {
        await expect(prepare({ ...options, dpi: 72 })).rejects.toMatchObject({
          code: "PREFLIGHT_TIMEOUT",
          status: 503,
        });
        expect(aborted).toBe(true);
        expect(db.pool.totalCount).toBe(db.pool.idleCount);
        expect(await rows("SELECT id FROM export_preflights")).toHaveLength(0);
        expect(await rows("SELECT id FROM jobs")).toHaveLength(0);
      } finally {
        objects.read = originalRead;
        timer.mockRestore();
      }
    });
    it("rejects unchanged export retries after actual OOM normalization", async () => {
      const job = await accept({ ...options, dpi: 150 }),
        claimed = await lease(job.jobId);
      await jobs.failAttempt(claimed, {
        code: "OOM",
        retryable: false,
        definite: true,
      });
      const failed = (
        await rows("SELECT error_code,revision FROM jobs WHERE id=$1", [
          job.jobId,
        ])
      )[0];
      expect(failed.error_code).toBe("RESOURCE_EXHAUSTED");
      await expect(
        service.retryExport(
          actor,
          wid,
          job.jobId,
          Number(failed.revision),
          "same options",
          id(),
        ),
      ).rejects.toMatchObject({ code: "RESOURCE_BUDGET_REVIEW_REQUIRED" });
      await expect(accept({ ...options, dpi: 150 })).rejects.toMatchObject({
        code: "RESOURCE_BUDGET_REVIEW_REQUIRED",
      });
      expect(await rows("SELECT id FROM jobs")).toHaveLength(1);
      const reduced = await accept({ ...options, dpi: 72 });
      expect(reduced.state).toBe("queued");
      await jobs.requestCancel(actor, wid, reduced.jobId);
      // A separately reviewed release/budget also permits otherwise identical work.
      const priorConfig = dependencies.config.loadRelease;
      const reviewedRelease = id();
      await rows(
        "INSERT INTO config_releases(id,environment,release_number,schema_version,manifest_hash,manifest,published_by) VALUES($1,'dev',2,1,$2,'{}',$3)",
        [reviewedRelease, digest("reviewed budget"), actor.userId],
      );
      await rows(
        "UPDATE config_active_releases SET release_id=$1 WHERE environment='dev'",
        [reviewedRelease],
      );
      dependencies.config.loadRelease = async () => ({
        ...(await priorConfig()),
        releaseId: reviewedRelease,
      });
      const reviewed = await accept({ ...options, dpi: 150 });
      expect(reviewed.state).toBe("queued");
    });
    it("replays a workspace key concurrently without creating extra snapshots, pins or quota holds; changed request conflicts", async () => {
      const p = await prepare();
      const key = id();
      const input = {
        workspaceId: wid,
        projectId: pid,
        revision: 12,
        preflightToken: p.preflightToken!,
        normalizedSpecHash: p.normalizedSpecHash,
        warningsAcknowledged: [],
      };
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          service.acceptPreflightExport(actor, input, key),
        ),
      );
      expect(new Set(results.map((x) => x.jobId)).size).toBe(1);
      expect(await rows("SELECT id FROM job_snapshots")).toHaveLength(1);
      expect(await rows("SELECT id FROM jobs")).toHaveLength(1);
      expect(
        await rows(
          "SELECT id FROM storage_quota_reservations WHERE state='held'",
        ),
      ).toHaveLength(1);
      await expect(
        service.acceptPreflightExport(
          actor,
          { ...input, warningsAcknowledged: ["forged"] },
          key,
        ),
      ).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    });
    it("rejects stale hashes, expired/tampered tokens, altered policy, and unacknowledged warnings before creating a job", async () => {
      const p = await prepare();
      await expect(
        service.acceptExport(
          actor,
          wid,
          {
            projectId: pid,
            revision: 12,
            options: { ...options, dpi: 150 },
            snapshotHash: p.normalizedSpecHash,
            acknowledgedWarningIds: [],
          },
          id(),
        ),
      ).rejects.toThrow("PREFLIGHT_STALE");
      const input = {
        workspaceId: wid,
        projectId: pid,
        revision: 12,
        preflightToken: p.preflightToken!,
        normalizedSpecHash: p.normalizedSpecHash,
        warningsAcknowledged: [],
      };
      await expect(
        service.acceptPreflightExport(
          actor,
          { ...input, preflightToken: p.preflightToken + "x" },
          id(),
        ),
      ).rejects.toThrow("PREFLIGHT_STALE");
      entitlement.maxDpi = 150;
      await expect(
        service.acceptPreflightExport(actor, input, id()),
      ).rejects.toThrow(/PREFLIGHT_STALE|EXPORT_ENTITLEMENT/);
      entitlement.maxDpi = 300;
      now = new Date(now.getTime() + 301000);
      await expect(
        service.acceptPreflightExport(actor, input, id()),
      ).rejects.toThrow("PREFLIGHT_STALE");
      expect(await rows("SELECT id FROM jobs")).toHaveLength(0);
    });
    it("rolls back snapshot/pins/outbox when quota fails and enforces frozen concurrent admission", async () => {
      entitlement.storageLimitBytes = 1;
      await expect(accept()).rejects.toThrow("STORAGE_QUOTA");
      expect(await rows("SELECT id FROM job_snapshots")).toHaveLength(0);
      expect(await rows("SELECT id FROM resource_pins")).toHaveLength(0);
      entitlement.storageLimitBytes = 2 * 1024 ** 3;
      entitlement.maxConcurrentExports = 1;
      const results = await Promise.allSettled([accept(), accept()]);
      expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((x) => x.status === "rejected")).toHaveLength(1);
    });
    it("queued cancellation safely releases pins and quota once", async () => {
      const job = await accept();
      await jobs.requestCancel(actor, wid, job.jobId);
      await jobs.requestCancel(actor, wid, job.jobId);
      expect(
        (await rows("SELECT state FROM jobs WHERE id=$1", [job.jobId]))[0]
          .state,
      ).toBe("cancelled");
      expect(
        await rows("SELECT id FROM resource_pins WHERE released_at IS NULL"),
      ).toHaveLength(0);
      expect(
        (
          await rows(
            "SELECT reserved_bytes FROM storage_usage_accounts WHERE category='export'",
          )
        )[0].reserved_bytes,
      ).toBe("0");
      expect(
        (await rows("SELECT state FROM storage_quota_reservations"))[0].state,
      ).toBe("released");
    });
    it.each(["cancel", "lost-fence"])(
      "publishes nothing and removes private staged objects after %s during upload",
      async (mode) => {
        const job = await accept({ ...options, dpi: 72 });
        const held = await lease(job.jobId);
        const realPut = objects.put.bind(objects),
          uploaded: any[] = [];
        objects.put = async (locator, bytes) => {
          await realPut(locator, bytes);
          uploaded.push(locator);
          if (mode === "cancel")
            await jobs.requestCancel(actor, wid, job.jobId);
          else {
            await rows(
              "UPDATE jobs SET lease_expires_at=clock_timestamp()-interval '1 second',revision=revision+1 WHERE id=$1",
              [job.jobId],
            );
            await jobs.recoverExpiredJobs(10);
            await rows(
              "UPDATE jobs SET next_attempt_at=clock_timestamp()-interval '1 second',revision=revision+1 WHERE id=$1",
              [job.jobId],
            );
            const newer = await lease(job.jobId);
            expect(newer.fence).toBe(held.fence + 1);
          }
        };
        await worker.renderExportJob(held, new AbortController().signal);
        expect(uploaded).toHaveLength(1);
        expect(
          await rows("SELECT id FROM job_outputs WHERE job_id=$1", [job.jobId]),
        ).toHaveLength(0);
        await expect(objects.read(uploaded[0])).rejects.toThrow();
        if (mode === "cancel")
          expect(
            (await rows("SELECT state FROM jobs WHERE id=$1", [job.jobId]))[0]
              .state,
          ).toBe("cancelled");
      },
      180000,
    );
    it("download authorization checks current membership, output expiry and workspace on every signature; retention removes only export objects", async () => {
      const job = await accept({ ...options, dpi: 72 });
      await worker.renderExportJob(
        await lease(job.jobId),
        new AbortController().signal,
      );
      const [artifact] = await service.listArtifacts(actor, wid, job.jobId);
      await rows(
        "UPDATE workspace_members SET state='removed' WHERE workspace_id=$1 AND user_id=$2",
        [wid, actor.userId],
      );
      await expect(
        service.authorizeArtifactDownload(actor, wid, artifact.id),
      ).rejects.toThrow("FORBIDDEN");
      await rows(
        "UPDATE workspace_members SET state='active' WHERE workspace_id=$1 AND user_id=$2",
        [wid, actor.userId],
      );
      await expect(
        service.authorizeArtifactDownload(actor, id(), artifact.id),
      ).rejects.toThrow();
      now = new Date(now.getTime() + 8 * 86400_000);
      await expect(
        service.authorizeArtifactDownload(actor, wid, artifact.id),
      ).rejects.toThrow("OUTPUT_EXPIRED");
      expect(await service.expireArtifacts()).toBe(1);
      expect(
        (
          await rows(
            "SELECT count(*) AS n FROM storage_objects WHERE kind='document' AND state='verified'",
          )
        )[0].n,
      ).toBe("12");
      expect(
        (
          await rows(
            "SELECT used_bytes FROM storage_usage_accounts WHERE category='export'",
          )
        )[0].used_bytes,
      ).toBe("0");
    }, 180000);
    it("stores only the preflight token digest, including idempotency replay, and returns the same signed token", async () => {
      const key = id();
      const first = await service.createPreflight(
        actor,
        wid,
        pid,
        { revision: 12, exportSpec: options },
        key,
      );
      const stored = (
        await rows(
          "SELECT response_json FROM idempotency_keys WHERE operation='export.preflight'",
        )
      )[0].response_json;
      expect(stored.preflightToken).toBeUndefined();
      const replay = await service.createPreflight(
        actor,
        wid,
        pid,
        { revision: 12, exportSpec: options },
        key,
      );
      expect(replay).toEqual(first);
    });
    it("retains committed objects when the database commits success but the connection loses its response", async () => {
      const job = await accept({ ...options, dpi: 72 });
      const held = await lease(job.jobId);
      const real = db.database.transaction.bind(db.database);
      let lost = false;
      db.database.transaction = async (work) => {
        const value = await real(work);
        if (value === true && !lost) {
          lost = true;
          throw Error("SIMULATED_COMMIT_RESPONSE_LOSS");
        }
        return value;
      };
      try {
        await worker.renderExportJob(held, new AbortController().signal);
        const [artifact] = await service.listArtifacts(actor, wid, job.jobId);
        expect(artifact).toBeTruthy();
        const row = (
          await rows(
            "SELECT o.* FROM storage_objects o JOIN job_outputs x ON x.storage_object_id=o.id WHERE x.id=$1",
            [artifact.id],
          )
        )[0];
        const bytes = await objects.read(
          await real((tx) => rowToLocator(tx, row)),
        );
        expect(digest(bytes)).toBe(artifact.sha256);
      } finally {
        db.database.transaction = real;
      }
    }, 180000);
    it("failed/OOM rendering releases quota and pins once without an unchanged retry", async () => {
      const job = await accept({ ...options, dpi: 72 });
      const failing = new ExportWorker({
        db: db.database,
        jobs,
        objects,
        storage,
        identity: rendererIdentity,
        renderer: {
          render: async () => {
            throw Error("RESOURCE_EXHAUSTED");
          },
        },
      });
      await failing.renderExportJob(
        await lease(job.jobId),
        new AbortController().signal,
      );
      const state = (
        await rows(
          "SELECT state,error_code,attempt_count FROM jobs WHERE id=$1",
          [job.jobId],
        )
      )[0];
      expect(state).toEqual({
        state: "failed",
        error_code: "RESOURCE_EXHAUSTED",
        attempt_count: 1,
      });
      expect(
        await rows("SELECT id FROM resource_pins WHERE released_at IS NULL"),
      ).toHaveLength(0);
      expect(
        (await rows("SELECT state FROM storage_quota_reservations"))[0].state,
      ).toBe("released");
    });
    it.each(["jpeg", "pdf"] as const)(
      "verifies real %s geometry, DPI/page order and the frozen free watermark",
      async (format) => {
        entitlement.brandWatermark = true;
        const spec: ExportOptions = {
          ...options,
          format,
          dpi: 72,
          ...(format === "pdf"
            ? {
                view: "singlePage",
                pageIds: ["spread_1:left", "spread_1:right"],
              }
            : {}),
        };
        const job = await accept(spec);
        await worker.renderExportJob(
          await lease(job.jobId),
          new AbortController().signal,
        );
        const terminal=(await rows("SELECT state,error_code,stage FROM jobs WHERE id=$1",[job.jobId]))[0];
        expect(terminal.state,JSON.stringify(terminal)).toBe("succeeded");
        const [artifact] = await service.listArtifacts(actor, wid, job.jobId);
        expect(artifact.format).toBe(format);
        const row = (
          await rows(
            "SELECT o.* FROM storage_objects o JOIN job_outputs x ON x.storage_object_id=o.id WHERE x.id=$1",
            [artifact.id],
          )
        )[0];
        const bytes = await objects.read(
          await db.database.transaction((tx) => rowToLocator(tx, row)),
        );
        if (format === "jpeg") {
          const decoded = await sharp(bytes)
            .removeAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true });
          const crop = await sharp(bytes)
            .extract({
              left: decoded.info.width - 180,
              top: decoded.info.height - 50,
              width: 180,
              height: 50,
            })
            .stats();
          expect(crop.channels.some((c) => c.min < 200)).toBe(true);
          expect((await sharp(bytes).metadata()).density).toBe(72);
        } else {
          const { PDFDocument } = await import("pdf-lib");
          const pdf = await PDFDocument.load(bytes);
          expect(pdf.getPageCount()).toBe(2);
          expect(
            pdf
              .getPages()
              .every(
                (p) => Math.abs(p.getWidth() - (306 * 72) / 25.4) < 0.0001,
              ),
          ).toBe(true);
        }
      },
      180000,
    );
    it("uses genuine C1 browser preflight for original bytes and strong warnings, and pins saved locators through a later migration", async () => {
      dependencies.preflight = new BrowserPreflight({
        objects,
        chromiumPath,
      });
      const workspaces = dependencies.authorization as WorkspaceService;
      const uploads = new UploadService(
        db.database,
        workspaces,
        objects,
        {
          readQuota: async () => ({
            limitBytes: 2 * 1024 ** 3,
            maxProjectPhotos: 500,
          }),
        },
        storage,
      );
      const image = await sharp({
        create: { width: 8, height: 4, channels: 4, background: "#f00" },
      })
        .png()
        .toBuffer();
      const pending = await uploads.beginUpload(
        actor,
        wid,
        {
          bytes: image.length,
          sha256: digest(image),
          mime: "image/png",
          folderId: null,
          projectId: pid,
        },
        id(),
      );
      const key = (
        await rows("SELECT object_key FROM upload_sessions WHERE id=$1", [
          pending.uploadId,
        ])
      )[0].object_key;
      await objects.put(
        {
          storageProfileId: storage.storageProfileId,
          profileVersion: 1,
          bucket: storage.bucket,
          key,
          objectVersionId: null,
          sha256: digest(image),
          variant: "original",
        },
        image,
      );
      const asset = await uploads.completeUpload(
        actor,
        wid,
        pending.uploadId,
        id(),
      );
      const doc = (await revisions.load(actor, wid, pid, 12)).doc;
      doc.spreads[0].layers = [
        {
          id: "photo",
          type: "image",
          assetId: asset.id,
          x: 50,
          y: 50,
          width: 600,
          height: 300,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          fitMode: "cover",
          role: "photo",
        },
      ];
      await revisions.saveCloudRevision(
        actor,
        wid,
        doc,
        12,
        { assets: [asset], fonts: [] },
        id(),
      );
      const spec: ExportOptions = { ...options, dpi: 72 };
      const p = await service.createPreflight(
        actor,
        wid,
        pid,
        { revision: 13, exportSpec: spec },
        id(),
      );
      const warning = p.issues.find((i) => i.code === "LOW_PPI")!;
      expect(warning.severity).toBe("strong_warning");
      expect(p.blocked).toBe(false);
      const input = {
        workspaceId: wid,
        projectId: pid,
        revision: 13,
        preflightToken: p.preflightToken!,
        normalizedSpecHash: p.normalizedSpecHash,
        warningsAcknowledged: [] as string[],
      };
      await expect(
        service.acceptPreflightExport(actor, input, id()),
      ).rejects.toThrow("WARNINGS_UNACKNOWLEDGED");
      await expect(
        service.acceptPreflightExport(
          actor,
          { ...input, warningsAcknowledged: ["forged"] },
          id(),
        ),
      ).rejects.toThrow("WARNINGS_UNACKNOWLEDGED");
      const job = await service.acceptPreflightExport(
        actor,
        { ...input, warningsAcknowledged: [warning.id] },
        id(),
      );
      const old = (
        await rows(
          "SELECT o.* FROM storage_objects o JOIN assets a ON a.original_object_id=o.id WHERE a.id=$1",
          [asset.id],
        )
      )[0];
      const oldLocator = await db.database.transaction((tx) =>
        rowToLocator(tx, old),
      );
      const newId = id(),
        newLocator = {
          ...oldLocator,
          key: "objects/" + wid + "/migrated/" + newId,
        };
      await objects.put(newLocator, image);
      await rows(
        "INSERT INTO storage_objects(id,workspace_id,profile_version_id,bucket,object_key,kind,sha256,byte_size,mime_type,state,verified_at) VALUES($1,$2,$3,$4,$5,'original',$6,$7,'image/png','verified',now())",
        [
          newId,
          wid,
          storage.profileVersionId,
          storage.bucket,
          newLocator.key,
          digest(image),
          image.length,
        ],
      );
      await rows(
        "UPDATE assets SET original_object_id=$2,revision=revision+1 WHERE workspace_id=$3 AND id=$1",
        [asset.id, newId, wid],
      );
      expect(
        (
          await rows(
            "SELECT storage_object_id FROM resource_pins WHERE job_id=$1 AND storage_object_id=$2",
            [job.jobId, old.id],
          )
        )[0].storage_object_id,
      ).toBe(old.id);
      await worker.renderExportJob(
        await lease(job.jobId),
        new AbortController().signal,
      );
      expect(
        (await rows("SELECT state FROM jobs WHERE id=$1", [job.jobId]))[0]
          .state,
      ).toBe("succeeded");
      // A new preflight still reads the saved original, and fails closed if that exact object disappears.
      await objects.remove(oldLocator);
      await expect(
        service.createPreflight(
          actor,
          wid,
          pid,
          { revision: 13, exportSpec: spec },
          id(),
        ),
      ).rejects.toThrow();
    }, 180000);
    it("honors frozen published JPEG quality even when the live policy later changes", async () => {
      const release = await dependencies.config.loadRelease();
      const policy = release.versions.export.payload;
      if (policy.kind !== "export") throw Error("fixture");
      policy.jpegQuality = 0.1;
      const job = await accept({ ...options, format: "jpeg", dpi: 72 });
      policy.jpegQuality = 0.9;
      await worker.renderExportJob(
        await lease(job.jobId),
        new AbortController().signal,
      );
      const [artifact] = await service.listArtifacts(actor, wid, job.jobId);
      const row = (
        await rows(
          "SELECT o.* FROM storage_objects o JOIN job_outputs x ON x.storage_object_id=o.id WHERE x.id=$1",
          [artifact.id],
        )
      )[0];
      const bytes = Buffer.from(
        await objects.read(
          await db.database.transaction((tx) => rowToLocator(tx, row)),
        ),
      );
      const table = bytes.indexOf(Buffer.from([0xff, 0xdb]));
      expect(table).toBeGreaterThan(0);
      expect(bytes[table + 5]).toBe(80); // libjpeg luminance DC at quality 10
      expect((await sharp(bytes).metadata()).density).toBe(72);
    }, 180000);
    it("keeps tokens inside the contract size for fifty maximum-length opaque spread IDs", async () => {
      const doc = (await revisions.load(actor, wid, pid, 12)).doc;
      doc.spreads = Array.from({ length: 50 }, (_, i) => ({
        id: (
          "s" +
          String(i).padStart(2, "0") +
          id().replaceAll("-", "").repeat(4)
        ).slice(0, 128),
        background: "#FFFFFF",
        layers: [],
      }));
      await revisions.saveCloudRevision(
        actor,
        wid,
        doc,
        12,
        { assets: [], fonts: [] },
        id(),
      );
      const spec: ExportOptions = {
        ...options,
        dpi: 72,
        pageIds: doc.spreads.map((s) => s.id),
      };
      const p = await service.createPreflight(
        actor,
        wid,
        pid,
        { revision: 13, exportSpec: spec },
        id(),
      );
      expect(p.preflightToken!.length).toBeLessThanOrEqual(4096);
      const job = await service.acceptPreflightExport(
        actor,
        {
          workspaceId: wid,
          projectId: pid,
          revision: 13,
          preflightToken: p.preflightToken!,
          normalizedSpecHash: p.normalizedSpecHash,
          warningsAcknowledged: [],
        },
        id(),
      );
      expect(job.state).toBe("queued");
    });
    it.each(["corrupt-painted", "unused-cmyk", "swapped-pages"] as const)(
      "rejects PDF %s despite plausible dictionaries and boxes",
      async (mode) => {
        const saved = await revisions.load(actor, wid, pid, 12);
        const snap = await freezeSnapshot(
          saved,
          {
            ...options,
            dpi: 72,
            view: "singlePage",
            pageIds: ["spread_1:left", "spread_1:right"],
          },
          saved.savedAt,
        );
        const surfaces = planSurfaces(snap);
        const expected = await Promise.all(
          surfaces.map((s, i) =>
            sharp({
              create: {
                width: s.pixelWidth,
                height: s.pixelHeight,
                channels: 3,
                background: i ? "#00f" : "#f00",
              },
            })
              .png()
              .toBuffer(),
          ),
        );
        const {
          PDFDocument,
          PDFName,
          PDFArray,
          drawObject,
          pushGraphicsState,
          popGraphicsState,
          scale,
        } = await import("pdf-lib");
        const good = await encodePdf(
          surfaces.map((surface, i) => ({
            surface,
            mime: "image/png" as const,
            bytes: expected[i],
          })),
          snap,
        );
        await verifyPdf(good, surfaces, expected);
        const pdf = await PDFDocument.load(good);
        if (mode === "swapped-pages") {
          const pages = pdf.getPages();
          pdf.removePage(1);
          pdf.insertPage(0, pages[1]);
        } else {
          const page = pdf.getPage(0),
            s = surfaces[0];
          page.node
            .Resources()!
            .set(PDFName.of("XObject"), pdf.context.obj({}));
          const corrupt = pdf.context.stream(new Uint8Array([1, 2, 3]), {
            Type: "XObject",
            Subtype: "Image",
            Width: s.pixelWidth,
            Height: s.pixelHeight,
            ColorSpace: mode === "unused-cmyk" ? "DeviceCMYK" : "DeviceRGB",
            BitsPerComponent: 8,
            Filter: mode === "unused-cmyk" ? "DCTDecode" : "FlateDecode",
          });
          const name = page.node.newXObject(
            "Bad",
            pdf.context.register(corrupt),
          );
          page.node.set(PDFName.of("Contents"), pdf.context.obj([]));
          if (mode === "corrupt-painted")
            page.pushOperators(
              pushGraphicsState(),
              scale(page.getWidth(), page.getHeight()),
              drawObject(name),
              popGraphicsState(),
            );
        }
        await expect(
          verifyPdf(await pdf.save(), surfaces, expected),
        ).rejects.toThrow("ARTIFACT_INVALID");
      },
    );
    it("can terminate resource preparation while a storage read is still blocked", async () => {
      const job = await accept({ ...options, dpi: 72 }),
        held = await lease(job.jobId),
        controller = new AbortController();
      let unblock!: () => void, entered!: () => void;
      const seen = new Promise<void>((r) => (entered = r)),
        gate = new Promise<void>((r) => (unblock = r));
      const realRead = objects.read.bind(objects);
      objects.read = async (locator) => {
        entered();
        await gate;
        return realRead(locator);
      };
      const execution = worker.renderExportJob(held, controller.signal);
      await seen;
      controller.abort(new Error("abort-preparation"));
      const completed = await Promise.race([
        execution.then(() => true),
        new Promise<boolean>((r) => setTimeout(() => r(false), 500)),
      ]);
      unblock();
      await execution;
      expect(completed).toBe(true);
      expect(
        await rows(
          "SELECT id FROM resource_pins WHERE job_id=$1 AND released_at IS NULL",
          [job.jobId],
        ),
      ).toHaveLength(0);
    }, 180000);
    it.each(["preparation", "postprocessing"])(
      "kills an over-budget %s allocation without killing the consumer and releases fenced holds",
      async (phase) => {
        const job = await accept({ ...options, dpi: 72 });
        const script = root + "/" + phase + ".ts",
          marker = root + "/" + phase + ".entered";
        await writeFile(
          script,
          `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(marker)},'${phase}');const bytes=Buffer.alloc(640*1024*1024,1);setTimeout(()=>process.exit(bytes[0]===1?0:1),2000);`,
        );
        const limited = new ExportWorker({
          db: db.database,
          jobs,
          objects,
          storage,
          identity: rendererIdentity,
          renderer: {
            render: async (_frozen, _ack, signal) => {
              await runBoundedNode(script, [], signal, {
                memoryBytes: 512 * 1024 ** 2,
              });
              return [];
            },
          },
        });
        await limited.renderExportJob(
          await lease(job.jobId),
          new AbortController().signal,
        );
        expect(await readFile(marker, "utf8")).toBe(phase);
        expect(
          (
            await rows("SELECT state,error_code FROM jobs WHERE id=$1", [
              job.jobId,
            ])
          )[0],
        ).toEqual({ state: "failed", error_code: "RESOURCE_EXHAUSTED" });
        expect(
          await rows("SELECT id FROM resource_pins WHERE released_at IS NULL"),
        ).toHaveLength(0);
        expect(
          (
            await rows(
              "SELECT state FROM storage_quota_reservations WHERE operation_id=$1",
              [job.jobId],
            )
          )[0].state,
        ).toBe("released");
      },
      180000,
    );
    it.each(["delete-outage", "lost-put-response", "database-outage"] as const)(
      "durably retries staged cleanup after %s and preserves a current attempt",
      async (mode) => {
        const job = await accept({ ...options, dpi: 72 }),
          held = await lease(job.jobId);
        const put = objects.put.bind(objects),
          remove = objects.remove.bind(objects),
          transaction = db.database.transaction.bind(db.database);
        let staged: any,
          locator: any,
          failDelete = true,
          dbOffline = false;
        objects.remove = async (value) => {
          if (failDelete) throw Error("STORAGE_OFFLINE");
          return remove(value);
        };
        objects.put = async (value, bytes) => {
          staged = (
            await rows(
              "SELECT * FROM outbox WHERE aggregate_id=$1 AND event_type='export.staged'",
              [job.jobId],
            )
          )[0];
          locator = value;
          await put(value, bytes);
          if (mode === "database-outage") dbOffline = true;
          else if (mode === "lost-put-response")
            throw Error("PUT_RESPONSE_LOST");
          else await jobs.requestCancel(actor, wid, job.jobId);
        };
        db.database.transaction = async (work) => {
          if (dbOffline) throw Error("DATABASE_OFFLINE");
          return transaction(work);
        };
        try {
          await worker.renderExportJob(held, new AbortController().signal);
        } catch {
          if (mode !== "database-outage")
            throw Error("unexpected worker failure");
        } finally {
          dbOffline = false;
          db.database.transaction = transaction;
        }
        expect(staged).toBeTruthy();
        expect(staged.payload.locator).toEqual(locator);
        expect(
          (await rows("SELECT sent_at FROM outbox WHERE id=$1", [staged.id]))[0]
            .sent_at,
        ).toBeNull();
        failDelete = false;
        if (mode === "database-outage") {
          await worker.recoverStagedArtifacts(100, job.jobId);
          expect(await objects.read(locator)).toBeTruthy();
          await jobs.requestCancel(actor, wid, job.jobId);
          await jobs.finishJob(held, { state: "cancelled", result: {} });
          await worker.recoverStagedArtifacts(100, job.jobId);
          expect(await objects.read(locator)).toBeTruthy(); // unresolved PUT cannot be deleted merely because its job ended
          await rows(
            "UPDATE outbox SET payload=jsonb_set(payload,'{unsettledUntil}',to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE id=$1",
            [staged.id],
          );
        }
        if (mode === "lost-put-response") {
          expect(
            (
              await rows("SELECT payload FROM outbox WHERE id=$1", [staged.id])
            )[0].payload.putSettled,
          ).toBe(false);
          await worker.recoverStagedArtifacts(100, job.jobId);
          expect(await objects.read(locator)).toBeTruthy();
          expect(
            (
              await rows("SELECT sent_at FROM outbox WHERE id=$1", [staged.id])
            )[0].sent_at,
          ).toBeNull();
          await rows(
            "UPDATE outbox SET payload=jsonb_set(payload,'{unsettledUntil}',to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE id=$1",
            [staged.id],
          );
        }
        await worker.recoverStagedArtifacts(100, job.jobId);
        await expect(objects.read(locator)).rejects.toThrow();
        expect(
          (await rows("SELECT sent_at FROM outbox WHERE id=$1", [staged.id]))[0]
            .sent_at,
        ).not.toBeNull();
        expect(
          await rows("SELECT id FROM job_outputs WHERE job_id=$1", [job.jobId]),
        ).toHaveLength(0);
      },
      180000,
    );
    it.each([
      "wrong-filter",
      "missing-filter",
      "filter-array",
      "decode-parameters",
    ] as const)(
      "rejects PDF content %s without changing the compressed drawing bytes",
      async (mode) => {
        const saved = await revisions.load(actor, wid, pid, 12);
        const snap = await freezeSnapshot(
          saved,
          {
            ...options,
            dpi: 72,
            view: "singlePage",
            pageIds: ["spread_1:left"],
          },
          saved.savedAt,
        );
        const surfaces = planSurfaces(snap),
          surface = surfaces[0];
        const png = await sharp({
          create: {
            width: surface.pixelWidth,
            height: surface.pixelHeight,
            channels: 3,
            background: "#ff0000",
          },
        })
          .png()
          .toBuffer();
        const good = await encodePdf(
          [{ surface, mime: "image/png", bytes: png }],
          snap,
        );
        await expect(verifyPdf(good, surfaces, [png])).resolves.toBeUndefined();
        const { PDFDocument, PDFName, PDFArray, PDFRawStream } =
          await import("pdf-lib");
        const pdf = await PDFDocument.load(good),
          contents = pdf.getPage(0).node.lookup(PDFName.of("Contents"));
        const refs =
          contents instanceof PDFArray ? contents.asArray() : [contents];
        const originals: Buffer[] = [];
        for (const ref of refs) {
          const stream = pdf.context.lookup(ref);
          if (!(stream instanceof PDFRawStream)) throw Error("fixture");
          originals.push(Buffer.from(stream.contents));
          if (mode === "wrong-filter")
            stream.dict.set(PDFName.of("Filter"), PDFName.of("ASCIIHexDecode"));
          else if (mode === "missing-filter")
            stream.dict.delete(PDFName.of("Filter"));
          else if (mode === "filter-array")
            stream.dict.set(
              PDFName.of("Filter"),
              pdf.context.obj(["FlateDecode"]),
            );
          else
            stream.dict.set(
              PDFName.of("DecodeParms"),
              pdf.context.obj({ Predictor: 12, Columns: 1 }),
            );
        }
        const changed = await pdf.save(),
          decoded = await PDFDocument.load(changed);
        const changedContents = decoded
          .getPage(0)
          .node.lookup(PDFName.of("Contents"));
        const changedRefs =
          changedContents instanceof PDFArray
            ? changedContents.asArray()
            : [changedContents];
        expect(
          changedRefs.map((ref) =>
            Buffer.from(
              (decoded.context.lookup(ref) as import("pdf-lib").PDFRawStream)
                .contents,
            ),
          ),
        ).toEqual(originals);
        await expect(verifyPdf(changed, surfaces, [png])).rejects.toThrow(
          "ARTIFACT_INVALID",
        );
      },
    );
    it("keeps an ambiguous rejected PUT recoverable when the remote write completes after initial cleanup", async () => {
      const job = await accept({ ...options, dpi: 72 }),
        held = await lease(job.jobId),
        put = objects.put.bind(objects);
      let remoteCommit!: () => Promise<void>, locator: any;
      objects.put = async (value, bytes) => {
        locator = value;
        const copy = Uint8Array.from(bytes);
        remoteCommit = () => put(value, copy);
        throw Error("CLIENT_TIMEOUT_BEFORE_REMOTE_COMMIT");
      };
      await worker.renderExportJob(held, new AbortController().signal);
      const [stage] = await rows(
        "SELECT * FROM outbox WHERE aggregate_id=$1 AND event_type='export.staged'",
        [job.jobId],
      );
      expect(stage.payload.putSettled).toBe(false);
      expect(stage.sent_at).toBeNull();
      await worker.recoverStagedArtifacts(100, job.jobId);
      expect(
        (await rows("SELECT sent_at FROM outbox WHERE id=$1", [stage.id]))[0]
          .sent_at,
      ).toBeNull();
      await remoteCommit();
      expect(await objects.read(locator)).toBeTruthy();
      await worker.recoverStagedArtifacts(100, job.jobId);
      expect(await objects.read(locator)).toBeTruthy();
      expect(
        (await rows("SELECT sent_at FROM outbox WHERE id=$1", [stage.id]))[0]
          .sent_at,
      ).toBeNull();
      await rows(
        "UPDATE outbox SET payload=jsonb_set(payload,'{unsettledUntil}',to_jsonb((clock_timestamp()-interval '1 second')::text)) WHERE id=$1",
        [stage.id],
      );
      await worker.recoverStagedArtifacts(100, job.jobId);
      await expect(objects.read(locator)).rejects.toThrow();
      expect(
        (await rows("SELECT sent_at FROM outbox WHERE id=$1", [stage.id]))[0]
          .sent_at,
      ).not.toBeNull();
      expect(
        (await rows("SELECT state FROM jobs WHERE id=$1", [job.jobId]))[0]
          .state,
      ).toBe("failed");
    }, 180000);
  },
);
