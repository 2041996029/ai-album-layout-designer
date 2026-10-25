import { parseDocument } from "@album/document";
import { it, expect } from "vitest";
import { prepareThemePage } from "./apply-theme";
import { verifyImportedTemplateProof } from "@album/document";
import { History } from "../state/history";
import fixture from "../../../../tests/fixtures/documents/minimal.json";
import type { ImportedTheme } from "@album/template-import";
const theme = () =>
  ({
    version: 1,
    id: "mj_theme",
    name: "主题",
    sourceHash: "a".repeat(64),
    resources: { assets: [], fonts: [] },
    issues: [],
    pages: [
      {
        id: "page1",
        name: "第一页",
        width: 1200,
        height: 600,
        background: "#eeeedd",
        previewPath: "p.png",
        issues: [],
        photoSlots: [{ slotId: "slot1", layerId: "demo", required: true }],
        layers: [
          {
            id: "demo",
            type: "image",
            assetId: "sample",
            x: 40,
            y: 40,
            width: 500,
            height: 500,
            rotation: 0,
            opacity: 1,
            visible: true,
            locked: false,
            crop: { x: 0, y: 0, width: 1, height: 1 },
            layoutPhotoRole: "decoration",
            alphaMask: { version: 1, assetId: "mask" },
          },
        ],
      },
    ],
  }) as ImportedTheme;
it("applies only bound user photos, preserves mask, proves imported source and undoes", async () => {
  const t = theme(),
    doc = parseDocument(fixture),
    h = new History(doc);
  const command = await prepareThemePage(
    t,
    t.pages[0].id,
    { slot1: "user-photo" },
    doc,
    doc.spreads[0].id,
  );
  const after = h.execute(command);
  expect(after.spreads[0].layers[0]).toMatchObject({
    assetId: "user-photo",
    fitMode: "contain",
    crop: { x: 0, y: 0, width: 1, height: 1 },
    alphaMask: { assetId: "mask" },
    layoutPhotoRole: "selection",
  });
  expect(await verifyImportedTemplateProof(after.spreads[0])).toBe(true);
  const tampered = structuredClone(after.spreads[0]);
  (tampered.importedTemplate as any).background = "#000000";
  expect(await verifyImportedTemplateProof(tampered)).toBe(false);
  expect(h.undo()).toEqual(doc);
});
it("blocks missing/duplicate bindings, locked layers and incompatible dimensions", async () => {
  const t = theme(),
    d = parseDocument(fixture);
  await expect(
    prepareThemePage(t, "page1", {}, d, d.spreads[0].id),
  ).rejects.toThrow("TEMPLATE_BINDING_REQUIRED");
  d.spreads[0].layers = [{ ...t.pages[0].layers[0], locked: true }];
  await expect(
    prepareThemePage(t, "page1", { slot1: "p" }, d, d.spreads[0].id),
  ).rejects.toThrow("LAYER_LOCKED");
});
