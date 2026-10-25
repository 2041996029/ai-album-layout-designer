import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { exportDraftProject } from "@album/storage";
import type { ExportSnapshot, PreflightReport } from "@album/export";
import { fail } from "@album/server-core";
import type { ObjectStore } from "../../api/src/assets/types";
import type {
  ExportPreflightPort,
  PinnedResource,
} from "../../api/src/exports/service";
import { pinnedBlobs, runBoundedNode } from "./render-job";
/** Browser-only C1 checks use a compiled private entry and a per-request allowlisted resource host. */
export class BrowserPreflight implements ExportPreflightPort {
  constructor(
    private options: { objects: ObjectStore; chromiumPath?: string },
  ) {}
  async check(
    snapshot: ExportSnapshot,
    pins: PinnedResource[],
    signal: AbortSignal,
    ack?: string[],
  ): Promise<PreflightReport> {
    const dir = await mkdtemp(join(tmpdir(), "album-preflight-"));
    try {
      const blobs = await pinnedBlobs(this.options.objects, pins, signal);
      const bundle = await exportDraftProject(
        snapshot.doc,
        snapshot.resources,
        {
          read: async (id, variant) => {
            const hash =
              variant === "font"
                ? snapshot.resources.fonts
                    .flatMap((f) => f.faces)
                    .find((f) => f.id === id)?.sha256
                : snapshot.resources.assets.find((a) => a.id === id)?.variants[
                    variant
                  ]?.sha256;
            const bytes = hash && blobs.get(hash);
            if (!bytes) fail("RESOURCE_NOT_IN_SNAPSHOT");
            return bytes;
          },
        },
      );
      const bundlePath = join(dir, "input.album"),
        requestPath = join(dir, "request.json"),
        outputPath = join(dir, "report.json");
      await writeFile(bundlePath, bundle, { mode: 0o600 });
      await writeFile(requestPath, JSON.stringify({ snapshot, ack }), {
        mode: 0o600,
      });
      await runBoundedNode(
        "apps/export-worker/src/preflight-cli.ts",
        [
          "--bundle",
          bundlePath,
          "--request",
          requestPath,
          "--output",
          outputPath,
        ],
        signal,
        { memoryBytes: 2 * 1024 ** 3, timeoutMs: 120000 },
        {
          CHROMIUM_PATH: this.options.chromiumPath ?? process.env.CHROMIUM_PATH,
        },
      );
      return JSON.parse(await readFile(outputPath, "utf8")) as PreflightReport;
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
