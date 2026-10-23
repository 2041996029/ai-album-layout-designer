import { it, expect } from "vitest";
import {
  templateVersions,
  instantiateTemplate,
  type DocumentModel,
} from "@album/document";
import type { AssetRecord } from "@album/assets";
import fixture from "../../../../tests/fixtures/documents/minimal.json";
import { nativeMiniPolicy } from "./native-mini-policy";
import { patchDocument } from "./mini-patch";
it("declares image crop and replacement only for registered immutable native slots", () => {
  const template = templateVersions.find((t) => t.id === "tpl_wedding")!,
    bindings = Object.fromEntries(
      template.slots
        .filter((s) => s.kind === "image")
        .map((s) => [s.slotId, "first"]),
    );
  let next = 0;
  const layers = instantiateTemplate(
      template,
      bindings,
      () => `layer-${next++}`,
    ),
    image = layers.find((l) => l.type === "image")!;
  const doc = structuredClone(fixture) as DocumentModel;
  doc.spreads[0].templateRef = {
    id: template.id,
    version: template.version,
    sha256: template.sha256,
  };
  doc.spreads[0].layers = layers;
  const resources = {
    assets: [
      { id: "first", width: 400, height: 200 },
      { id: "second", width: 400, height: 200 },
    ] as AssetRecord[],
    fonts: [],
  };
  const crop = {
    x: 0,
    y: 0,
    width: Number(image.width) / Number(image.height) / 2,
    height: 1,
  };
  const patched = patchDocument(
    doc,
    [
      { type: "setCrop", spreadId: "spread_1", layerId: image.id, crop },
      {
        type: "replaceAsset",
        spreadId: "spread_1",
        layerId: image.id,
        assetId: "second",
      },
    ],
    nativeMiniPolicy(resources),
  );
  expect(
    patched.spreads[0].layers.find((l) => l.id === image.id),
  ).toMatchObject({ assetId: "second", crop });
  doc.spreads[0].templateRef.sha256 = "0".repeat(64);
  image.editableFields = ["crop", "assetId"];
  expect(() =>
    patchDocument(
      doc,
      [
        {
          type: "replaceAsset",
          spreadId: "spread_1",
          layerId: image.id,
          assetId: "second",
        },
      ],
      nativeMiniPolicy(resources),
    ),
  ).toThrow("MINI_PATCH_FORBIDDEN");
});
