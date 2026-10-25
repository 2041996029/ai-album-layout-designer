import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "@playwright/test";
import { readProjectZip } from "@album/storage";
import { startHost } from "../../render-cli/src/host";
import type { ExportSnapshot } from "@album/export";
const { values } = parseArgs({
  options: {
    bundle: { type: "string" },
    request: { type: "string" },
    output: { type: "string" },
  },
});
if (!values.bundle || !values.request || !values.output)
  throw Error("ARGUMENTS_REQUIRED");
const request = JSON.parse(await readFile(values.request, "utf8")) as {
  snapshot: ExportSnapshot;
  ack?: string[];
};
const files = readProjectZip(await readFile(values.bundle)),
  blobs = new Map<string, Uint8Array>();
for (const [path, bytes] of files)
  if (/^resources\/[0-9a-f]{64}\.bin$/.test(path))
    blobs.set(path.slice(10, -4), bytes);
const host = await startHost(
  resolve("apps/export-worker/dist"),
  request.snapshot.resources,
  blobs,
);
let browser;
try {
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
      trusted = new URL(host.url);
    return url.protocol === "blob:" ||
      (url.origin === trusted.origin && url.pathname.startsWith(host.prefix))
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  const page = await context.newPage();
  await page.goto(host.url.replace("render.html", "preflight.html"));
  await page.waitForFunction(
    () => typeof window.albumCheckSnapshot === "function",
  );
  const report = await page.evaluate(
    (request) => window.albumCheckSnapshot(request),
    request,
  );
  await writeFile(values.output, JSON.stringify(report), { mode: 0o600 });
} catch (e) {
  console.error(String(e));
  process.exitCode = 3;
} finally {
  await browser?.close();
  await host.close();
}
