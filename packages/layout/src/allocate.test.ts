import { describe, it, expect } from "vitest";
import fixture from "../../../tests/fixtures/documents/minimal.json";
import type { DocumentModel, ImageLayer } from "@album/document";
import { prepareLayout } from "./prepare";
import type { LayoutInput } from "./types";
import { allocateBook } from "./allocate";
const doc = (n: number): DocumentModel =>
  ({
    ...structuredClone(fixture),
    spreads: Array.from({ length: n }, (_, i) => ({
      id: `s${i}`,
      background: "#ffffff",
      layers: [],
    })),
  }) as DocumentModel;
const input = (n: number, pages: number, min = 2, max = 4): LayoutInput => ({
  projectId: fixture.projectId,
  baseRevision: fixture.revision,
  photos: Array.from({ length: n }, (_, i) => ({
    assetId: `p${i}`,
    width: 1000,
    height: 800,
  })),
  constraints: {
    spreadCount: pages,
    minPhotosPerSpread: min,
    maxPhotosPerSpread: max,
    selectionPolicy: "all",
    duplicatePolicy: "forbid",
    orderPolicy: "user",
  },
  templateRef: { id: "tpl_travel", version: 1, sha256: "a".repeat(64) },
  algorithmVersion: "local-layout-v1",
  seed: 1,
});
const image = (id: string, assetId: string, locked = true): ImageLayer => ({
  id,
  assetId,
  type: "image",
  locked,
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  opacity: 1,
  rotation: 0,
  visible: true,
  crop: { x: 0, y: 0, width: 1, height: 1 },
});
describe("allocateBook", () => {
  it("places all twelve on four in contiguous order without duplicates", async () => {
    const i = input(12, 4),
      p = await prepareLayout(i),
      r = allocateBook(p, doc(4));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.spreads.flatMap((s) => s.assetIds)).toEqual(
      p.orderedAssetIds,
    );
    expect(r.value.unusedAssetIds).toEqual([]);
    expect(r.value.spreads.map((s) => s.assetIds.length)).toEqual([3, 3, 3, 3]);
    expect(allocateBook(p, doc(4))).toEqual(r);
  });
  it("reports minimum twenty-five spreads for fifty at capacity two", async () => {
    expect(
      allocateBook(await prepareLayout(input(50, 10, 1, 2)), doc(10)),
    ).toMatchObject({
      ok: false,
      conflicts: [{ code: "CAPACITY_EXCEEDED", minimumRequiredSpreads: 25 }],
    });
  });
  it("preserves locked photos and detects locked overflow", async () => {
    const d = doc(2);
    d.spreads[0].layers = [
      image("a", "p0"),
      image("b", "p1"),
      image("c", "p2"),
    ];
    expect(
      allocateBook(await prepareLayout(input(4, 2, 1, 2)), d),
    ).toMatchObject({ ok: false, conflicts: [{ code: "LOCKED_CAPACITY" }] });
  });
  it("rejects locked photos outside selection", async () => {
    const d = doc(2);
    d.spreads[0].layers = [image("a", "unknown")];
    expect(allocateBook(await prepareLayout(input(4, 2)), d)).toMatchObject({
      ok: false,
      conflicts: [{ code: "LOCKED_ASSET_NOT_SELECTED", assetIds: ["unknown"] }],
    });
  });
  it("leaves non-target spreads fixed and counts their photos once", async () => {
    const i = input(6, 3);
    i.constraints.targetSpreadIds = ["s1", "s2"];
    const d = doc(3);
    d.spreads[0].layers = [image("a", "p0", false), image("b", "p1", false)];
    const r = allocateBook(await prepareLayout(i), d);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.spreads[0].assetIds).toEqual(["p0", "p1"]);
    expect(r.value.spreads.flatMap((s) => s.assetIds)).toEqual(
      i.photos.map((p) => p.assetId),
    );
  });
  it("only drops optional photos with explicit selection policy", async () => {
    const i = input(7, 2, 1, 2);
    i.constraints.selectionPolicy = "allowSelection";
    i.constraints.requiredAssetIds = ["p6"];
    const r = allocateBook(await prepareLayout(i), doc(2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.spreads.flatMap((s) => s.assetIds)).toContain("p6");
    expect(r.value.unusedAssetIds).toHaveLength(3);
  });
  it("does not repeat unless the exact asset has permission", async () => {
    const i = input(1, 2, 1, 2);
    expect(allocateBook(await prepareLayout(i), doc(2)).ok).toBe(false);
    i.constraints.duplicatePolicy = "allowExplicit";
    i.constraints.explicitRepeatAssetIds = ["p0"];
    const r = allocateBook(await prepareLayout(i), doc(2));
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(r.value.spreads.flatMap((s) => s.assetIds)).toEqual(["p0", "p0"]);
  });
  it("cannot use all-selection together with exclusions to silently drop a photo", async () => {
    const i = input(4, 2);
    i.constraints.excludedAssetIds = ["p0"];
    expect(allocateBook(await prepareLayout(i), doc(2)).ok).toBe(false);
  });
  it("does not move photos through a locked spread to repair impossible order", async () => {
    const i = input(4, 2, 2, 2);
    const d = doc(2);
    d.spreads[0].layers = [image("a", "p3")];
    expect(allocateBook(await prepareLayout(i), d).ok).toBe(false);
  });
  it("rejects unknown lock and target IDs", async () => {
    const i = input(4, 2);
    i.constraints.lockedLayerIds = ["missing"];
    expect(allocateBook(await prepareLayout(i), doc(2)).ok).toBe(false);
  });
});
it("retains the whole ancestor branch when a nested sibling is locked", async () => {
  const i = input(4, 2),
    d = doc(2);
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
        image("photo", "p0", false),
        {
          id: "lockedshape",
          type: "shape",
          x: 0,
          y: 0,
          width: 10,
          height: 10,
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
  const r = allocateBook(await prepareLayout(i), d);
  expect(r.ok).toBe(true);
  if (r.ok) expect(r.value.spreads[0].assetIds).toContain("p0");
  i.photos = i.photos.slice(1);
  expect(allocateBook(await prepareLayout(i), d)).toMatchObject({
    ok: false,
    conflicts: [{ code: "LOCKED_ASSET_NOT_SELECTED" }],
  });
});
it("satisfies exact locked repeated occurrences before filling minimum capacity", async () => {
  const i = input(2, 1, 0, 3),
    d = doc(1);
  i.constraints.duplicatePolicy = "allowExplicit";
  i.constraints.explicitRepeatAssetIds = ["p0", "p1"];
  d.spreads[0].layers = [image("locked1", "p1"), image("locked2", "p1")];
  const result = allocateBook(await prepareLayout(i), d);
  expect(result.ok).toBe(true);
  if (result.ok)
    expect(result.value.spreads[0].assetIds).toEqual(["p0", "p1", "p1"]);
});
