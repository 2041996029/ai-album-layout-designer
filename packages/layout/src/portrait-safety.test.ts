import { it, expect } from "vitest";
import {
  instantiateTemplate,
  isImageLayer,
  templateVersions,
  type DocumentModel,
} from "@album/document";
import { prepareLayout } from "./prepare";
import { composeSpread } from "./compose";
import fixture from "../../../tests/fixtures/documents/minimal.json";

it("template auto-fill keeps the entire portrait instead of cutting eyes in a landscape slot", () => {
  const template =
    templateVersions.find((t) => t.id === "style_japanese_3") ??
    templateVersions.find((t) => t.slots.some((s) => s.kind === "image"))!;
  const bindings = Object.fromEntries(
    template.slots
      .filter((s) => s.kind === "image")
      .map((s) => [s.slotId, "portrait"]),
  );
  let n = 0;
  const layers = instantiateTemplate(
    template,
    bindings,
    () => `safe_${n++}`,
  ).filter(isImageLayer);
  expect(layers.length).toBeGreaterThan(0);
  expect(
    layers.every(
      (l) =>
        l.fitMode === "contain" &&
        l.crop.x === 0 &&
        l.crop.y === 0 &&
        l.crop.width === 1 &&
        l.crop.height === 1,
    ),
  ).toBe(true);
});

it("whole-book variants never crop a portrait when subject location is unknown", async () => {
  const doc = structuredClone(fixture) as DocumentModel;
  const template = templateVersions.find((t) => t.id === "tpl_travel")!;
  const p = await prepareLayout({
    projectId: doc.projectId,
    baseRevision: doc.revision,
    photos: [{ assetId: "selfie", width: 1080, height: 1438 }],
    constraints: {
      spreadCount: 1,
      minPhotosPerSpread: 1,
      maxPhotosPerSpread: 3,
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
  });
  for (const variant of [0, 1, 2]) {
    const composed = composeSpread(
      p,
      {
        spreads: [{ spreadId: doc.spreads[0].id, assetIds: ["selfie"] }],
        unusedAssetIds: [],
      },
      doc,
      template,
      [],
      variant,
    );
    const photo = composed[0].layers.filter(isImageLayer)[0];
    expect(photo.fitMode).toBe("contain");
    expect(photo.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  }
});

it("protects every detected subject in a group photo, not just the first face", async () => {
  const doc = structuredClone(fixture) as DocumentModel;
  const template = templateVersions.find((t) => t.id === "tpl_travel")!;
  const p = await prepareLayout({
    projectId: doc.projectId,
    baseRevision: doc.revision,
    photos: Array.from({ length: 4 }, (_, i) => ({
      assetId: `group_${i}`,
      width: 200,
      height: 100,
    })),
    constraints: {
      spreadCount: 1,
      minPhotosPerSpread: 1,
      maxPhotosPerSpread: 4,
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
  });
  const hints = [
    {
      assetId: "group_0",
      rect: { x: 0.45, y: 0.4, width: 0.1, height: 0.1 },
      confidence: 0.9,
    },
    {
      assetId: "group_0",
      rect: { x: 0, y: 0, width: 0.06, height: 0.1 },
      confidence: 0.9,
    },
  ];
  const spread = composeSpread(
    p,
    {
      spreads: [
        {
          spreadId: doc.spreads[0].id,
          assetIds: p.input.photos.map((x) => x.assetId),
        },
      ],
      unusedAssetIds: [],
    },
    doc,
    template,
    hints,
  )[0];
  const photo = spread.layers
    .filter(isImageLayer)
    .find((x) => x.assetId === "group_0")!;
  for (const { rect } of hints) {
    expect(photo.crop.x).toBeLessThanOrEqual(rect.x);
    expect(photo.crop.y).toBeLessThanOrEqual(rect.y);
    expect(photo.crop.x + photo.crop.width).toBeGreaterThanOrEqual(
      rect.x + rect.width,
    );
    expect(photo.crop.y + photo.crop.height).toBeGreaterThanOrEqual(
      rect.y + rect.height,
    );
  }
});
