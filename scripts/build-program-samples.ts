import { createServer } from "vite";
import { chromium } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const output = resolve("docs/export-samples/program-c1");
await mkdir(output, { recursive: true });
const server = await createServer({
  root: process.cwd(),
  publicDir: "apps/web/public",
  cacheDir: "node_modules/.vite-samples",
  server: { host: "127.0.0.1", port: 0 },
  optimizeDeps: {
    include: [
      "idb",
      "fflate",
      "ajv/dist/2020.js",
      "ajv-formats",
      "fontkit",
      "fabric",
      "pdf-lib",
    ],
  },
});
await server.listen();
const address = server.httpServer!.address();
if (!address || typeof address === "string") throw new Error("host");
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
try {
  const page = await browser.newPage({
    locale: "zh-CN",
    timezoneId: "UTC",
    deviceScaleFactor: 1,
  });
  await page.goto(
    `http://127.0.0.1:${address.port}/tests/browser/harness/preflight.html`,
  );
  const result = await page.evaluate(async () => {
    const ap = "/packages/assets/src/index.ts",
      dp = "/packages/document/src/index.ts",
      sp = "/packages/storage/src/index.ts",
      ep = "/packages/export/src/index.ts",
      a = await import(ap),
      d = await import(dp),
      s = await import(sp),
      e = await import(ep),
      signal = new AbortController().signal;
    const store = new s.IndexedDbRevisionStore("program-c1-build");
    const catalog = await (await fetch("/fonts/manifest.json")).json(),
      font = catalog.fonts.find((f: any) => f.id === "noto-sans-sc");
    const faces = new Map<string, Uint8Array>();
    for (const face of font.faces)
      faces.set(
        face.id,
        new Uint8Array(await (await fetch(face.file)).arrayBuffer()),
      );
    await store.putFont(font, faces);
    const photos: import("@album/assets").AssetRecord[] = [];
    for (let scene = 0; scene < 2; scene++) {
      const c = document.createElement("canvas");
      c.width = 3200;
      c.height = 2400;
      const ctx = c.getContext("2d")!,
        g = ctx.createLinearGradient(0, 0, 0, 2400);
      g.addColorStop(0, scene ? "#d7a078" : "#b9cfca");
      g.addColorStop(1, scene ? "#f3dfb9" : "#eef0dc");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, 3200, 2400);
      ctx.fillStyle = scene ? "#f7e1b2" : "#f7f1cf";
      ctx.beginPath();
      ctx.arc(2400, 600, 230, 0, Math.PI * 2);
      ctx.fill();
      for (let range = 0; range < 4; range++) {
        ctx.fillStyle = scene
          ? ["#c79c85", "#b78879", "#866d68", "#4f6560"][range]
          : ["#a4bab1", "#829f97", "#5a817b", "#315e5b"][range];
        ctx.beginPath();
        ctx.moveTo(0, 1700 + range * 170);
        for (let x = 0; x <= 3200; x += 160)
          ctx.lineTo(
            x,
            1150 + range * 230 + Math.sin(x / 420 + range + scene) * 230,
          );
        ctx.lineTo(3200, 2400);
        ctx.lineTo(0, 2400);
        ctx.fill();
      }
      const blob = await new Promise<Blob>((r) =>
        c.toBlob((b) => r(b!), "image/png"),
      );
      const photo = await a.importImage(
        new File([blob], `original-landscape-${scene + 1}.png`, {
          type: "image/png",
        }),
        signal,
      );
      await store.putAsset(photo.record, photo);
      photos.push(photo.record);
      c.width = c.height = 0;
    }
    let sequence = 0;
    const template = d.templateVersions[0],
      bindings = Object.fromEntries(
        template.slots
          .filter((slot: any) => slot.kind === "image")
          .map((slot: any, i: number) => [slot.slotId, photos[i % 2].id]),
      );
    const spreads = [0, 1].map((index) => {
      const layers = d.instantiateTemplate(
        template,
        bindings,
        () => `sample_layer_${++sequence}`,
      );
      for (const layer of layers)
        if (layer.type === "text") {
          layer.width = 900;
          layer.text =
            layer.fontSize > 30
              ? index
                ? "行过山河"
                : "山河之间"
              : "2026 · 原创程序样片";
          layer.fill = "#244c47";
        }
      return {
        id: `sample_spread_${index + 1}`,
        background: "#faf7ef",
        templateRef: d.templateRefs[0],
        layers,
      };
    });
    const text = structuredClone(
      spreads[0].layers.find((l: any) => l.type === "text"),
    );
    text.id = "sample_cover_title";
    text.x = 100;
    text.y = 400;
    text.width = 900;
    text.text = "山河之间";
    text.fontSize = 72;
    text.height = 150;
    const doc = d.parseDocument({
      schemaVersion: 1,
      projectId: "project_program_c1",
      revision: 12,
      unit: "px96",
      colorSpace: "srgb",
      pageSize: template.pageSize,
      printProfile: { bleedMm: 3, safeMm: 5 },
      cover: { front: [text], back: [] },
      spreads,
    });
    const resources = { assets: photos, fonts: [font] },
      docHash = await d.hashDocument(doc);
    const bundle = await s.exportDraftProject(doc, resources, store);
    const snapshots = [];
    for (const format of ["png", "jpeg", "pdf"]) {
      const view = format === "pdf" ? "singlePage" : "spread",
        includeCover = format === "pdf",
        options = {
          format,
          dpi: 300,
          view,
          pageIds:
            format === "pdf"
              ? e.allSurfaceIds(doc, view, includeCover)
              : ["sample_spread_1"],
          includeCover,
          bleedMm: 3,
          jpegMatte: "#ffffff",
        };
      const snap = await e.freezeSnapshot(
        { doc, docHash, resources, savedAt: "2026-10-22T00:00:00Z" },
        options,
        "2026-10-22T00:00:00Z",
      );
      const report = await e.preflight(snap, store, signal, {
        templateRefs: d.templateRefs,
      });
      if (report.blockers.length || report.warnings.length)
        throw new Error(JSON.stringify(report));
      snapshots.push({ format, snapshot: snap });
    }
    return { bundle: Array.from(bundle as Uint8Array), snapshots, doc };
  });
  await writeFile(
    resolve(output, "project.zip"),
    new Uint8Array(result.bundle),
  );
  for (const { format, snapshot } of result.snapshots)
    await writeFile(
      resolve(output, `snapshot-${format}.json`),
      JSON.stringify(snapshot, null, 2),
    );
  await writeFile(
    resolve(output, "document.json"),
    JSON.stringify(result.doc, null, 2),
  );
  console.log(
    "Created trusted project bundle and three immutable sample snapshots.",
  );
} finally {
  await browser.close();
  await server.close();
}
