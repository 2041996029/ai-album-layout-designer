import { it, expect } from "vitest";
import {
  templateVersions,
  isImageLayer,
  type DocumentModel,
} from "@album/document";
import fixture from "../../../tests/fixtures/documents/minimal.json";
import { prepareLayout } from "./prepare";
import { composeSpread } from "./compose";
import type { LayoutInput } from "./types";
const template = templateVersions.find((t) => t.id === "tpl_travel")!;
async function setup(count = 3) {
  const d = structuredClone(fixture) as DocumentModel;
  const i: LayoutInput = {
    projectId: d.projectId,
    baseRevision: d.revision,
    photos: Array.from({ length: count }, (_, i) => ({
      assetId: `p${i}`,
      width: i ? 10 : 10000,
      height: i ? 10000 : 10,
    })),
    constraints: {
      spreadCount: 1,
      minPhotosPerSpread: 1,
      maxPhotosPerSpread: 10,
      selectionPolicy: "all",
      duplicatePolicy: "forbid",
      orderPolicy: "user",
    },
    templateRef: {
      id: template.id,
      version: template.version,
      sha256: template.sha256,
    },
    algorithmVersion: "local-layout-v1",
    seed: 1,
  };
  return {
    d,
    p: await prepareLayout(i),
    a: {
      spreads: [
        { spreadId: d.spreads[0].id, assetIds: i.photos.map((p) => p.assetId) },
      ],
      unusedAssetIds: [],
    },
  };
}
it("composes fixed finite bounded editable photo frames without altering template", async () => {
  const { p, a, d } = await setup(),
    before = JSON.stringify(template);
  const r = composeSpread(p, a, d, template, [])[0];
  expect(r.hardViolations).toEqual([]);
  expect(r.layers.filter(isImageLayer)).toHaveLength(3);
  expect(JSON.stringify(template)).toBe(before);
  for (const l of r.layers.filter(isImageLayer)) {
    expect(l.width).toBeGreaterThan(0);
    expect(l.x + l.width).toBeLessThanOrEqual(d.pageSize.width * 2 + 0.00001);
    expect(l.y + l.height).toBeLessThanOrEqual(d.pageSize.height + 0.00001);
    expect(l.crop.width).toBeGreaterThan(0);
    expect(l.crop.x + l.crop.width).toBeLessThanOrEqual(1);
  }
  expect(r.warnings).toContain("SUBJECT_UNKNOWN");
  expect(r.score.subject).toBe(0.5);
  expect(r.score.color).toBe(0.5);
});
it("fits a different photo count without missing photos or duplicating placeholders", async () => {
  const { p, a, d } = await setup(4);
  const r = composeSpread(p, a, d, template, [])[0];
  expect(r.hardViolations).toEqual([]);
  expect(r.layers.filter(isImageLayer).map((l) => l.assetId)).toEqual([
    "p0",
    "p1",
    "p2",
    "p3",
  ]);
});
it("warns about a trusted subject outside the crop", async () => {
  const { p, a, d } = await setup();
  const r = composeSpread(p, a, d, template, [
    {
      assetId: "p0",
      rect: { x: 0, y: 0, width: 0.1, height: 0.1 },
      confidence: 0.9,
    },
  ])[0];
  expect(r.warnings).toContain("SUBJECT_CROP_RISK");
});
it("rejects invalid geometry before using scores", async () => {
  const { p, a, d } = await setup();
  d.pageSize.width = NaN;
  const r = composeSpread(p, a, d, template, [])[0];
  expect(r.hardViolations).toContain("FRAME_OUT_OF_BOUNDS");
  expect(r.score.total).toBe(-1);
});
it("uses matching fixed style geometry when allocated photo count differs from selected variant", async () => {
  const { d, a, p: base } = await setup(4);
  const t = templateVersions.find((t) => t.id === "style_jk_2")!;
  const sibling = templateVersions.find((t) => t.id === "style_jk_4")!;
  const p = await prepareLayout({
    ...base.input,
    templateRef: { id: t.id, version: t.version, sha256: t.sha256 },
  });
  const r = composeSpread(p, a, d, t, [])[0];
  expect(
    composeSpread(p, a, d, t, [], 1)[0].layers.filter((l) => l.type === "text"),
  ).toHaveLength(2);
  expect(r.layers.filter((l) => l.type === "text")).toHaveLength(2);
  const scale = d.pageSize.height / sibling.pageSize.height;
  expect(r.layers.filter(isImageLayer).map((l) => l.width)).toEqual(
    sibling.slots
      .filter((s) => s.kind === "image")
      .map((s) => s.frame.width * scale),
  );
  expect(r.layers.filter(isImageLayer).map((l) => l.assetId)).toEqual([
    "p0",
    "p1",
    "p2",
    "p3",
  ]);
  expect(r.hardViolations).toEqual([]);
});
