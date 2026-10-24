import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  persistStage,
  markPutSettled,
  recoverStagedArtifacts,
} from "./staged-cleanup";
import { verifyPdf, type PdfBrand } from "./pdf-validation";
export { verifyPdf } from "./pdf-validation";
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFNumber,
} from "pdf-lib";
import { canonicalJson } from "@album/document";
import { exportDraftProject } from "@album/storage";
import {
  freezeSnapshot,
  planSurfaces,
  MAX_ENCODED_BYTES,
  type ExportSnapshot,
  type SurfaceSpec,
} from "@album/export";
import { digest, fail, id, type Database } from "@album/server-core";
import { JobRepository, type JobLease } from "@album/jobs";
import type {
  ObjectStore,
  StorageConfig,
  StorageLocator,
} from "../../api/src/assets/types";
import type {
  FrozenExport,
  PinnedResource,
  RendererIdentity,
} from "../../api/src/exports/service";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
export type RenderedArtifact = {
  filename: string;
  mime: string;
  bytes: Uint8Array;
  sha256: string;
  width?: number;
  height?: number;
};
export interface RenderPort {
  render(
    frozen: FrozenExport,
    ack: string[],
    signal: AbortSignal,
  ): Promise<RenderedArtifact[]> | AsyncIterable<RenderedArtifact>;
}
export type ProcessLimits = { memoryBytes: number; timeoutMs?: number };
/** Linux process-tree budget includes Chromium children. A killed attempt is never retried as an OOM. */
export async function runBoundedNode(
  script: string,
  args: string[],
  signal: AbortSignal,
  limits: ProcessLimits,
  env: NodeJS.ProcessEnv = {},
  protocol?: (
    message: any,
    send: (message: unknown) => Promise<void>,
  ) => Promise<void>,
): Promise<void> {
  signal.throwIfAborted();
  if (
    !Number.isSafeInteger(limits.memoryBytes) ||
    limits.memoryBytes < 256 * 1024 ** 2 ||
    limits.memoryBytes > 2 * 1024 ** 3
  )
    fail("INVALID_MEMORY_BUDGET");
  const detached = process.env.ALBUM_SUPERVISED_ATTEMPT !== "1";
  const child = spawn(
    process.execPath,
    ["--max-old-space-size=1536", "--import", "tsx", script, ...args],
    {
      cwd: repoRoot,
      detached,
      serialization: "advanced",
      env: { ...process.env, ...env },
      stdio: protocol
        ? ["ignore", "pipe", "pipe", "ipc"]
        : ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "",
    failure: Error | undefined,
    polling = false;
  const kill = (error: Error) => {
    failure ??= error;
    if (child.pid) {
      try {
        if (detached) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    }
  };
  if (protocol)
    child.on("message", (message) => {
      void protocol(
        message,
        (value) =>
          new Promise<void>((resolve, reject) =>
            child.send!(value as any, (error) =>
              error ? reject(error) : resolve(),
            ),
          ),
      ).catch((error) =>
        kill(error instanceof Error ? error : new Error("RENDER_FAILED")),
      );
    });
  const abort = () => kill(new Error("RENDER_ABORTED"));
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  child.stdout!.resume();
  child.stderr!.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-4096);
  });
  const timeout = setTimeout(
    () => kill(new Error("RENDER_TIMEOUT")),
    limits.timeoutMs ?? 180000,
  );
  timeout.unref();
  const timer = setInterval(async () => {
    if (polling || !child.pid) return;
    polling = true;
    try {
      const stats = await Promise.all(
        (await readdir("/proc"))
          .filter((p) => /^\d+$/.test(p))
          .map(async (p) => {
            try {
              const raw = await readFile("/proc/" + p + "/stat", "utf8"),
                s = raw.slice(raw.lastIndexOf(")") + 2).split(" ");
              return {
                pid: Number(p),
                ppid: Number(s[1]),
                group: Number(s[2]),
                rss: Number(s[21]) * 4096,
              };
            } catch {
              return undefined;
            }
          }),
      );
      const descendants = new Set([child.pid]);
      let changed = true;
      while (changed) {
        changed = false;
        for (const s of stats)
          if (
            s &&
            !descendants.has(s.pid) &&
            (descendants.has(s.ppid) || s.group === child.pid)
          ) {
            descendants.add(s.pid);
            changed = true;
          }
      }
      const rss = stats.reduce(
        (n, s) => n + (s && descendants.has(s.pid) ? s.rss : 0),
        0,
      );
      if (rss + process.memoryUsage().rss > limits.memoryBytes)
        kill(new Error("RESOURCE_EXHAUSTED"));
    } catch {
      kill(new Error("WORKER_BUDGET_UNAVAILABLE"));
    } finally {
      polling = false;
    }
  }, 100);
  timer.unref();
  try {
    await new Promise<void>((ok, reject) => {
      child.once("error", () => reject(new Error("RENDER_UNAVAILABLE")));
      child.once("close", (code) => {
        if (failure) reject(failure);
        else if (code === 0) ok();
        else
          reject(
            new Error(
              /heap out of memory|out of memory/i.test(stderr)
                ? "RESOURCE_EXHAUSTED"
                : /PREFLIGHT_BLOCKED/.test(stderr)
                  ? "PREFLIGHT_BLOCKED"
                  : /WARNINGS_UNACKNOWLEDGED/.test(stderr)
                    ? "WARNINGS_UNACKNOWLEDGED"
                    : "RENDER_FAILED",
            ),
          );
      });
    });
  } finally {
    clearInterval(timer);
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
    if (detached && child.pid) {
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }
  }
}

export async function pinnedBlobs(
  objects: ObjectStore,
  pins: PinnedResource[],
  signal: AbortSignal,
) {
  const blobs = new Map<string, Uint8Array>();
  let total = 0;
  for (const pin of pins) {
    signal.throwIfAborted();
    if (blobs.has(pin.locator.sha256)) continue;
    const bytes = await objects.read(pin.locator);
    if (bytes.length !== pin.bytes || digest(bytes) !== pin.locator.sha256)
      fail("RESOURCE_HASH_MISMATCH");
    total += bytes.length;
    if (total > 512 * 1024 ** 2) fail("RESOURCE_EXHAUSTED");
    blobs.set(pin.locator.sha256, bytes);
  }
  return blobs;
}

/** Decode the entire image, then check density and sRGB dimensions against the planned face. */
async function verifyRaster(
  bytes: Uint8Array,
  surface: SurfaceSpec,
  dpi: number,
  format: "png" | "jpeg",
) {
  const meta = await sharp(bytes, { limitInputPixels: 50_000_000 }).metadata();
  if (
    meta.format !== format ||
    meta.width !== surface.pixelWidth ||
    meta.height !== surface.pixelHeight ||
    meta.space !== "srgb" ||
    (meta.pages && meta.pages !== 1) ||
    Math.abs((meta.density ?? 0) - dpi) > 0.05
  )
    fail("ARTIFACT_INVALID");
  const { info } = await sharp(bytes, { limitInputPixels: 50_000_000 })
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== surface.pixelWidth || info.height !== surface.pixelHeight)
    fail("ARTIFACT_INVALID");
}
async function brandRaster(width: number) {
  const font = Math.max(12, Math.round(width / 55)),
    w = Math.max(180, Math.round(font * 8)),
    h = font * 2;
  const svg = Buffer.from(
    `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#fff" fill-opacity="0.65"/><text x="10" y="${Math.round(font * 1.4)}" font-family="sans-serif" font-size="${font}" fill="#555">Album</text></svg>`,
  );
  return sharp(svg).png().toBuffer();
}

async function watermark(
  bytes: Uint8Array,
  format: "png" | "jpeg" | "pdf",
  surfaces: SurfaceSpec[],
  dpi: number,
  quality: number,
) {
  if (format === "pdf") {
    const pdf = await PDFDocument.load(bytes);
    for (const [i, page] of pdf.getPages().entries()) {
      const png = await brandRaster(surfaces[i].pixelWidth),
        image = await pdf.embedPng(png);
      const w = Math.min(page.getWidth() / 4, (image.width * 72) / dpi),
        h = (w * image.height) / image.width;
      page.drawImage(image, {
        x: page.getWidth() - w - 6,
        y: 6,
        width: w,
        height: h,
      });
    }
    return new Uint8Array(await pdf.save());
  }
  const overlay = await brandRaster(surfaces[0].pixelWidth);
  const output = sharp(bytes)
    .composite([{ input: overlay, gravity: "southeast" }])
    .withMetadata({ density: dpi });
  return new Uint8Array(
    await (
      format === "png"
        ? output.png()
        : output.jpeg({ quality: Math.round(quality * 100) })
    ).toBuffer(),
  );
}

export { CliRenderer } from "./isolated-renderer";
export class LocalCliRenderer implements RenderPort {
  constructor(
    private options: { objects: ObjectStore; chromiumPath?: string },
  ) {}
  async render(
    frozen: FrozenExport,
    ack: string[],
    signal: AbortSignal,
  ): Promise<RenderedArtifact[]> {
    const snapshot = frozen.snapshot,
      surfaces = planSurfaces(snapshot);
    if (surfaces.some((s) => s.pixelWidth * s.pixelHeight > 50_000_000))
      fail("PIXEL_BUDGET");
    const dir = await mkdtemp(join(tmpdir(), "album-export-"));
    try {
      const blobs = await pinnedBlobs(
        this.options.objects,
        frozen.pins,
        signal,
      );
      const bundle = await exportDraftProject(
        snapshot.doc,
        snapshot.resources,
        {
          read: async (resourceId, variant) => {
            const hash =
              variant === "font"
                ? snapshot.resources.fonts
                    .flatMap((f) => f.faces)
                    .find((f) => f.id === resourceId)?.sha256
                : snapshot.resources.assets.find((a) => a.id === resourceId)
                    ?.variants[variant]?.sha256;
            const b = hash && blobs.get(hash);
            if (!b) fail("RESOURCE_NOT_IN_SNAPSHOT");
            return b;
          },
        },
      );
      const bundlePath = join(dir, "input.album"),
        snapshotPath = join(dir, "snapshot.json"),
        ackPath = join(dir, "ack.json"),
        output = join(dir, "output");
      await writeFile(bundlePath, bundle, { mode: 0o600 });
      await writeFile(snapshotPath, JSON.stringify(snapshot), { mode: 0o600 });
      await writeFile(
        ackPath,
        JSON.stringify({
          snapshotHash: snapshot.snapshotHash,
          warningIds: ack,
        }),
        { mode: 0o600 },
      );
      await runBoundedNode(
        "apps/render-cli/src/main.ts",
        [
          "--bundle",
          bundlePath,
          "--snapshot",
          snapshotPath,
          "--output",
          output,
          "--acknowledgements",
          ackPath,
        ],
        signal,
        {
          memoryBytes:
            Math.min(2048, frozen.policy.workerBudgetMiB) * 1024 ** 2,
        },
        {
          CHROMIUM_PATH: this.options.chromiumPath ?? process.env.CHROMIUM_PATH,
        },
      );
      signal.throwIfAborted();
      const manifest = JSON.parse(
        await readFile(join(output, "manifest.json"), "utf8"),
      );
      if (
        manifest.renderBuild !== frozen.renderer.version ||
        manifest.projectId !== snapshot.projectId ||
        manifest.revision !== snapshot.revision ||
        manifest.snapshotHash !== snapshot.snapshotHash ||
        manifest.docHash !== snapshot.docHash ||
        canonicalJson(manifest.surfaces) !== canonicalJson(surfaces) ||
        canonicalJson(manifest.options) !== canonicalJson(snapshot.options)
      )
        fail("ARTIFACT_MANIFEST_MISMATCH");
      const format = snapshot.options.format,
        expected =
          format === "pdf"
            ? [`album-r${snapshot.revision}.pdf`]
            : surfaces.map(
                (s) => s.fileStem + (format === "jpeg" ? ".jpg" : ".png"),
              );
      if (
        manifest.files.length !== expected.length ||
        manifest.files.some((f: any, i: number) => f.filename !== expected[i])
      )
        fail("ARTIFACT_ORDER_MISMATCH");
      let pdfReferences: Uint8Array[] | undefined;
      let pdfBrands: PdfBrand[] | undefined;
      if (format === "pdf") {
        const reference = await freezeSnapshot(
          {
            doc: snapshot.doc,
            docHash: snapshot.docHash,
            resources: snapshot.resources,
            savedAt: snapshot.createdAt,
          },
          { ...snapshot.options, format: "png" },
          snapshot.createdAt,
        );
        const referencePath = join(dir, "reference.json"),
          referenceAck = join(dir, "reference-ack.json"),
          referenceOutput = join(dir, "references");
        await writeFile(referencePath, JSON.stringify(reference));
        await writeFile(
          referenceAck,
          JSON.stringify({
            snapshotHash: reference.snapshotHash,
            warningIds: ack,
          }),
        );
        await runBoundedNode(
          "apps/render-cli/src/main.ts",
          [
            "--bundle",
            bundlePath,
            "--snapshot",
            referencePath,
            "--output",
            referenceOutput,
            "--acknowledgements",
            referenceAck,
          ],
          signal,
          {
            memoryBytes:
              Math.min(2048, frozen.policy.workerBudgetMiB) * 1024 ** 2,
          },
          {
            CHROMIUM_PATH:
              this.options.chromiumPath ?? process.env.CHROMIUM_PATH,
          },
        );
        pdfReferences = [];
        for (const surface of surfaces) {
          const png = await readFile(
            join(referenceOutput, surface.fileStem + ".png"),
          );
          await verifyRaster(png, surface, snapshot.options.dpi, "png");
          pdfReferences.push(png);
        }
        if (frozen.entitlements.brandWatermark) {
          pdfBrands = [];
          for (const s of surfaces) {
            const pixels = await brandRaster(s.pixelWidth),
              meta = await sharp(pixels).metadata(),
              pageWidth = ((s.trimWidthMm + 2 * s.bleedMm) * 72) / 25.4;
            const width = Math.min(
                pageWidth / 4,
                (meta.width! * 72) / snapshot.options.dpi,
              ),
              height = (width * meta.height!) / meta.width!;
            pdfBrands.push({
              pixels,
              width,
              height,
              x: pageWidth - width - 6,
              y: 6,
            });
          }
        }
      }
      const result: RenderedArtifact[] = [];
      let total = 0;
      for (const [index, file] of manifest.files.entries()) {
        signal.throwIfAborted();
        if (!/^[A-Za-z0-9_.-]+$/.test(file.filename))
          fail("UNSAFE_ARTIFACT_PATH");
        let bytes: Uint8Array = await readFile(join(output, file.filename));
        if (bytes.length !== file.byteLength || digest(bytes) !== file.sha256)
          fail("ARTIFACT_HASH_MISMATCH");
        if (format === "pdf") await verifyPdf(bytes, surfaces, pdfReferences);
        else
          await verifyRaster(
            bytes,
            surfaces[index],
            snapshot.options.dpi,
            format,
          );
        if (frozen.entitlements.brandWatermark) {
          bytes = await watermark(
            bytes,
            format,
            format === "pdf" ? surfaces : [surfaces[index]],
            snapshot.options.dpi,
            frozen.policy.jpegQuality,
          );
          if (format === "pdf")
            await verifyPdf(bytes, surfaces, pdfReferences, pdfBrands);
          else
            await verifyRaster(
              bytes,
              surfaces[index],
              snapshot.options.dpi,
              format,
            );
        }
        if (
          format === "jpeg" &&
          !frozen.entitlements.brandWatermark &&
          frozen.policy.jpegQuality !== 0.95
        ) {
          bytes = new Uint8Array(
            await sharp(bytes)
              .withMetadata({ density: snapshot.options.dpi })
              .jpeg({ quality: Math.round(frozen.policy.jpegQuality * 100) })
              .toBuffer(),
          );
          await verifyRaster(
            bytes,
            surfaces[index],
            snapshot.options.dpi,
            format,
          );
        }
        total += bytes.length;
        if (total > Math.min(MAX_ENCODED_BYTES, frozen.reservedBytes))
          fail("STORAGE_QUOTA");
        result.push({
          filename: file.filename,
          mime: format === "pdf" ? "application/pdf" : "image/" + format,
          bytes,
          sha256: digest(bytes),
          ...(format === "pdf"
            ? {}
            : {
                width: surfaces[index].pixelWidth,
                height: surfaces[index].pixelHeight,
              }),
        });
      }
      return result;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}

export class ExportWorker {
  constructor(
    private deps: {
      db: Database;
      jobs: JobRepository;
      objects: ObjectStore;
      storage: StorageConfig;
      renderer: RenderPort;
      identity: RendererIdentity;
    },
  ) {}
  recoverStagedArtifacts(limit = 100, jobId?: string) {
    return recoverStagedArtifacts(
      this.deps.db,
      this.deps.objects,
      limit,
      jobId,
    );
  }
  private async load(lease: JobLease) {
    return this.deps.db.transaction(async (tx) => {
      const row = (
        await tx.query(
          "SELECT s.*,j.state,j.fence,j.lease_owner,j.lease_expires_at FROM jobs j JOIN job_snapshots s ON s.workspace_id=j.workspace_id AND s.id=j.snapshot_id WHERE j.workspace_id=$1 AND j.id=$2 AND j.kind='export' AND j.fence=$3 AND j.lease_owner=$4 AND j.lease_expires_at>clock_timestamp()",
          [
            lease.job.workspaceId,
            lease.job.jobId,
            lease.fence,
            lease.leaseOwner,
          ],
        )
      ).rows[0];
      if (!row) return;
      if (row.state === "cancel_requested") return { cancelled: true as const };
      if (!["running", "packaging"].includes(row.state)) return;
      const frozen = row.manifest as FrozenExport;
      if (
        digest(canonicalJson(frozen)) !== row.manifest_hash ||
        frozen.schemaVersion !== 1 ||
        canonicalJson(frozen.renderer) !== canonicalJson(this.deps.identity) ||
        row.renderer_version !== this.deps.identity.version ||
        row.renderer_image_digest !== this.deps.identity.imageDigest ||
        canonicalJson(row.entitlement_snapshot) !==
          canonicalJson(frozen.entitlements)
      )
        fail("EXPORT_SNAPSHOT_CORRUPT");
      const verified = await freezeSnapshot(
        {
          doc: frozen.snapshot.doc,
          docHash: frozen.snapshot.docHash,
          resources: frozen.snapshot.resources,
          savedAt: frozen.snapshot.createdAt,
        },
        frozen.snapshot.options,
        frozen.snapshot.createdAt,
      );
      if (verified.snapshotHash !== frozen.snapshot.snapshotHash)
        fail("EXPORT_SNAPSHOT_CORRUPT");
      const pins = (
        await tx.query(
          "SELECT storage_workspace_id,storage_object_id FROM resource_pins WHERE workspace_id=$1 AND job_id=$2 AND released_at IS NULL",
          [lease.job.workspaceId, lease.job.jobId],
        )
      ).rows;
      if (
        pins.length !== frozen.pins.length ||
        frozen.pins.some(
          (p) =>
            !pins.some(
              (r) =>
                r.storage_workspace_id === p.workspaceId &&
                r.storage_object_id === p.objectId,
            ),
        )
      )
        fail("EXPORT_SNAPSHOT_CORRUPT");
      return {
        cancelled: false as const,
        frozen,
        ack: row.warnings_acknowledged as string[],
      };
    });
  }
  async renderExportJob(lease: JobLease, signal: AbortSignal): Promise<void> {
    let committed = false;
    try {
      const input = await this.load(lease);
      if (!input) return;
      if (input.cancelled) {
        await this.deps.jobs.finishJob(lease, {
          state: "cancelled",
          result: {},
        });
        return;
      }
      signal.throwIfAborted();
      const artifacts = await this.deps.renderer.render(
        input.frozen,
        input.ack,
        signal,
      );
      const storage = input.frozen.outputStorage;
      if (
        !storage.basePrefix ||
        /[%\\\p{Cc}]|(^|\/)\.\.?($|\/)|^\//u.test(storage.basePrefix)
      )
        fail("STORAGE_UNCONFIGURED");
      const pending: {
        artifact: Omit<RenderedArtifact, "bytes"> & { byteLength: number };
        locator: StorageLocator;
        objectId: string;
        artifactId: string;
      }[] = [];
      for await (const artifact of artifacts) {
        signal.throwIfAborted();
        if (
          !/^[A-Za-z0-9_.-]+$/.test(artifact.filename) ||
          digest(artifact.bytes) !== artifact.sha256
        )
          fail("ARTIFACT_INVALID");
        const locator: StorageLocator = {
          storageProfileId: storage.storageProfileId,
          profileVersion: storage.profileVersion,
          bucket: storage.bucket,
          key:
            storage.basePrefix.replace(/\/$/, "") +
            "/" +
            lease.job.workspaceId +
            "/exports/" +
            lease.job.jobId +
            "/" +
            lease.fence +
            "/" +
            id() +
            "/" +
            artifact.filename,
          objectVersionId: null,
          sha256: artifact.sha256,
          variant: "export",
        };
        const objectId = id(),
          artifactId = id();
        const stageId = await persistStage(this.deps.db, lease, {
          objectId,
          artifactId,
          profileVersionId: storage.profileVersionId,
          locator,
          byteLength: artifact.bytes.length,
          mime: artifact.mime,
        });
        try {
          await this.deps.objects.put(locator, artifact.bytes);
        } finally {
          await markPutSettled(this.deps.db, stageId);
        }
        const head = await this.deps.objects.head(locator),
          downloaded = await this.deps.objects.read(locator);
        if (
          head.bytes !== artifact.bytes.length ||
          head.sha256 !== artifact.sha256 ||
          digest(downloaded) !== artifact.sha256 ||
          downloaded.length !== artifact.bytes.length
        )
          fail("ARTIFACT_STORAGE_MISMATCH");
        const { bytes, ...metadata } = artifact;
        pending.push({
          artifact: { ...metadata, byteLength: bytes.length },
          locator,
          objectId,
          artifactId,
        });
      }
      signal.throwIfAborted();
      committed = await this.deps.jobs.finishJob(
        lease,
        {
          state: "succeeded",
          result: { artifactIds: pending.map((p) => p.artifactId) },
        },
        async (tx) => {
          const profile = (
            await tx.query(
              "SELECT id FROM storage_profile_versions WHERE id=$1 AND profile_id=$2 AND version=$3 AND bucket=$4",
              [
                storage.profileVersionId,
                storage.storageProfileId,
                storage.profileVersion,
                storage.bucket,
              ],
            )
          ).rows[0];
          if (!profile) fail("STORAGE_UNCONFIGURED");
          for (const [
            index,
            { artifact, locator, objectId, artifactId },
          ] of pending.entries()) {
            await tx.query(
              "INSERT INTO storage_objects(id,workspace_id,profile_version_id,bucket,object_key,object_version_id,kind,sha256,byte_size,mime_type,state,verified_at) VALUES($1,$2,$3,$4,$5,$6,'export',$7,$8,$9,'verified',clock_timestamp())",
              [
                objectId,
                lease.job.workspaceId,
                storage.profileVersionId,
                locator.bucket,
                locator.key,
                locator.objectVersionId,
                artifact.sha256,
                artifact.byteLength,
                artifact.mime,
              ],
            );
            await tx.query(
              "INSERT INTO job_outputs(id,workspace_id,job_id,artifact_index,storage_object_id,committed_fence,format,sha256,byte_size,width,height,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now()+interval '7 days')",
              [
                artifactId,
                lease.job.workspaceId,
                lease.job.jobId,
                index,
                objectId,
                lease.fence,
                input.frozen.snapshot.options.format,
                artifact.sha256,
                artifact.byteLength,
                artifact.width ?? null,
                artifact.height ?? null,
              ],
            );
          }
        },
      );
      if (!committed)
        await this.deps.jobs.finishJob(lease, {
          state: "cancelled",
          result: {},
        });
    } catch (error) {
      const code = error instanceof Error ? error.message : "RENDER_FAILED";
      const cancelled = await this.deps.jobs.finishJob(lease, {
        state: "cancelled",
        result: {},
      });
      if (!cancelled)
        await this.deps.jobs.failAttempt(lease, {
          code: code === "RESOURCE_EXHAUSTED" ? "OOM" : "EXPORT_FAILED",
          retryable: false,
          definite: true,
        });
    } finally {
      // The intent survives COMMIT/DELETE/connection uncertainty and is retried by the runtime.
      try {
        await this.recoverStagedArtifacts(100, lease.job.jobId);
      } catch {
        /* Durable stage identity remains unsent for recovery. */
      }
    }
  }
}
