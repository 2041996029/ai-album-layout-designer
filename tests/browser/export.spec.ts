import { test, expect } from "@playwright/test";
import { PDFDocument } from "pdf-lib";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/documents/minimal.json", import.meta.url),
    "utf8",
  ),
);
test("encodes actual transparent PNG and matte JPEG with embedded 300 DPI", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/preflight.html");
  const result = await page.evaluate(async () => {
    const path = "/packages/export/src/index.ts",
      e = await import(path),
      canvas = document.createElement("canvas");
    canvas.width = 24;
    canvas.height = 12;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#e03040";
    ctx.fillRect(12, 0, 12, 12);
    const png = await e.encodePng(canvas, 300),
      jpeg = await e.encodeJpeg(canvas, 300, "#ffffff");
    async function pixel(bytes: Uint8Array, mime: string) {
      const img = await createImageBitmap(
        new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }),
      );
      ctx.clearRect(0, 0, 24, 12);
      ctx.drawImage(img, 0, 0);
      img.close();
      return [...ctx.getImageData(0, 0, 1, 1).data];
    }
    const index = Array.from(png).findIndex(
      (_, i) => String.fromCharCode(...png.slice(i, i + 4)) === "pHYs",
    );
    return {
      png: [png[index + 12], new DataView(png.buffer).getUint32(index + 4)],
      jpeg: [
        jpeg[13],
        new DataView(jpeg.buffer).getUint16(14),
        new DataView(jpeg.buffer).getUint16(16),
      ],
      alpha: await pixel(png, "image/png"),
      matte: await pixel(jpeg, "image/jpeg"),
    };
  });
  expect(result.png).toEqual([1, 11811]);
  expect(result.jpeg).toEqual([1, 300, 300]);
  expect(result.alpha).toEqual([0, 0, 0, 0]);
  expect(result.matte.slice(0, 3).every((v) => v >= 250)).toBe(true);
  expect(result.matte[3]).toBe(255);
});
test("exports six real PDF pages with physical trim and bleed boxes from frozen revision12", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/preflight.html");
  const result = await page.evaluate(async (fixture) => {
    const path = "/packages/export/src/index.ts",
      dp = "/packages/document/src/index.ts",
      e = await import(path),
      d = await import(dp);
    const doc = structuredClone(fixture);
    doc.revision = 12;
    doc.spreads.push({ ...structuredClone(doc.spreads[0]), id: "spread_2" });
    const options = {
      format: "pdf",
      dpi: 72,
      view: "singlePage",
      pageIds: e.allSurfaceIds(doc, "singlePage", true),
      includeCover: true,
      bleedMm: 3,
      jpegMatte: "#ffffff",
    };
    const snap = await e.freezeSnapshot(
      {
        doc,
        docHash: await d.hashDocument(doc),
        resources: { assets: [], fonts: [] },
        savedAt: "2026-10-21T00:00:00Z",
      },
      options,
      "2026-10-21T00:01:00Z",
    );
    doc.revision = 13;
    const port = {
        read: async () => {
          throw new Error("unused");
        },
      },
      signal = new AbortController().signal,
      report = await e.preflight(snap, port, signal),
      files = [];
    for await (const file of e.runExport(snap, report, [], port, signal))
      files.push(file);
    return {
      manifest: e.artifactManifest(snap, files),
      data: Array.from(files[0].bytes as Uint8Array),
    };
  }, fixture);
  const pdf = await PDFDocument.load(new Uint8Array(result.data)),
    p = pdf.getPage(0),
    boxes = {
      count: pdf.getPageCount(),
      media: p.getMediaBox(),
      trim: p.getTrimBox(),
      bleed: p.getBleedBox(),
    };
  expect(boxes.count).toBe(6);
  expect(boxes.media.width).toBeCloseTo((306 * 72) / 25.4, 4);
  expect(boxes.trim.width).toBeCloseTo((300 * 72) / 25.4, 4);
  expect(boxes.trim.x).toBeCloseTo((3 * 72) / 25.4, 4);
  expect(boxes.bleed).toEqual(boxes.media);
  expect(result.manifest.revision).toBe(12);
  expect(result.data.length).toBeGreaterThan(1000);
});
test("aborts before producing a downloadable artifact", async ({ page }) => {
  await page.goto("/tests/browser/harness/preflight.html");
  const result = await page.evaluate(async (fixture) => {
    const p = "/packages/export/src/index.ts",
      dp = "/packages/document/src/index.ts",
      e = await import(p),
      d = await import(dp),
      options = {
        format: "png",
        dpi: 72,
        view: "spread",
        pageIds: ["spread_1"],
        includeCover: false,
        bleedMm: 0,
        jpegMatte: "#ffffff",
      },
      snapshot = await e.freezeSnapshot(
        {
          doc: fixture,
          docHash: await d.hashDocument(fixture),
          resources: { assets: [], fonts: [] },
          savedAt: "2026-10-21T00:00:00Z",
        },
        options,
        "2026-10-21T00:01:00Z",
      ),
      controller = new AbortController(),
      port = {
        read: async () => {
          throw new Error("unused");
        },
      },
      report = await e.preflight(snapshot, port, controller.signal);
    controller.abort();
    let count = 0;
    try {
      for await (const _ of e.runExport(
        snapshot,
        report,
        [],
        port,
        controller.signal,
      ))
        count++;
    } catch (e) {
      return { count, error: (e as Error).name };
    }
    return { count, error: "" };
  }, fixture);
  expect(result).toEqual({ count: 0, error: "AbortError" });
});
test("web editor produces a real downloadable PNG through preflight", async ({
  page,
}) => {
  await page.goto("/apps/web/index.html");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.getByRole("button", { name: "导出作品", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导出作品" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("导出DPI").selectOption("72");
  await dialog.getByRole("button", { name: "检查导出条件" }).click();
  await expect(dialog.getByText("检查通过。")).toBeVisible();
  await dialog.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(dialog.getByText("导出完成，可下载")).toBeVisible({
    timeout: 60000,
  });
  const event = page.waitForEvent("download");
  await dialog.getByRole("button", { name: /下载 0001/ }).click();
  const file = await event;
  expect(file.suggestedFilename()).toBe("0001-spread-01.png");
  const path = await file.path();
  expect(path).toBeTruthy();
  const bytes = readFileSync(path!);
  expect([...bytes.slice(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
});
test("cancelling after the first rendered page prevents a completed export", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/preflight.html");
  const result = await page.evaluate(async (fixture) => {
    const path = "/packages/export/src/index.ts",
      dp = "/packages/document/src/index.ts",
      e = await import(path),
      d = await import(dp),
      doc = structuredClone(fixture);
    doc.spreads.push({ ...structuredClone(doc.spreads[0]), id: "spread_2" });
    const snapshot = await e.freezeSnapshot(
        {
          doc,
          docHash: await d.hashDocument(doc),
          resources: { assets: [], fonts: [] },
          savedAt: "2026-10-22T00:00:00Z",
        },
        {
          format: "png",
          dpi: 72,
          view: "spread",
          pageIds: ["spread_1", "spread_2"],
          includeCover: false,
          bleedMm: 0,
          jpegMatte: "#ffffff",
        },
        "2026-10-22T00:00:00Z",
      ),
      controller = new AbortController(),
      port = {
        read: async () => {
          throw new Error("unused");
        },
      },
      report = await e.preflight(snapshot, port, controller.signal);
    let yielded = 0,
      completed = false,
      error = "";
    try {
      for await (const _ of e.runExport(
        snapshot,
        report,
        [],
        port,
        controller.signal,
        (done:number) => {
          if (done === 1) controller.abort();
        },
      ))
        yielded++;
      completed = true;
    } catch (e) {
      error = (e as Error).name;
    }
    return { yielded, completed, error };
  }, fixture);
  expect(result).toEqual({ yielded: 1, completed: false, error: "AbortError" });
});
