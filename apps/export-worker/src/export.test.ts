import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
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
import { ExportWorker, CliRenderer } from "./render-job";
import { JobRepository, type JobLease } from "@album/jobs";
import { digest, id, type Actor } from "@album/server-core";
import {
  preflight,
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
        expect(
          (await rows("SELECT state FROM jobs WHERE id=$1", [job.jobId]))[0]
            .state,
        ).toBe("succeeded");
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
  },
);
