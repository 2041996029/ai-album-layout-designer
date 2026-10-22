import { it, expect } from "vitest";
import {
  templateVersions,
  type DocumentModel,
  isImageLayer,
} from "@album/document";
import fixture from "../../../tests/fixtures/documents/minimal.json";
import { prepareLayout } from "./prepare";
import { generateCandidates } from "./candidates";
import { deriveAssignment, verifyCandidate } from "./integrity";
import type { LayoutInput } from "./types";
export async function book() {
  const d = {
    ...structuredClone(fixture),
    spreads: Array.from({ length: 4 }, (_, i) => ({
      id: `s${i}`,
      background: "#ffffff",
      layers: [],
    })),
  } as DocumentModel;
  const t = templateVersions.find((t) => t.id === "tpl_travel")!;
  const input: LayoutInput = {
    projectId: d.projectId,
    baseRevision: d.revision,
    photos: Array.from({ length: 12 }, (_, i) => ({
      assetId: `p${i}`,
      width: 1000,
      height: 800,
    })),
    constraints: {
      spreadCount: 4,
      minPhotosPerSpread: 2,
      maxPhotosPerSpread: 4,
      selectionPolicy: "all",
      duplicatePolicy: "forbid",
      orderPolicy: "user",
    },
    templateRef: { id: t.id, version: t.version, sha256: t.sha256 },
    algorithmVersion: "local-layout-v1",
    seed: 1,
  };
  return { d, t, input, p: await prepareLayout(input) };
}
it("generates actual editable candidates with twelve verified placements", async () => {
  const { p, d, t, input } = await book();
  const candidates = generateCandidates(p, d, t, []);
  expect(candidates.length).toBeGreaterThan(0);
  expect(candidates.length).toBeLessThanOrEqual(3);
  for (const c of candidates) {
    expect(c.assignmentManifest.placements).toHaveLength(12);
    expect(c.assignmentManifest.unusedAssetIds).toEqual([]);
    expect(verifyCandidate(input, d, c)).toEqual([]);
  }
});
it("rejects a manifest claiming a photo absent from actual candidate layers", async () => {
  const { p, d, t, input } = await book();
  const c = structuredClone(generateCandidates(p, d, t, [])[0]);
  const i = c.spreads[0].layers.findIndex(isImageLayer);
  c.spreads[0].layers.splice(i, 1);
  expect(verifyCandidate(input, d, c)).toContain("MANIFEST_DOCUMENT_MISMATCH");
  expect(verifyCandidate(input, d, c)).toContain("MISSING_PHOTO");
});
it("does not count decorative image layers as selected photographs", async () => {
  const { p, d, t, input } = await book();
  const c = generateCandidates(p, d, t, [])[0],
    actual = { ...d, spreads: structuredClone(c.spreads) };
  const photo = actual.spreads[0].layers.find(isImageLayer)!;
  actual.spreads[0].layers.push({
    ...photo,
    id: "decoration",
    layoutPhotoRole: "decoration",
  });
  expect(deriveAssignment(input, actual).placements).toHaveLength(12);
});
it("rejects changed locked text and fixed pages", async () => {
  const { input, d, t } = await book();
  const text = {
    id: "caption",
    type: "text",
    x: 10,
    y: 10,
    width: 100,
    height: 20,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: true,
    text: "保留",
    fontAssetId: "noto-sans-sc",
    fontSize: 12,
    fontWeight: 400,
    lineHeight: 1.2,
    letterSpacing: 0,
    fill: "#000000",
  };
  d.spreads[0].layers.push(text);
  const p = await prepareLayout(input),
    c = structuredClone(generateCandidates(p, d, t, [])[0]);
  expect(c).toBeDefined();
  c.spreads[0].layers.find((l) => l.id === "caption")!.text = "篡改";
  expect(verifyCandidate(input, d, c)).toContain("LOCKED_LAYER_CHANGED");
});
it("deduplicates identical candidate geometry rather than filling the count", async () => {
  const { input, d, t } = await book();
  input.constraints.lockedSpreadIds = d.spreads.map((s) => s.id);
  expect(generateCandidates(await prepareLayout(input), d, t, [])).toEqual([]);
});
it("rejects hard-invalid actual candidate frames independent of manifest claims", async () => {
  const { p, d, t, input } = await book();
  const c = structuredClone(generateCandidates(p, d, t, [])[0]);
  const layer = c.spreads[0].layers.find(isImageLayer)!;
  layer.x = d.pageSize.width * 4;
  expect(verifyCandidate(input, d, c)).toContain("FRAME_OUT_OF_BOUNDS");
});
it("does not move a locked child by changing its ancestor group", async () => {
  const { input, d, t } = await book();
  d.spreads[0].layers = [
    {
      id: "group",
      type: "group",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      children: [
        {
          id: "locked",
          type: "shape",
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: true,
          shapeKind: "rectangle",
          fill: "#ffffff",
          stroke: "#ffffff",
          strokeWidth: 0,
        },
      ],
    },
  ];
  const p = await prepareLayout(input),
    c = structuredClone(generateCandidates(p, d, t, [])[0]);
  c.spreads[0].layers.find((l) => l.id === "group")!.x = 50;
  expect(verifyCandidate(input, d, c)).toContain("LOCKED_LAYER_CHANGED");
});
it("rejects locked photos overflowing after an ancestor transform", async () => {
  const { d, input, t } = await book();
  const photo = {
    id: "locked_photo",
    type: "image",
    assetId: "p0",
    x: 90,
    y: 0,
    width: 100,
    height: 100,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: true,
    crop: { x: 0, y: 0, width: 1, height: 1 },
  };
  d.spreads[0].layers = [
    {
      id: "transformed_group",
      type: "group",
      x: d.pageSize.width * 2 - 100,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      children: [photo],
    },
  ];
  expect(generateCandidates(await prepareLayout(input), d, t, [])).toEqual([]);
});
it("rejects locked rotated photos whose corners leave the page", async () => {
  const { d, input, t } = await book();
  d.spreads[0].layers = [
    {
      id: "rotated",
      type: "image",
      assetId: "p0",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 90,
      opacity: 1,
      visible: true,
      locked: true,
      crop: { x: 0, y: 0, width: 1, height: 1 },
    },
  ];
  expect(generateCandidates(await prepareLayout(input), d, t, [])).toEqual([]);
});
