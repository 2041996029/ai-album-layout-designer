import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/documents/acceptance.json", import.meta.url),
    "utf8",
  ),
);
test("web core and trusted headless entry decode to identical pixels for the same snapshot", async ({
  page,
}) => {
  const chunks: string[] = [];
  await page.exposeFunction(
    "__albumArtifactChunk",
    async (chunk: { base64: string }) => {
      chunks.push(chunk.base64);
    },
  );
  await page.goto("/tests/browser/harness/render.html");
  await page.waitForFunction(() => typeof window.renderSnapshot === "function");
  const result = await page.evaluate(async (fixture) => {
    const ep = "/packages/export/src/index.ts",
      dp = "/packages/document/src/index.ts",
      e = await import(ep),
      d = await import(dp);
    fixture.revision = 12;
    fixture.pageSize = { width: 120, height: 100 };
    fixture.spreads[0].layers = [
      {
        id: "test_shape",
        type: "shape",
        shapeKind: "rectangle",
        x: 10,
        y: 20,
        width: 70,
        height: 50,
        rotation: 12,
        visible: true,
        locked: false,
        opacity: 1,
        fill: "#237b68",
        stroke: "#f0c080",
        strokeWidth: 3,
        radius: 4,
      },
    ];
    const snapshot = await e.freezeSnapshot(
        {
          doc: fixture,
          docHash: await d.hashDocument(fixture),
          resources: { assets: [], fonts: [] },
          savedAt: "2026-10-22T00:00:00Z",
        },
        {
          format: "png",
          dpi: 72,
          view: "spread",
          pageIds: ["spread_1"],
          includeCover: false,
          bleedMm: 3,
          jpegMatte: "#ffffff",
        },
        "2026-10-22T00:00:00Z",
      ),
      port = {
        read: async () => {
          throw new Error("unused");
        },
      },
      signal = new AbortController().signal,
      report = await e.preflight(snapshot, port, signal),
      files = [];
    for await (const f of e.runExport(snapshot, report, [], port, signal))
      files.push(f);
    fixture.revision = 13;
    const remote = await window.renderSnapshot({
      snapshot: JSON.parse(JSON.stringify(snapshot)),
    });
    async function pixels(bytes: Uint8Array) {
      const bitmap = await createImageBitmap(
          new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "image/png" }),
        ),
        canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d")!;
      context.drawImage(bitmap, 0, 0);
      bitmap.close();
      return d.sha256(
        new Uint8Array(
          context.getImageData(0, 0, canvas.width, canvas.height).data,
        ),
      );
    }
    return {
      web: files[0].sha256,
      pixelHash: await pixels(files[0].bytes),
      worker: remote.manifest.files[0].sha256,
      manifest: remote.manifest,
      hash: snapshot.snapshotHash,
    };
  }, fixture);
  expect(result.worker).toBe(result.web);
  expect(result.pixelHash).toMatch(/^[a-f0-9]{64}$/);
  const { createHash } = await import("node:crypto");
  expect(
    createHash("sha256")
      .update(Buffer.concat(chunks.map((c) => Buffer.from(c, "base64"))))
      .digest("hex"),
  ).toBe(result.web);
  expect(result.manifest.revision).toBe(12);
  expect(result.manifest.snapshotHash).toBe(result.hash);
});
