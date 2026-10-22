import { it, expect } from "vitest";
import fixture from "../../../tests/fixtures/documents/minimal.json";
import { parseDocument, hashDocument } from "@album/document";
import {
  freezeSnapshot,
  planSurfaces,
  allSurfaceIds,
  preflight,
  authorizeExport,
  effectivePpi,
} from "./index";
import assignment from "../../../docs/release-v1.0/contracts/examples/assignment-manifest.json";
import type { ExportOptions } from "./types";
async function snapshot(
  bleedMm = 3,
  view: "spread" | "singlePage" = "spread",
  includeCover = false,
) {
  const doc = parseDocument({ ...structuredClone(fixture), revision: 12 });
  const options: ExportOptions = {
    format: "png",
    dpi: 300,
    view,
    pageIds: allSurfaceIds(doc, view, includeCover),
    includeCover,
    bleedMm,
    jpegMatte: "#ffffff",
  };
  return freezeSnapshot(
    {
      doc,
      docHash: await hashDocument(doc),
      resources: { assets: [], fonts: [] },
      savedAt: "2026-10-21T12:00:00Z",
    },
    options,
    "2026-10-21T12:01:00Z",
  );
}
it("rounds physical sizes only after adding bleed", async () => {
  const plain = planSurfaces(await snapshot(0))[0],
    bleed = planSurfaces(await snapshot(3))[0];
  expect([plain.pixelWidth, plain.pixelHeight]).toEqual([7087, 3543]);
  expect([bleed.pixelWidth, bleed.pixelHeight]).toEqual([7157, 3614]);
  expect(bleed.trimWidthMm).toBeCloseTo(600);
  expect(bleed.trimHeightMm).toBeCloseTo(300);
});
it("orders independent covers and inner pages and keeps a single-page cover width", async () => {
  const single = planSurfaces(await snapshot(0, "singlePage", true));
  expect(single.map((s) => s.id)).toEqual([
    "cover:front",
    "spread_1:left",
    "spread_1:right",
    "cover:back",
  ]);
  expect(single[0].pixelWidth).toBe(3543);
  const spread = planSurfaces(await snapshot(0, "spread", true));
  expect(spread.map((s) => s.fileStem)).toEqual([
    "0001-front",
    "0002-spread-01",
    "0003-back",
  ]);
  expect(spread[1].pixelWidth).toBe(7087);
});
it("copies and freezes saved inputs without modifying later revisions", async () => {
  const doc = parseDocument({ ...structuredClone(fixture), revision: 12 });
  const record = {
    doc,
    docHash: await hashDocument(doc),
    resources: { assets: [], fonts: [] },
    savedAt: "2026-10-21T12:00:00Z",
  };
  const options: ExportOptions = {
    format: "png",
    dpi: 300,
    view: "spread",
    pageIds: ["spread_1"],
    includeCover: false,
    bleedMm: 0,
    jpegMatte: "#ffffff",
  };
  const snap = await freezeSnapshot(record, options, "2026-10-21T12:01:00Z");
  doc.revision = 13;
  options.dpi = 72;
  expect(snap.revision).toBe(12);
  expect(snap.options.dpi).toBe(300);
  expect(Object.isFrozen(snap.doc.spreads[0])).toBe(true);
});
it("rejects unknown or incompatible page selection and untrusted saved hashes", async () => {
  const snap = await snapshot();
  expect(() =>
    planSurfaces({
      ...snap,
      options: { ...snap.options, pageIds: ["spread_1:left"] },
    }),
  ).toThrow();
  await expect(
    freezeSnapshot(
      {
        doc: snap.doc,
        docHash: "0".repeat(64),
        resources: snap.resources,
        savedAt: snap.createdAt,
      },
      snap.options,
      snap.createdAt,
    ),
  ).rejects.toThrow();
});
it("binds warnings to a snapshot and requires explicit acknowledgements", async () => {
  const snap = await snapshot();
  const report = await preflight(
    snap,
    {
      read: async () => {
        throw new Error("unused");
      },
    },
    new AbortController().signal,
  );
  expect(() => authorizeExport(snap, report, ["warning_1"])).toThrow(
    "WARNINGS_UNACKNOWLEDGED",
  );
  expect(() => authorizeExport(snap, report, [])).not.toThrow();
  expect(() =>
    authorizeExport(
      { ...snap, options: { ...snap.options, dpi: 72 } },
      report,
      ["warning_1"],
    ),
  ).toThrow();
});
it("reports excessive output pixels as a blocker instead of reducing output dimensions", async () => {
  const snap = await snapshot();
  const doc = parseDocument({
    ...snap.doc,
    pageSize: { width: 100000, height: 100000 },
  });
  const huge = await freezeSnapshot(
    {
      doc,
      docHash: await hashDocument(doc),
      resources: snap.resources,
      savedAt: snap.createdAt,
    },
    snap.options,
    snap.createdAt,
  );
  const report = await preflight(
    huge,
    {
      read: async () => {
        throw new Error("missing");
      },
    },
    new AbortController().signal,
  );
  expect(report.blockers.map((i) => i.code)).toContain("PIXEL_BUDGET");
  expect(report.surfaces[0].pixelWidth).toBeGreaterThan(100000);
});
it("uses the actual contain/cover drawing region and enclosing uniform group scale for PPI", () => {
  const image: any = {
    width: 200,
    height: 200,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    fitMode: "cover",
  };
  expect(effectivePpi(image, { width: 400, height: 200 }, 1)).toBe(96);
  expect(
    effectivePpi(
      { ...image, fitMode: "contain" },
      { width: 400, height: 200 },
      1,
    ),
  ).toBe(192);
  expect(
    effectivePpi(
      { ...image, fitMode: "contain" },
      { width: 400, height: 200 },
      2,
    ),
  ).toBe(96);
});
it("blocks unsupported layout manifests and unknown render layers explicitly", async () => {
  const snap = await snapshot();
  const doc = parseDocument({
    ...snap.doc,
    assignmentManifest: assignment,
    spreads: [
      {
        ...snap.doc.spreads[0],
        layers: [{ id: "future", type: "future_shader" }],
      },
    ],
  });
  const future = await freezeSnapshot(
    {
      doc,
      docHash: await hashDocument(doc),
      resources: snap.resources,
      savedAt: snap.createdAt,
    },
    snap.options,
    snap.createdAt,
  );
  const report = await preflight(
    future,
    {
      read: async () => {
        throw new Error("missing");
      },
    },
    new AbortController().signal,
  );
  expect(report.blockers.map((i) => i.code)).toEqual(
    expect.arrayContaining([
      "UNSUPPORTED_LAYER",
      "UNSUPPORTED_LAYOUT_MANIFEST",
    ]),
  );
});
it("warns when important text enters the trim safety zone or binding gutter", async () => {
  const snap = await snapshot();
  const text: any = {
    id: "title",
    type: "text",
    x: 0,
    y: 0,
    width: 1200,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    text: "标题",
    fontAssetId: "font_missing",
    fontSize: 40,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    fill: "#000000",
    critical: true,
  };
  const doc = parseDocument({
    ...snap.doc,
    spreads: [{ ...snap.doc.spreads[0], layers: [text] }],
  });
  const future = await freezeSnapshot(
    {
      doc,
      docHash: await hashDocument(doc),
      resources: snap.resources,
      savedAt: snap.createdAt,
    },
    snap.options,
    snap.createdAt,
  );
  const report = await preflight(
    future,
    {
      read: async () => {
        throw new Error("missing");
      },
    },
    new AbortController().signal,
  );
  expect(report.warnings.map((i) => i.code)).toEqual(
    expect.arrayContaining(["SAFE_AREA", "GUTTER_TEXT"]),
  );
});
it("rejects forged preflight reports and makes genuine blockers immutable", async () => {
  const snap = await snapshot();
  const doc = parseDocument({
      ...snap.doc,
      spreads: [
        {
          ...snap.doc.spreads[0],
          layers: [{ id: "future", type: "future_shader" }],
        },
      ],
    }),
    s = await freezeSnapshot(
      {
        doc,
        docHash: await hashDocument(doc),
        resources: snap.resources,
        savedAt: snap.createdAt,
      },
      snap.options,
      snap.createdAt,
    ),
    report = await preflight(
      s,
      {
        read: async () => {
          throw new Error("unused");
        },
      },
      new AbortController().signal,
    );
  expect(() => {
    report.blockers.length = 0;
  }).toThrow();
  expect(() => authorizeExport(s, { ...report, blockers: [] }, [])).toThrow(
    "PREFLIGHT_UNVERIFIED",
  );
});
it("accepts the exact50MP surface boundary and refuses the next output column without rescaling", async () => {
  const base = await snapshot();
  for (const width of [6666.666667, 6667.333333]) {
    const doc = parseDocument({
        ...base.doc,
        pageSize: { width, height: 6666.666667 },
      }),
      options = { ...base.options, dpi: 72 as const, bleedMm: 0 },
      snap = await freezeSnapshot(
        {
          doc,
          docHash: await hashDocument(doc),
          resources: base.resources,
          savedAt: base.createdAt,
        },
        options,
        base.createdAt,
      ),
      report = await preflight(
        snap,
        {
          read: async () => {
            throw new Error("unused");
          },
        },
        new AbortController().signal,
      );
    expect(report.surfaces[0].pixelHeight).toBe(5000);
    expect(report.blockers.some((b) => b.code === "PIXEL_BUDGET")).toBe(
      width > 6667,
    );
    expect(report.surfaces[0].pixelWidth).toBe(width > 6667 ? 10001 : 10000);
  }
});
it("honors a lower environment memory budget instead of silently lowering output quality", async () => {
  const snap = await snapshot(),
    report = await preflight(
      snap,
      {
        read: async () => {
          throw new Error("unused");
        },
      },
      new AbortController().signal,
      { memoryBudgetBytes: 64 * 1024 ** 2 },
    );
  expect(report.blockers.map((b) => b.code)).toContain("MEMORY_BUDGET");
  expect(report.surfaces[0].pixelWidth).toBe(7157);
});
