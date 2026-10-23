import { expect, it } from "vitest";
import fixture from "../../../tests/fixtures/documents/minimal.json";
import { parseDocument } from "./validate";

const documentWithMask = (alphaMask: unknown) => ({
  ...structuredClone(fixture),
  spreads: [
    {
      id: "spread_1",
      background: "#ffffff",
      layers: [
        {
          id: "photo",
          type: "image",
          assetId: "new_photo",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          opacity: 1,
          visible: true,
          locked: false,
          crop: { x: 0, y: 0, width: 1, height: 1 },
          templateSlot: { version: 1, slotId: "slot" },
          alphaMask,
        },
      ],
    },
  ],
});
it("preserves pinned alpha masks and stable template slots in document round trips", () => {
  const doc = parseDocument(documentWithMask({ version: 1, assetId: "mask" }));
  expect(doc.spreads[0].layers[0].alphaMask).toEqual({
    version: 1,
    assetId: "mask",
  });
  expect(doc.spreads[0].layers[0].templateSlot).toEqual({
    version: 1,
    slotId: "slot",
  });
});
it.each([
  { version: 2, assetId: "mask" },
  { version: 1, assetId: "" },
  { version: 1, assetId: "../mask" },
  { assetId: "mask" },
])("rejects invalid mask reference %j", (alphaMask) => {
  expect(() => parseDocument(documentWithMask(alphaMask))).toThrow();
});
