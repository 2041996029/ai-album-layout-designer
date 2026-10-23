import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/documents/minimal.json", import.meta.url),
    "utf8",
  ),
);
test("requires original image bytes and classifies actual cropped source PPI at199/100/99", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/preflight.html");
  const result = await page.evaluate(async (fixture) => {
    const eu = "/packages/export/src/index.ts",
      du = "/packages/document/src/index.ts",
      au = "/packages/assets/src/index.ts";
    const e = await import(eu),
      d = await import(du),
      a = await import(au);
    const data = await (
        await fetch("/tests/fixtures/images/landscape.png")
      ).arrayBuffer(),
      image = await a.importImage(
        new File([data], "photo.png", { type: "image/png" }),
        new AbortController().signal,
      );
    const resources = { assets: [image.record], fonts: [] };
    const reports = [];
    for (const ppi of [199, 100, 99]) {
      const doc = structuredClone(fixture);
      doc.spreads[0].layers = [
        {
          id: "photo_1",
          type: "image",
          x: 50,
          y: 50,
          width: (image.record.width * 96) / ppi,
          height: (image.record.height * 96) / ppi,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          assetId: image.record.id,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          fitMode: "cover",
          role: "photo",
        },
      ];
      const options = {
          format: "png",
          dpi: 300,
          view: "spread",
          pageIds: ["spread_1"],
          includeCover: false,
          bleedMm: 3,
          jpegMatte: "#ffffff",
        },
        snap = await e.freezeSnapshot(
          {
            doc,
            docHash: await d.hashDocument(doc),
            resources,
            savedAt: "2026-10-21T00:00:00Z",
          },
          options,
          "2026-10-21T00:01:00Z",
        );
      const report = await e.preflight(
        snap,
        {
          read: async (_id: string, variant: string) =>
            image[variant as keyof typeof image],
        },
        new AbortController().signal,
      );
      reports.push(report.warnings.find((w: any) => w.code === "LOW_PPI"));
      if (ppi === 199) {
        const missing = await e.preflight(
          snap,
          {
            read: async (_id: string, variant: string) => {
              if (variant === "original") throw new Error("missing original");
              return image.preview;
            },
          },
          new AbortController().signal,
        );
        reports.push(missing.blockers.map((b: any) => b.code));
      }
    }
    return reports;
  }, fixture);
  expect(result[0]).toMatchObject({ ppi: 199, level: "normal" });
  expect(result[1]).toContain("ASSET_MISSING");
  expect(result[2]).toMatchObject({ ppi: 100, level: "normal" });
  expect(result[3]).toMatchObject({ ppi: 99, level: "strong" });
});
test("checks real local fonts for missing glyphs, unavailable resources and overflow", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/preflight.html");
  const result = await page.evaluate(async (fixture) => {
    const eu = "/packages/export/src/index.ts",
      du = "/packages/document/src/index.ts";
    const e = await import(eu),
      d = await import(du),
      catalog = await (await fetch("/fonts/manifest.json")).json();
    const font = catalog.fonts[0],
      codes = [];
    for (const text of ["我们🙂", "我们\n我们\n我们", "我们"]) {
      const doc = structuredClone(fixture);
      doc.spreads[0].layers = [
        {
          id: "title",
          type: "text",
          x: 50,
          y: 50,
          width: 160,
          height: 100,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          text,
          fontAssetId: font.id,
          fontSize: 40,
          fontWeight: 400,
          lineHeight: 1.4,
          letterSpacing: 0,
          fill: "#000000",
        },
      ];
      const options = {
          format: "png",
          dpi: 72,
          view: "spread",
          pageIds: ["spread_1"],
          includeCover: false,
          bleedMm: 0,
          jpegMatte: "#ffffff",
        },
        snap = await e.freezeSnapshot(
          {
            doc,
            docHash: await d.hashDocument(doc),
            resources: { assets: [], fonts: [font] },
            savedAt: "2026-10-21T00:00:00Z",
          },
          options,
          "2026-10-21T00:01:00Z",
        );
      const port = {
        read: async (id: string) => {
          if (text === "我们") throw new Error("font unavailable");
          const face = font.faces.find((f: any) => f.id === id);
          return new Uint8Array(await (await fetch(face.file)).arrayBuffer());
        },
      };
      const report = await e.preflight(
        snap,
        port,
        new AbortController().signal,
      );
      codes.push(report.blockers.map((b: any) => b.code));
    }
    return codes;
  }, fixture);
  expect(result[0]).toContain("UNSUPPORTED_GLYPHS");
  expect(result[1]).toContain("TEXT_OVERFLOW");
  expect(result[2]).toContain("FONT_UNAVAILABLE");
});
