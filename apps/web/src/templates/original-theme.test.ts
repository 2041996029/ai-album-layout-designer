import { expect, it } from "vitest";
import type { ResourceManifest } from "@album/assets";
import {
  canonicalJson,
  sha256,
  templateVersions,
  parseDocument,
  isImageLayer,
  verifyImportedTemplateProof,
} from "@album/document";
import {
  generateThemeCandidates,
  createLayoutCommand,
  type LayoutInput,
} from "@album/layout";
import { History } from "../state/history";
import manifest from "../../public/fonts/manifest.json";
import fixture from "../../../../tests/fixtures/documents/minimal.json";
import { originalThemeBundle } from "./original-theme";
const resources = structuredClone(manifest) as ResourceManifest;
it("adapts eight signed originals with stable identity, only used fonts and safe editable previews", async () => {
  const a = await originalThemeBundle("qipao", resources),
    b = await originalThemeBundle("qipao", resources);
  expect(a.theme).toEqual(b.theme);
  const refs = templateVersions
    .filter((t) => t.themeId === "qipao")
    .map(({ id, version, sha256 }) => ({ id, version, sha256 }));
  expect(a.theme.sourceHash).toBe(await sha256(canonicalJson(refs)));
  expect(a.theme.id).toBe(`original_qipao_${a.theme.sourceHash.slice(0, 16)}`);
  expect(a.theme.pages).toHaveLength(8);
  expect(a.theme.pages.flatMap((p) => p.photoSlots)).toHaveLength(20);
  expect(a.theme.resources.assets).toEqual([]);
  expect(a.theme.resources.fonts.map((f) => f.id)).toEqual(["noto-serif-sc"]);
  for (const p of a.theme.pages) {
    expect(p.width).toBe(fixture.pageSize.width * 2);
    expect(
      p.photoSlots.every((s) =>
        p.layers.some((l) => l.id === s.layerId && isImageLayer(l)),
      ),
    ).toBe(true);
    const svg = new TextDecoder().decode(a.files.get(p.previewPath));
    expect(p.previewPath.endsWith(".svg")).toBe(true);
    expect(svg).toContain("示意");
    expect(svg).toContain("<text");
    expect(svg).toContain("<rect");
    expect(svg).not.toContain("<image");
  }
  expect(a.theme.resources.fonts[0]).not.toBe(
    resources.fonts.find((f) => f.id === a.theme.resources.fonts[0].id),
  );
});
it("rejects unknown originals and missing built-in fonts", async () => {
  await expect(originalThemeBundle("unknown", resources)).rejects.toThrow(
    "THEME_UNAVAILABLE",
  );
  await expect(
    originalThemeBundle("qipao", { assets: [], fonts: [] }),
  ).rejects.toThrow("FONT_UNAVAILABLE");
});
it("composes all twenty photos into eight proven spreads with no placeholder assets", async () => {
  const { theme } = await originalThemeBundle("qipao", resources),
    doc = parseDocument(fixture);
  const input: LayoutInput = {
    projectId: doc.projectId,
    baseRevision: doc.revision,
    photos: Array.from({ length: 20 }, (_, i) => ({
      assetId: `user_${i}`,
      width: 100,
      height: 100,
    })),
    constraints: {
      spreadCount: 8,
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
  };
  const [candidate] = await generateThemeCandidates(
    input,
    doc,
    theme,
    input.templatePageIds!,
  );
  expect(
    candidate.spreads.flatMap((s) =>
      s.layers.filter(isImageLayer).map((l) => l.assetId),
    ),
  ).toEqual(input.photos.map((p) => p.assetId));
  expect(candidate.assignmentManifest.violations).toEqual([]);
  for (const s of candidate.spreads)
    expect(await verifyImportedTemplateProof(s)).toBe(true);
  const history = new History(doc);
  history.execute(createLayoutCommand(input, candidate, doc));
  expect(history.undo()).toEqual(doc);
});
