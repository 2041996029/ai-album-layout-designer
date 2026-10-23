import { expect, it } from "vitest";
import fixture from "../../../tests/fixtures/documents/minimal.json";
import { isImageLayer, type DocumentModel } from "@album/document";
import type { ImportedTheme } from "@album/template-import";
import type { LayoutInput } from "./types";
import { generateThemeCandidates } from "./theme-layout";
import { createLayoutCommand } from "./apply";
function setup(counts = [1, 2]) {
  const d = structuredClone(fixture) as DocumentModel;
  const theme = {
    version: 1,
    id: "theme_test",
    name: "Theme",
    sourceHash: "a".repeat(64),
    resources: { assets: [], fonts: [] },
    issues: [],
    pages: counts.map((n, i) => ({
      id: `page_${i}`,
      name: "Page",
      width: 200,
      height: 100,
      previewPath: "preview.png",
      background: "#ffffff",
      issues: [],
      photoSlots: Array.from({ length: n }, (_, j) => ({
        slotId: `slot_${j}`,
        layerId: `image_${j}`,
        required: true,
      })),
      layers: Array.from({ length: n }, (_, j) => ({
        id: `image_${j}`,
        type: "image",
        x: j * 60,
        y: 10,
        width: 50,
        height: 80,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        assetId: "demo",
        crop: { x: 0, y: 0, width: 1, height: 1 },
      })),
    })),
  } as ImportedTheme;
  const input = {
    projectId: d.projectId,
    baseRevision: d.revision,
    photos: Array.from(
      { length: counts.reduce((a, b) => a + b, 0) },
      (_, i) => ({ assetId: `photo_${i}`, width: 100, height: 100 }),
    ),
    constraints: {
      spreadCount: counts.length,
      minPhotosPerSpread: 1,
      maxPhotosPerSpread: 4,
      selectionPolicy: "all",
      duplicatePolicy: "forbid",
      orderPolicy: "user",
    },
    templateRef: { id: theme.id, version: 1, sha256: theme.sourceHash },
    templatePageIds: theme.pages.map((p) => p.id),
    algorithmVersion: "local-layout-v1",
    seed: 1,
  } as LayoutInput;
  return { d, theme, input };
}
it("uses ordered exact page capacities without demonstration photos or grid fallback", async () => {
  const { d, theme, input } = setup(
    Array.from({ length: 15 }, (_, i) => (i % 3) + 1),
  );
  const [c] = await generateThemeCandidates(
    input,
    d,
    theme,
    theme.pages.map((p) => p.id),
  );
  expect(c.spreads.map((s) => s.layers.filter(isImageLayer).length)).toEqual(
    theme.pages.map((p) => p.photoSlots.length),
  );
  expect(
    c.spreads.flatMap((s) =>
      s.layers.filter(isImageLayer).map((l) => l.assetId),
    ),
  ).toEqual(input.photos.map((p) => p.assetId));
  expect(c.assignmentManifest.violations).toEqual([]);
  expect(() => createLayoutCommand(input, c, d)).not.toThrow();
  await expect(
    generateThemeCandidates(
      { ...input, photos: input.photos.slice(1) },
      d,
      theme,
      theme.pages.map((p) => p.id),
    ),
  ).rejects.toThrow("THEME_CAPACITY_MISMATCH");
});
it("scales matching aspects and rejects distortion", async () => {
  const { d, theme, input } = setup([1]);
  theme.pages[0].width = 100;
  await expect(
    generateThemeCandidates(input, d, theme, ["page_0"]),
  ).rejects.toThrow("PAGE_ASPECT_MISMATCH");
});
it("binds page ordering to the input and rejects stale candidates", async () => {
  const { d, theme, input } = setup([1, 1]);
  const ids = theme.pages.map((p) => p.id);
  const [a] = await generateThemeCandidates(input, d, theme, ids);
  const [b] = await generateThemeCandidates(
    { ...input, templatePageIds: [...ids].reverse() } as LayoutInput,
    d,
    theme,
    [...ids].reverse(),
  );
  expect(a.inputHash).not.toBe(b.inputHash);
  expect(() => createLayoutCommand(input, a, { ...d, revision: 2 })).toThrow(
    "STALE",
  );
  expect(() => createLayoutCommand(input, structuredClone(a), d)).toThrow(
    "UNTRUSTED",
  );
});
it("preserves an entire page when a layer is locked and reports incompatible capacity", async () => {
  const { d, theme, input } = setup([1]);
  const [first] = await generateThemeCandidates(input, d, theme, ["page_0"]);
  d.spreads = structuredClone(first.spreads);
  const image = d.spreads[0].layers.find(isImageLayer)!;
  image.locked = true;
  const [next] = await generateThemeCandidates(input, d, theme, ["page_0"]);
  expect(next.spreads[0]).toEqual(d.spreads[0]);
  const wrong = {
    ...input,
    photos: [{ assetId: "other", width: 100, height: 100 }],
  };
  await expect(
    generateThemeCandidates(wrong, d, theme, ["page_0"]),
  ).rejects.toThrow("THEME_CAPACITY_MISMATCH");
});
it("retains decorative assets outside selection and binds hashes to the source package", async () => {
  const { d, theme, input } = setup([1]);
  theme.pages[0].layers.push({ ...theme.pages[0].layers[0], id: "decoration" });
  const [a] = await generateThemeCandidates(input, d, theme, ["page_0"]);
  expect(a.assignmentManifest.placements).toHaveLength(1);
  expect(
    a.spreads[0].layers.filter(isImageLayer).find((l) => l.assetId === "demo")
      ?.layoutPhotoRole,
  ).toBe("decoration");
  const changed = { ...theme, sourceHash: "b".repeat(64) };
  const [b] = await generateThemeCandidates(
    {
      ...input,
      templateRef: { ...input.templateRef, sha256: changed.sourceHash },
    },
    d,
    changed,
    ["page_0"],
  );
  expect(a.inputHash).not.toBe(b.inputHash);
  expect(Object.isFrozen(a.spreads[0].layers)).toBe(true);
  expect(() =>
    createLayoutCommand(
      input,
      { ...a, spreads: structuredClone(a.spreads) },
      d,
    ),
  ).toThrow("UNTRUSTED");
});
it("allows declared source overscan but rejects changed imported geometry", async () => {
  const { d, theme, input } = setup([1]);
  theme.pages[0].layers[0].rotation = 15;
  theme.pages[0].layers.push({
    ...theme.pages[0].layers[0],
    id: "bleed_decoration",
    x: -10,
    width: 220,
    rotation: 0,
  });
  const [candidate] = await generateThemeCandidates(input, d, theme, [
    "page_0",
  ]);
  expect(candidate.constraintReport.valid).toBe(true);
  const changed = structuredClone(candidate);
  changed.spreads[0].layers[1].width = 99999;
  const { verifyCandidate } = await import("./integrity");
  expect(verifyCandidate(input, d, changed)).toContain("FRAME_OUT_OF_BOUNDS");
  const mask = structuredClone(candidate);
  mask.spreads[0].layers[0].alphaMask = { version: 1, assetId: "forged_mask" };
  expect(verifyCandidate(input, d, mask)).toContain("FRAME_OUT_OF_BOUNDS");
});
it("rejects blocked source pages before composition", async () => {
  const { d, theme, input } = setup([1]);
  theme.pages[0].issues.push({
    code: "UNSUPPORTED_TEXT",
    severity: "blocker",
    message: "Cannot preserve source text",
  });
  await expect(
    generateThemeCandidates(input, d, theme, ["page_0"]),
  ).rejects.toThrow("UNSUPPORTED_TEMPLATE_PAGE");
});

it("creates every requested page with sparse photos and never imports demonstration assets", async () => {
  const { d, theme, input } = setup(Array(8).fill(2));
  input.photos = input.photos.slice(0, 6);
  input.constraints.minPhotosPerSpread = 0;
  const [candidate] = await generateThemeCandidates(
    input,
    d,
    theme,
    input.templatePageIds!,
    { replaceBook: true, allowEmptySlots: true },
  );
  expect(candidate.spreads).toHaveLength(8);
  expect(
    candidate.spreads.map((s) => s.layers.filter(isImageLayer).length),
  ).toEqual([1, 1, 1, 1, 1, 1, 0, 0]);
  expect(
    candidate.assignmentManifest.placements.map((p) => p.assetId).sort(),
  ).toEqual(input.photos.map((p) => p.assetId).sort());
  expect(candidate.assignmentManifest.violations).toEqual([]);
  expect(() => createLayoutCommand(input, candidate, d)).not.toThrow();
});

it("replaces trailing populated pages while keeping locked content protected", async () => {
  const full = setup([1, 1, 1]);
  const [existing] = await generateThemeCandidates(
    full.input,
    full.d,
    full.theme,
    full.input.templatePageIds!,
  );
  const { theme, input } = setup([1]);
  const before = { ...full.d, spreads: structuredClone(existing.spreads) };
  const [replacement] = await generateThemeCandidates(
    input,
    before,
    theme,
    input.templatePageIds!,
    { replaceBook: true, allowEmptySlots: true },
  );
  expect(replacement.spreads).toHaveLength(1);
  before.spreads[2].layers[0].locked = true;
  await expect(
    generateThemeCandidates(input, before, theme, input.templatePageIds!, {
      replaceBook: true,
      allowEmptySlots: true,
    }),
  ).rejects.toThrow("LOCKED_LAYER_CHANGED");
});
