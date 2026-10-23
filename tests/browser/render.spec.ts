import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/documents/render-contract.json", import.meta.url),
    "utf8",
  ),
);
test.beforeEach(async ({ page }) => {
  await page.goto("/tests/browser/harness/");
  await page.waitForFunction(() => !!(window as any).assets);
});
test("Fabric scenes preserve layer order, local group rotation, alpha, clipping and repeated pixel geometry", async ({
  page,
}) => {
  const r = await page.evaluate(async (doc) => {
    const url = "/packages/render/src/index.ts";
    const { createScene } = await import(url);
    const base = { rotation: 0, opacity: 1, visible: true, locked: false };
    const shape = (
      id: string,
      x: number,
      y: number,
      width: number,
      height: number,
      fill: string,
    ) => ({
      ...base,
      id,
      type: "shape",
      x,
      y,
      width,
      height,
      shapeKind: "rectangle",
      fill,
      stroke: "transparent",
      strokeWidth: 0,
    });
    doc.spreads[0].layers = [
      shape("bottom", 0, 0, 100, 100, "#ff0000"),
      {
        ...base,
        id: "group",
        type: "group",
        x: 70,
        y: 20,
        width: 20,
        height: 20,
        rotation: 90,
        opacity: 0.5,
        scale: 1,
        children: [shape("child", 0, 0, 20, 20, "#0000ff")],
      },
      shape("top", 10, 10, 10, 10, "#00ff00"),
    ];
    const surface = {
      id: "s",
      sourceSpreadId: doc.spreads[0].id,
      clip: { x: 0, y: 0, width: 100, height: 100 },
      bleedPx96: 0,
      background: "transparent",
      pixelWidth: 100,
      pixelHeight: 100,
    };
    const canvas = document.createElement("canvas");
    document.body.append(canvas);
    const input = {
      doc,
      surface,
      manifest: { assets: [], fonts: [] },
      port: {
        read: async () => {
          throw Error("unexpected");
        },
      },
      signal: new AbortController().signal,
      pixelScale: 1,
    };
    const scene = await createScene(canvas, input);
    const pixel = (x: number, y: number) =>
      Array.from(canvas.getContext("2d")!.getImageData(x, y, 1, 1).data);
    const sample = [pixel(15, 15), pixel(55, 25), pixel(75, 25)];
    const hash = canvas.toDataURL();
    await scene.render();
    const same = hash === canvas.toDataURL();
    await scene.update({
      ...input,
      surface: { ...surface, pixelWidth: 200, pixelHeight: 200 },
      pixelScale: 2,
    });
    const doubled = pixel(110, 50);
    scene.dispose();
    scene.dispose();
    return { sample, same, doubled };
  }, fixture);
  expect(r.sample).toEqual([
    [0, 255, 0, 255],
    [127, 0, 128, 255],
    [255, 0, 0, 255],
  ]);
  expect(r.same).toBe(true);
  expect(r.doubled).toEqual([127, 0, 128, 255]);
});
test("source crop cover and contain use normalized bytes and filter source coordinates", async ({
  page,
}) => {
  const r = await page.evaluate(async (doc) => {
    const url = "/packages/render/src/index.ts";
    const { createScene } = await import(url);
    const a = (window as any).assets;
    const data = await a.importImage(
      new File(
        [
          await (
            await fetch("/tests/fixtures/images/orientation-6.jpg")
          ).arrayBuffer(),
        ],
        "a.jpg",
      ),
      new AbortController().signal,
    );
    const canvas = document.createElement("canvas");
    const layer = {
      id: "im",
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId: data.record.id,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      fitMode: "contain",
    };
    doc.spreads[0].layers = [layer];
    const variants: string[] = [];
    const input = {
      doc,
      surface: {
        id: "s",
        sourceSpreadId: doc.spreads[0].id,
        clip: { x: 0, y: 0, width: 100, height: 100 },
        bleedPx96: 0,
        background: "transparent",
        pixelWidth: 100,
        pixelHeight: 100,
      },
      manifest: { assets: [data.record], fonts: [] },
      port: {
        read: async (_id: string, variant: string) => {
          variants.push(variant);
          return data[variant];
        },
      },
      signal: new AbortController().signal,
      pixelScale: 1,
    };
    const scene = await createScene(canvas, input);
    const pixel = (x: number, y: number) =>
      Array.from(canvas.getContext("2d")!.getImageData(x, y, 1, 1).data);
    const contain = [pixel(1, 50), pixel(25, 10), pixel(75, 10)];
    layer.fitMode = "cover";
    layer.crop = { x: 0.5, y: 0, width: 0.5, height: 1 };
    await scene.update(input);
    const cover = pixel(10, 10);
    scene.dispose();
    return { contain, cover, variants };
  }, fixture);
  expect(r.contain[0][3]).toBe(0);
  expect(r.contain[1][2]).toBeGreaterThan(240);
  expect(r.contain[2][0]).toBeGreaterThan(240);
  expect(r.cover[0]).toBeGreaterThan(240);
  expect(r.variants).toEqual(["normalized", "normalized"]);
});
test("updates discard late bitmap decodes, abort promptly and release every bitmap without object URLs", async ({
  page,
}) => {
  const r = await page.evaluate(async (doc) => {
    const url = "/packages/render/src/index.ts";
    const { createScene } = await import(url);
    const a = (window as any).assets;
    const data = await a.importImage(
      new File(
        [
          await (
            await fetch("/tests/fixtures/images/transparent.png")
          ).arrayBuffer(),
        ],
        "a.png",
      ),
      new AbortController().signal,
    );
    const canvas = document.createElement("canvas");
    const base = {
      id: "s",
      sourceSpreadId: doc.spreads[0].id,
      clip: { x: 0, y: 0, width: 100, height: 100 },
      bleedPx96: 0,
      background: "#00ff00",
      pixelWidth: 100,
      pixelHeight: 100,
    };
    const input = {
      doc,
      surface: base,
      manifest: { assets: [data.record], fonts: [] },
      port: { read: async () => data.normalized },
      signal: new AbortController().signal,
      pixelScale: 1,
    };
    const scene = await createScene(canvas, input);
    const original = createImageBitmap;
    const originalURL = URL.createObjectURL;
    let made = 0,
      closed = 0,
      urls = 0;
    let release!: () => void;
    let entered!: () => void;
    const enteredPromise = new Promise<void>((r) => (entered = r));
    const gate = new Promise<void>((r) => (release = r));
    window.createImageBitmap = (async (...args: any[]) => {
      const bitmap = await (original as any)(...args);
      made++;
      const close = bitmap.close.bind(bitmap);
      bitmap.close = () => {
        closed++;
        close();
      };
      entered();
      await gate;
      return bitmap;
    }) as any;
    URL.createObjectURL = ((...args: any[]) => {
      urls++;
      return (originalURL as any)(...args);
    }) as any;
    doc = structuredClone(doc);
    doc.spreads[0].layers = [
      {
        id: "im",
        type: "image",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        assetId: data.record.id,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      },
    ];
    const stale = scene.update({ ...input, doc }).catch((e: any) => e.name);
    await enteredPromise;
    await scene.update({
      ...input,
      surface: { ...base, background: "#0000ff" },
    });
    release();
    const staleResult = await stale;
    await new Promise((r) => setTimeout(r, 20));
    const pixel = Array.from(
      canvas.getContext("2d")!.getImageData(50, 50, 1, 1).data,
    );
    scene.dispose();
    scene.dispose();
    window.createImageBitmap = original;
    URL.createObjectURL = originalURL;
    return { made, closed, urls, pixel, staleResult };
  }, fixture);
  expect(r.pixel).toEqual([0, 0, 255, 255]);
  expect(r.made).toBe(1);
  expect(r.closed).toBe(1);
  expect(r.urls).toBe(0);
  expect(r.staleResult).toBe("AbortError");
});
test("fonts use exact pinned faces and layout reports; missing families and synthesis fail", async ({
  page,
}) => {
  const r = await page.evaluate(async (doc) => {
    const url = "/packages/render/src/index.ts";
    const { createScene } = await import(url);
    const { fonts } = await (await fetch("/fonts/manifest.json")).json();
    const record = fonts[0];
    const baseline = document.fonts.size;
    const layer = {
      id: "text",
      type: "text",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      text: "我们，Á\n世界",
      fontAssetId: record.id,
      fontSize: 20,
      fontWeight: 400,
      lineHeight: 1.4,
      letterSpacing: 0,
      fill: "#000",
    };
    doc.spreads[0].layers = [layer];
    const surface = {
      id: "s",
      sourceSpreadId: doc.spreads[0].id,
      clip: { x: 0, y: 0, width: 100, height: 100 },
      bleedPx96: 0,
      background: "#fff",
      pixelWidth: 100,
      pixelHeight: 100,
    };
    const input = {
      doc,
      surface,
      manifest: { assets: [], fonts: [record] },
      port: {
        read: async (id: string) =>
          new Uint8Array(
            await (
              await fetch(record.faces.find((f: any) => f.id === id).file)
            ).arrayBuffer(),
          ),
      },
      signal: new AbortController().signal,
      pixelScale: 1,
    };
    const canvas = document.createElement("canvas");
    const scene = await createScene(canvas, input);
    const reports = scene.textReports;
    const first = canvas.toDataURL();
    await scene.update(input);
    const same = first === canvas.toDataURL();
    scene.dispose();
    const after = document.fonts.size;
    const errors = [];
    for (const next of [
      { ...input, manifest: { assets: [], fonts: [] } },
      {
        ...input,
        doc: {
          ...doc,
          spreads: [
            { ...doc.spreads[0], layers: [{ ...layer, fontWeight: 500 }] },
          ],
        },
      },
    ]) {
      try {
        const s = await createScene(document.createElement("canvas"), next);
        s.dispose();
        errors.push("accepted");
      } catch (e) {
        errors.push((e as any).code);
      }
    }
    return { reports, same, baseline, after, errors };
  }, fixture);
  expect(r.reports[0].lines.join("")).toBe("我们，Á世界");
  expect(r.reports[0].unsupportedCodePoints).toEqual([]);
  expect(r.same).toBe(true);
  expect(r.after).toBe(r.baseline);
  expect(r.errors).toEqual(["FONT_UNAVAILABLE", "FONT_UNAVAILABLE"]);
});

test("filtered image tiles match full-source CPU pixels before normalized crop and contain", async ({
  page,
}) => {
  const r = await page.evaluate(async () => {
    const url = "/packages/render/src/index.ts";
    const r = await import(url);
    const a = (window as any).assets;
    const source = document.createElement("canvas");
    source.width = 1100;
    source.height = 800;
    const context = source.getContext("2d")!;
    context.fillStyle = "#c08c60";
    context.fillRect(0, 0, 1100, 800);
    context.fillStyle = "#6080c0";
    context.fillRect(500, 300, 600, 500);
    const blob = await new Promise<Blob>((resolve) =>
      source.toBlob((b) => resolve(b!), "image/png"),
    );
    const data = await a.importImage(
      new File([blob], "tiles.png"),
      new AbortController().signal,
    );
    const filter = {
      presetId: "F29",
      recipeVersion: 1,
      strength: 0.8,
      seed: 1234,
    };
    const layer = {
      id: "im",
      type: "image",
      x: 0,
      y: 0,
      width: 220,
      height: 160,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId: data.record.id,
      crop: { x: 0.2, y: 0.1, width: 0.6, height: 0.7 },
      fitMode: "contain",
      filter,
    };
    const pipeline = await r.renderImage(
      layer,
      data.record,
      { read: async () => data.normalized },
      new AbortController().signal,
      1,
    );
    const tile = context.getImageData(0, 0, 1100, 800);
    tile.data.set(
      r.filterTile(
        {
          bytes: tile.data,
          width: 1100,
          height: 800,
          offsetX: 0,
          offsetY: 0,
          fullWidth: 1100,
          fullHeight: 800,
        },
        r.getRecipe(filter),
        filter.strength,
        filter.seed,
      ),
    );
    context.putImageData(tile, 0, 0);
    const expected = document.createElement("canvas");
    expected.width = 220;
    expected.height = 160;
    const out = expected.getContext("2d")!;
    const p = r.imagePlacement(layer, 1100, 800);
    out.drawImage(
      source,
      p.source.x,
      p.source.y,
      p.source.width,
      p.source.height,
      p.destination.x,
      p.destination.y,
      p.destination.width,
      p.destination.height,
    );
    const actual = pipeline.canvas
      .getContext("2d")!
      .getImageData(0, 0, 220, 160).data;
    const wanted = out.getImageData(0, 0, 220, 160).data;
    const equal = actual.every(
      (value: number, index: number) => value === wanted[index],
    );
    pipeline.dispose();
    pipeline.dispose();
    return { equal, released: [pipeline.canvas.width, pipeline.canvas.height] };
  });
  expect(r.equal).toBe(true);
  expect(r.released).toEqual([0, 0]);
});

test("clip plus bleed translates document geometry and unrecognized layers block rendering", async ({
  page,
}) => {
  const r = await page.evaluate(async (doc) => {
    const url = "/packages/render/src/index.ts";
    const { createScene } = await import(url);
    const layer = {
      id: "s",
      type: "shape",
      shapeKind: "rectangle",
      x: 30,
      y: 20,
      width: 10,
      height: 10,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      fill: "#ff0000",
      stroke: "transparent",
      strokeWidth: 0,
    };
    doc.spreads[0].layers = [layer];
    const canvas = document.createElement("canvas");
    const input = {
      doc,
      surface: {
        id: "s",
        sourceSpreadId: doc.spreads[0].id,
        clip: { x: 30, y: 20, width: 40, height: 40 },
        bleedPx96: 5,
        background: "#0000ff",
        pixelWidth: 50,
        pixelHeight: 50,
      },
      manifest: { assets: [], fonts: [] },
      port: {
        read: async () => {
          throw Error("unexpected");
        },
      },
      signal: new AbortController().signal,
      pixelScale: 1,
    };
    const scene = await createScene(canvas, input);
    const ctx = canvas.getContext("2d")!;
    const pixels = [
      [1, 1],
      [6, 6],
      [16, 16],
    ].map(([x, y]) => Array.from(ctx.getImageData(x, y, 1, 1).data));
    doc.spreads[0].layers = [
      { id: "future", type: "svg", url: "https://example.invalid/remote.svg" },
    ];
    let error = "";
    try {
      await scene.update(input);
    } catch (e) {
      error = (e as any).code;
    }
    const preserved = Array.from(ctx.getImageData(6, 6, 1, 1).data);
    scene.dispose();
    return { pixels, error, preserved };
  }, fixture);
  expect(r.pixels).toEqual([
    [0, 0, 255, 255],
    [255, 0, 0, 255],
    [0, 0, 255, 255],
  ]);
  expect(r.error).toBe("UNSUPPORTED_LAYER");
  expect(r.preserved).toEqual([255, 0, 0, 255]);
});

test("dispose and external abort cancel unresolved reads promptly and keep no font/image result alive", async ({
  page,
}) => {
  const r = await page.evaluate(async (doc) => {
    const url = "/packages/render/src/index.ts";
    const { createScene } = await import(url);
    const a = (window as any).assets;
    const data = await a.importImage(
      new File(
        [
          await (
            await fetch("/tests/fixtures/images/transparent.png")
          ).arrayBuffer(),
        ],
        "a.png",
      ),
      new AbortController().signal,
    );
    const canvas = document.createElement("canvas");
    const controller = new AbortController();
    const input = {
      doc,
      surface: {
        id: "s",
        sourceSpreadId: doc.spreads[0].id,
        clip: { x: 0, y: 0, width: 100, height: 100 },
        bleedPx96: 0,
        background: "#fff",
        pixelWidth: 100,
        pixelHeight: 100,
      },
      manifest: { assets: [data.record], fonts: [] },
      port: { read: () => new Promise<Uint8Array>(() => {}) },
      signal: controller.signal,
      pixelScale: 1,
    };
    const scene = await createScene(canvas, input);
    doc = structuredClone(doc);
    doc.spreads[0].layers = [
      {
        id: "im",
        type: "image",
        x: 0,
        y: 0,
        width: 10,
        height: 10,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        assetId: data.record.id,
        crop: { x: 0, y: 0, width: 1, height: 1 },
      },
    ];
    const pending = scene.update({ ...input, doc }).catch((e: any) => e.name);
    scene.dispose();
    scene.dispose();
    const disposed = await pending;
    const second = createScene(document.createElement("canvas"), {
      ...input,
      doc,
    }).then(
      () => "accepted",
      (e: any) => e.name,
    );
    controller.abort();
    const aborted = await second;
    return { disposed, aborted };
  }, fixture);
  expect(r).toEqual({ disposed: "AbortError", aborted: "AbortError" });
});

test("actual missing glyphs block scene output without synthesizing a fallback family", async ({
  page,
}) => {
  const r = await page.evaluate(async (doc) => {
    const url = "/packages/render/src/index.ts";
    const { createScene } = await import(url);
    const {
      fonts: [record],
    } = await (await fetch("/fonts/manifest.json")).json();
    doc.spreads[0].layers = [
      {
        id: "text",
        type: "text",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        text: "我们🙂",
        fontAssetId: record.id,
        fontSize: 20,
        fontWeight: 700,
        lineHeight: 1.4,
        letterSpacing: 0,
        fill: "#000",
      },
    ];
    const baseline = document.fonts.size;
    const input = {
      doc,
      surface: {
        id: "s",
        sourceSpreadId: doc.spreads[0].id,
        clip: { x: 0, y: 0, width: 100, height: 100 },
        bleedPx96: 0,
        background: "#fff",
        pixelWidth: 100,
        pixelHeight: 100,
      },
      manifest: { assets: [], fonts: [record] },
      port: {
        read: async (id: string) =>
          new Uint8Array(
            await (
              await fetch(record.faces.find((f: any) => f.id === id).file)
            ).arrayBuffer(),
          ),
      },
      signal: new AbortController().signal,
      pixelScale: 1,
    };
    try {
      await createScene(document.createElement("canvas"), input);
      return { code: "accepted" };
    } catch (e) {
      const error = e as any;
      return {
        code: error.code,
        missing: error.textReports[0].unsupportedCodePoints,
        balanced: document.fonts.size === baseline,
      };
    }
  }, fixture);
  expect(r).toEqual({
    code: "UNSUPPORTED_GLYPHS",
    missing: [0x1f642],
    balanced: true,
  });
});

test("unavailable pinned font subset fails FONT_UNAVAILABLE", async ({
  page,
}) => {
  const r = await page.evaluate(async (doc) => {
    const url = "/packages/render/src/index.ts";
    const { createScene } = await import(url);
    const {
      fonts: [record],
    } = await (await fetch("/fonts/manifest.json")).json();
    doc.spreads[0].layers = [
      {
        id: "text",
        type: "text",
        x: 0,
        y: 0,
        width: 100,
        height: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        text: "我",
        fontAssetId: record.id,
        fontSize: 20,
        fontWeight: 400,
        lineHeight: 1.4,
        letterSpacing: 0,
        fill: "#000",
      },
    ];
    try {
      await createScene(document.createElement("canvas"), {
        doc,
        surface: {
          id: "s",
          sourceSpreadId: doc.spreads[0].id,
          clip: { x: 0, y: 0, width: 100, height: 100 },
          bleedPx96: 0,
          background: "#fff",
          pixelWidth: 100,
          pixelHeight: 100,
        },
        manifest: { assets: [], fonts: [record] },
        port: {
          read: async () => {
            throw Error("missing subset");
          },
        },
        signal: new AbortController().signal,
        pixelScale: 1,
      });
      return "accepted";
    } catch (e) {
      return (e as any).code;
    }
  }, fixture);
  expect(r).toBe("FONT_UNAVAILABLE");
});

test("justified oversized punctuation preserves actual font advances and reports overflow", async ({
  page,
}) => {
  const r = await page.evaluate(async (doc) => {
    const url = "/packages/render/src/index.ts";
    const { createScene } = await import(url);
    const {
      fonts: [record],
    } = await (await fetch("/fonts/manifest.json")).json();
    doc.spreads[0].layers = [
      {
        id: "text",
        type: "text",
        x: 0,
        y: 0,
        width: 30,
        height: 100,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        text: "（我）我",
        fontAssetId: record.id,
        fontSize: 20,
        fontWeight: 400,
        lineHeight: 1.4,
        letterSpacing: 0,
        textAlign: "justify",
        fill: "#000",
      },
    ];
    const canvas = document.createElement("canvas");
    const scene = await createScene(canvas, {
      doc,
      surface: {
        id: "s",
        sourceSpreadId: doc.spreads[0].id,
        clip: { x: 0, y: 0, width: 100, height: 100 },
        bleedPx96: 0,
        background: "#fff",
        pixelWidth: 100,
        pixelHeight: 100,
      },
      manifest: { assets: [], fonts: [record] },
      port: {
        read: async (id: string) =>
          new Uint8Array(
            await (
              await fetch(record.faces.find((f: any) => f.id === id).file)
            ).arrayBuffer(),
          ),
      },
      signal: new AbortController().signal,
      pixelScale: 1,
    });
    const ctx = canvas.getContext("2d")!;
    ctx.font = `400 20px "AlbumFont_${record.sha256}"`;
    const naturalWidth = ctx.measureText("（我）").width;
    const report = scene.textReports[0];
    const pixels = ctx.getImageData(35, 0, 30, 28).data;
    let inkBeyondFrame = 0;
    for (let i = 0; i < pixels.length; i += 4)
      if (pixels[i] < 128 && pixels[i + 1] < 128 && pixels[i + 2] < 128)
        inkBeyondFrame++;
    scene.dispose();
    return { naturalWidth, report, inkBeyondFrame };
  }, fixture);
  expect(r.report.lines).toEqual(["（我）", "我"]);
  expect(r.report.lineLetterSpacing).toEqual([0, 0]);
  expect(r.report.lineBoxes[0].width).toBeCloseTo(r.naturalWidth, 5);
  expect(r.naturalWidth).toBeGreaterThan(30);
  expect(r.report.overflow).toBe(true);
  expect(r.inkBeyondFrame).toBeGreaterThan(0);
});

test("group affine scale expands rectangle ellipse and line strokes at every nesting level", async ({
  page,
}) => {
  const r = await page.evaluate(async (doc) => {
    const url = "/packages/render/src/index.ts";
    const { createScene } = await import(url);
    const base = { rotation: 0, opacity: 1, visible: true, locked: false };
    const results = [];
    for (const shapeKind of ["rectangle", "ellipse", "line"])
      for (const nested of [false, true]) {
        const shape = {
          ...base,
          id: "shape",
          type: "shape",
          shapeKind,
          x: 0,
          y: 0,
          width: 20,
          height: shapeKind === "line" ? 0 : 20,
          fill: "#fff",
          stroke: "#000",
          strokeWidth: 4,
        };
        const group = {
          ...base,
          id: "outer",
          type: "group",
          x: 20,
          y: 20,
          width: 20,
          height: 20,
          scale: 2,
          children: nested
            ? [
                {
                  ...base,
                  id: "inner",
                  type: "group",
                  x: 0,
                  y: 0,
                  width: 20,
                  height: 20,
                  scale: 1.5,
                  children: [shape],
                },
              ]
            : [shape],
        };
        doc.spreads[0].layers = [group];
        const canvas = document.createElement("canvas");
        const scene = await createScene(canvas, {
          doc,
          surface: {
            id: "s",
            sourceSpreadId: doc.spreads[0].id,
            clip: { x: 0, y: 0, width: 120, height: 120 },
            bleedPx96: 0,
            background: "#fff",
            pixelWidth: 120,
            pixelHeight: 120,
          },
          manifest: { assets: [], fonts: [] },
          port: {
            read: async () => {
              throw Error("unexpected");
            },
          },
          signal: new AbortController().signal,
          pixelScale: 1,
        });
        const scale = nested ? 3 : 2;
        const ctx = canvas.getContext("2d")!;
        const center = 20 + ((20 + 4) * scale) / 2;
        let black = 0;
        for (let p = 20; p < 20 + Math.ceil(10 * scale); p++) {
          const pixel =
            shapeKind === "line"
              ? ctx.getImageData(center, p, 1, 1).data
              : ctx.getImageData(p, center, 1, 1).data;
          if (pixel[0] < 128 && pixel[1] < 128 && pixel[2] < 128) black++;
        }
        results.push({ shapeKind, nested, black, expected: 4 * scale });
        scene.dispose();
      }
    return results;
  }, fixture);
  for (const r0 of r)
    expect(r0.black, `${r0.shapeKind} nested=${r0.nested}`).toBe(r0.expected);
});
test("rejects cumulative image frame allocations before requesting source bytes", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/");
  const result = await page.evaluate(async () => {
    const rp = "/packages/render/src/index.ts",
      dp = "/packages/document/src/index.ts",
      r = await import(rp),
      d = await import(dp),
      doc = d.parseDocument({
        schemaVersion: 1,
        projectId: "cache_limit",
        revision: 1,
        unit: "px96",
        colorSpace: "srgb",
        pageSize: { width: 100, height: 100 },
        printProfile: { bleedMm: 0, safeMm: 5 },
        cover: { front: [], back: [] },
        spreads: [
          {
            id: "s",
            background: "#ffffff",
            layers: [0, 1].map((i) => ({
              id: "p" + i,
              type: "image",
              assetId: "a",
              x: 0,
              y: 0,
              width: 5000,
              height: 4000,
              rotation: 0,
              visible: true,
              locked: false,
              opacity: 1,
              crop: { x: 0, y: 0, width: 1, height: 1 },
              fitMode: "cover",
              role: "photo",
            })),
          },
        ],
      }),
      canvas = document.createElement("canvas");
    let reads = 0;
    try {
      const scene = await r.createScene(canvas, {
        doc,
        surface: {
          id: "s",
          sourceSpreadId: "s",
          clip: { x: 0, y: 0, width: 200, height: 100 },
          bleedPx96: 0,
          pixelWidth: 200,
          pixelHeight: 100,
          background: "#ffffff",
        },
        manifest: { assets: [], fonts: [] },
        port: {
          read: async () => {
            reads++;
            throw new Error("missing");
          },
        },
        signal: new AbortController().signal,
        pixelScale: 1,
      });
      scene.dispose();
      return { error: "", reads };
    } catch (e) {
      return { error: (e as any).code, reads };
    }
  });
  expect(result).toEqual({ error: "CACHE_BUDGET", reads: 0 });
});
