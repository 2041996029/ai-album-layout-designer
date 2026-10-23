import { it, expect } from "vitest";
import { restorePhotoFit } from "./restore-photo-fit";
import { History } from "../state/history";
import type { DocumentModel, ImageLayer } from "@album/document";
import fixture from "../../../../tests/fixtures/documents/minimal.json";
it("repairs cover and spread portraits in one undo without changing layout or locked/decorative photos", () => {
  const doc = structuredClone(fixture) as DocumentModel;
  const photo = (id: string): ImageLayer => ({
    id,
    type: "image",
    assetId: "portrait",
    x: 20,
    y: 30,
    width: 456,
    height: 180,
    rotation: 0,
    visible: true,
    locked: false,
    opacity: 1,
    crop: { x: 0, y: 0.3, width: 1, height: 0.3 },
    fitMode: "cover",
    filter: { presetId: "F01", recipeVersion: 1, strength: 0.5, seed: 1 },
  });
  doc.cover.front = [photo("cover")];
  doc.spreads[0].layers = [
    photo("selfie"),
    { ...photo("decoration"), layoutPhotoRole: "decoration" },
    {
      id: "locked-parent",
      type: "group",
      x: 0,
      y: 0,
      width: 600,
      height: 400,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: true,
      children: [photo("locked-child")],
    },
  ];
  const history = new History(doc);
  const changed = history.execute(restorePhotoFit(doc, new Set(["portrait"])));
  for (const image of [
    changed.cover.front[0],
    changed.spreads[0].layers[0],
  ] as ImageLayer[]) {
    expect(image.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(image.fitMode).toBe("contain");
    expect([image.x, image.y, image.width, image.height]).toEqual([
      20, 30, 456, 180,
    ]);
    expect(image.filter).toEqual(photo("unused").filter);
  }
  expect(changed.spreads[0].layers.slice(1)).toEqual(
    doc.spreads[0].layers.slice(1),
  );
  expect(history.undo()).toEqual(doc);
});
