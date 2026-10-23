import {
  readFile,
  writeFile,
  mkdir,
  mkdtemp,
  rm,
  appendFile,
  rename,
  readdir,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { release } from "node:os";
import { createHash } from "node:crypto";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { readProjectZip, assertManifest } from "@album/storage";
import {
  canonicalJson,
  sha256,
  hashDocument,
  parseDocument,
} from "@album/document";
import {
  planSurfaces,
  MAX_ENCODED_BYTES,
  type ExportSnapshot,
} from "@album/export";
import { startHost } from "./host";
async function main() {
  const { values } = parseArgs({
    options: {
      bundle: { type: "string" },
      snapshot: { type: "string" },
      output: { type: "string" },
      acknowledgements: { type: "string" },
    },
  });
  if (!values.bundle || !values.snapshot || !values.output)
    throw new Error("ARGUMENTS: --bundle --snapshot --output are required");
  const files = readProjectZip(new Uint8Array(await readFile(values.bundle))),
    snapshot = JSON.parse(
      await readFile(values.snapshot, "utf8"),
    ) as ExportSnapshot,
    manifest = JSON.parse(new TextDecoder().decode(files.get("manifest.json"))),
    doc = parseDocument(
      JSON.parse(new TextDecoder().decode(files.get("document.json"))),
    );
  assertManifest(manifest.resources);
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== files.size - 1 ||
    new Set(manifest.files.map((f: any) => f.path)).size !==
      manifest.files.length
  )
    throw new Error("INVALID_PROJECT_MANIFEST");
  for (const f of manifest.files) {
    const bytes = files.get(f.path);
    if (
      f.path === "manifest.json" ||
      !bytes ||
      bytes.length !== f.bytes ||
      (await sha256(bytes)) !== f.sha256
    )
      throw new Error("HASH_MISMATCH");
  }
  if (
    (await hashDocument(doc)) !== manifest.docHash ||
    manifest.docHash !== snapshot.docHash ||
    canonicalJson(manifest.resources) !== canonicalJson(snapshot.resources)
  )
    throw new Error("SNAPSHOT_BUNDLE_MISMATCH");
  const ack = values.acknowledgements
    ? JSON.parse(await readFile(values.acknowledgements, "utf8"))
    : undefined;
  if (
    ack &&
    (ack.snapshotHash !== snapshot.snapshotHash ||
      !Array.isArray(ack.warningIds) ||
      ack.warningIds.some((id: unknown) => typeof id !== "string"))
  )
    throw new Error("INVALID_ACKNOWLEDGEMENTS");
  const acknowledgedWarningIds: string[] = ack?.warningIds ?? [];
  const blobs = new Map<string, Uint8Array>();
  for (const [path, bytes] of files)
    if (/^resources\/[0-9a-f]{64}\.bin$/.test(path)) {
      const hash = path.slice(10, -4);
      if ((await sha256(bytes)) !== hash) throw new Error("HASH_MISMATCH");
      blobs.set(hash, bytes);
    }
  const expected = new Set(
      snapshot.options.format === "pdf"
        ? [`album-r${snapshot.revision}.pdf`]
        : planSurfaces(snapshot).map(
            (s) =>
              s.fileStem +
              (snapshot.options.format === "jpeg" ? ".jpg" : ".png"),
          ),
    ),
    completed = new Map<string, string>(),
    hashes = new Map<string, ReturnType<typeof createHash>>();
  let total = 0;
  const output = resolve(values.output);
  await mkdir(output, { recursive: true });
  const staging = await mkdtemp(join(output, ".album-staging-"));
  let host: Awaited<ReturnType<typeof startHost>> | undefined;
  let browser;
  const started = Date.now();
  try {
    host = await startHost(resolve("apps/web/dist"), snapshot.resources, blobs);
    const trustedHost = host;
    browser = await chromium.launch({
      executablePath: process.env.CHROMIUM_PATH || undefined,
    });
    const context = await browser.newContext({
      locale: "zh-CN",
      timezoneId: "UTC",
      deviceScaleFactor: 1,
    });
    await context.route("**/*", (route) => {
      const url = new URL(route.request().url()),
        trusted = new URL(trustedHost.url);
      return url.protocol === "blob:" ||
        (url.origin === trusted.origin &&
          url.pathname.startsWith(trustedHost.prefix))
        ? route.continue()
        : route.abort("blockedbyclient");
    });
    const page = await context.newPage();
    page.setDefaultTimeout(120000);
    await page.exposeFunction(
      "__albumArtifactChunk",
      async (chunk: {
        filename: string;
        base64: string;
        final: boolean;
        sha256: string;
      }) => {
        if (
          !expected.has(chunk.filename) ||
          completed.has(chunk.filename) ||
          !chunk.base64 ||
          chunk.base64.length > 65536 ||
          !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk.base64)
        )
          throw new Error("INVALID_ARTIFACT_CHUNK");
        const bytes = Buffer.from(chunk.base64, "base64");
        total += bytes.length;
        if (total > MAX_ENCODED_BYTES) throw new Error("DOWNLOAD_TOO_LARGE");
        if (!hashes.has(chunk.filename))
          hashes.set(chunk.filename, createHash("sha256"));
        hashes.get(chunk.filename)!.update(bytes);
        await appendFile(join(staging, chunk.filename), bytes);
        if (chunk.final) {
          const actual = hashes.get(chunk.filename)!.digest("hex");
          if (actual !== chunk.sha256)
            throw new Error("ARTIFACT_HASH_MISMATCH");
          completed.set(chunk.filename, actual);
        }
      },
    );
    await page.goto(trustedHost.url);
    await page.waitForFunction(
      () => typeof window.renderSnapshot === "function",
    );
    const result = await Promise.race([
      page.evaluate((request) => window.renderSnapshot(request), {
        snapshot,
        acknowledgedWarningIds,
      }),
      new Promise<never>((_, reject) => {
        const timer = setTimeout(
          () => reject(new Error("RENDER_TIMEOUT")),
          120000,
        );
        timer.unref();
      }),
    ]);
    if (
      completed.size !== expected.size ||
      result.manifest.files.length !== expected.size ||
      result.manifest.files.some((f) => completed.get(f.filename) !== f.sha256)
    )
      throw new Error("ARTIFACT_INCOMPLETE");

    for (const filename of expected)
      await rename(join(staging, filename), join(output, filename));
    await writeFile(
      join(output, "manifest.json"),
      JSON.stringify(result.manifest, null, 2),
    );
    await writeFile(
      join(output, "preflight.json"),
      JSON.stringify(result.report, null, 2),
    );
    await writeFile(
      join(output, "environment.json"),
      JSON.stringify(
        {
          node: process.version,
          browser: browser.version(),
          platform: process.platform,
          osRelease: release(),
          fontCatalogSha256: await sha256(
            new Uint8Array(
              await readFile("apps/web/public/fonts/manifest.json"),
            ),
          ),
          filterManifestSha256: await sha256(
            new Uint8Array(
              await readFile("packages/render/manifests/filters-v1.json"),
            ),
          ),
          buildFiles: await Promise.all(
            (await readdir("apps/web/dist/assets"))
              .sort()
              .map(async (name) => ({
                name,
                sha256: await sha256(
                  new Uint8Array(
                    await readFile(join("apps/web/dist/assets", name)),
                  ),
                ),
              })),
          ),
          locale: "zh-CN",
          timezone: "UTC",
          deviceScaleFactor: 1,
          elapsedMs: Date.now() - started,
          nodeProcessPeakRssBytes: process.resourceUsage().maxRSS * 1024,
          lockSha256: await sha256(
            new Uint8Array(await readFile("package-lock.json")),
          ),
        },
        null,
        2,
      ),
    );
    console.log(`Rendered ${completed.size} file(s) to ${output}`);
  } finally {
    await browser?.close();
    await host?.close();
    await rm(staging, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(String(error));
  process.exitCode = /ARGUMENTS|INVALID_|PREFLIGHT|SNAPSHOT_|WARNINGS_/.test(
    String(error),
  )
    ? 2
    : 3;
});
