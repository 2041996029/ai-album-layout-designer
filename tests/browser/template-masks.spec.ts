import { expect, test } from "@playwright/test";

test("slot alpha survives photo replacement and scaling without source RGB", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/");
  const result = await page.evaluate(async () => {
    const url = "/packages/render/src/image-pipeline.ts";
    const { renderImage } = await import(url);
    const assets = (window as any).assets;
    const signal = new AbortController().signal;
    const make = async (mask: boolean) => {
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = mask ? "#ff0000" : "#0000ff";
      if (mask) {
        ctx.beginPath();
        ctx.arc(16, 16, 10, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(0, 0, 32, 32);
      const blob = await new Promise<Blob>((resolve) =>
        c.toBlob((b) => resolve(b!)),
      );
      return assets.importImage(new File([blob], "image.png"), signal);
    };
    const photo = await make(false),
      mask = await make(true);
    const layer = {
      id: "im",
      type: "image",
      assetId: photo.record.id,
      x: 0,
      y: 0,
      width: 32,
      height: 32,
      rotation: 23,
      opacity: 0.5,
      visible: true,
      locked: false,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      alphaMask: { version: 1, assetId: mask.record.id },
    };
    const port = {
      read: async (id: string) =>
        id === photo.record.id ? photo.normalized : mask.normalized,
    };
    const samples = [];
    for (const scale of [1, 2, 1]) {
      const image = await renderImage(
        layer,
        photo.record,
        port,
        signal,
        scale,
        mask.record,
      );
      const ctx = image.canvas.getContext("2d")!;
      samples.push([
        Array.from(ctx.getImageData(16 * scale, 16 * scale, 1, 1).data),
        Array.from(ctx.getImageData(0, 0, 1, 1).data),
      ]);
      image.dispose();
    }
    let missing = false,
      tampered = false;
    try {
      await renderImage(layer, photo.record, port, signal);
    } catch {
      missing = true;
    }
    try {
      await renderImage(
        layer,
        photo.record,
        { read: async () => photo.normalized },
        signal,
        1,
        mask.record,
      );
    } catch {
      tampered = true;
    }
    return { samples, missing, tampered };
  });
  expect(result.samples).toEqual(
    Array(3).fill([
      [0, 0, 255, 255],
      [0, 0, 0, 0],
    ]),
  );
  expect(result.missing).toBe(true);
  expect(result.tampered).toBe(true);
});

test("export preflight pins mask bytes and rejects missing or unlicensed masks", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/");
  const result = await page.evaluate(async () => {
    const dp = "/packages/document/src/index.ts",
      ep = "/packages/export/src/index.ts";
    const d = await import(dp),
      e = await import(ep);
    const signal = new AbortController().signal;
    const c = document.createElement("canvas");
    c.width = c.height = 8;
    c.getContext("2d")!.fillRect(0, 0, 8, 8);
    const blob = await new Promise<Blob>((resolve) =>
      c.toBlob((b) => resolve(b!)),
    );
    const asset = await (window as any).assets.importImage(
      new File([blob], "a.png"),
      signal,
    );
    const mask = structuredClone(asset.record);
    mask.id = "mask";
    const doc = d.parseDocument({
      schemaVersion: 1,
      projectId: "mask_project",
      revision: 1,
      unit: "px96",
      colorSpace: "srgb",
      pageSize: { width: 32, height: 32 },
      printProfile: { bleedMm: 0, safeMm: 0 },
      cover: { front: [], back: [] },
      spreads: [
        {
          id: "s",
          background: "#ffffff",
          layers: [
            {
              id: "im",
              type: "image",
              assetId: asset.record.id,
              x: 0,
              y: 0,
              width: 32,
              height: 32,
              rotation: 0,
              opacity: 1,
              visible: true,
              locked: false,
              crop: { x: 0, y: 0, width: 1, height: 1 },
              alphaMask: { version: 1, assetId: "mask" },
            },
          ],
        },
      ],
    });
    const run = async (mode: string) => {
      const record = structuredClone(mask);
      if (mode === "unlicensed") record.license.usable = false;
      const snap = await e.freezeSnapshot(
        {
          doc,
          docHash: await d.hashDocument(doc),
          resources: {
            assets:
              mode === "missing" ? [asset.record] : [asset.record, record],
            fonts: [],
          },
          savedAt: "2026-10-23T00:00:00Z",
        },
        {
          format: "png",
          dpi: 150,
          view: "spread",
          pageIds: ["s"],
          includeCover: false,
          bleedMm: 0,
          jpegMatte: "#ffffff",
        },
        "2026-10-23T00:00:00Z",
      );
      const report = await e.preflight(
        snap,
        {
          read: async (id: string, variant: string) =>
            id === "mask" && mode === "tampered"
              ? new Uint8Array([1, 2, 3])
              : asset[variant],
        },
        signal,
      );
      return report.blockers.map((b: { code: string; path: string }) => ({
        code: b.code,
        path: b.path,
      }));
    };
    return {
      valid: await run("valid"),
      missing: await run("missing"),
      tampered: await run("tampered"),
      unlicensed: await run("unlicensed"),
    };
  });
  expect(result.valid).toEqual([]);
  expect(result.missing).toContainEqual({
    code: "ASSET_MISSING",
    path: "/layers/im/alphaMask",
  });
  expect(result.tampered).toContainEqual({
    code: "HASH_MISMATCH",
    path: "/layers/im/alphaMask",
  });
  expect(result.unlicensed).toContainEqual({
    code: "ASSET_UNLICENSED",
    path: "/layers/im/alphaMask",
  });
});
