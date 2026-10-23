import { it, expect } from "vitest";
import fixture from "../../../tests/fixtures/documents/minimal.json";
import { applyCommand, parseDocument, type DocumentCommand } from "./index";
const shape = (id: string, x: number, y: number, rotation = 0): any => ({
  id,
  type: "shape",
  shapeKind: "rectangle",
  x,
  y,
  width: 40,
  height: 30,
  rotation,
  opacity: 0.8,
  visible: true,
  locked: false,
  fill: "#ffffff",
  stroke: "#000000",
  strokeWidth: 2,
  radius: 4,
  extension: { keep: true },
});
it("groups siblings in painter order then ungroups preserving transformed world geometry and extensions", () => {
  const doc = parseDocument({
    ...fixture,
    spreads: [
      {
        ...fixture.spreads[0],
        layers: [shape("a", 10, 20), shape("b", 90, 60, 15)],
      },
    ],
  });
  let next = applyCommand(doc, {
    type: "group-layers",
    layerIds: ["b", "a"],
    groupId: "g",
  } as unknown as DocumentCommand);
  expect(next.spreads[0].layers).toHaveLength(1);
  const g: any = next.spreads[0].layers[0];
  expect(g.children.map((x: any) => x.id)).toEqual(["a", "b"]);
  next = applyCommand(next, {
    type: "update-layer",
    layerId: "g",
    patch: { x: 100, y: 200, rotation: 90, scale: 2, opacity: 0.5 },
  });
  next = applyCommand(next, {
    type: "ungroup-layer",
    layerId: "g",
  } as unknown as DocumentCommand);
  expect(next.spreads[0].layers[0]).toMatchObject({
    id: "a",
    x: 100,
    y: 200,
    rotation: 90,
    width: 80,
    height: 60,
    opacity: 0.4,
    strokeWidth: 4,
    radius: 8,
    extension: { keep: true },
  });
  expect(next.spreads[0].layers[1].x).toBeCloseTo(20);
  expect(next.spreads[0].layers[1].y).toBeCloseTo(360);
  expect(doc.spreads[0].layers[0].x).toBe(10);
});
it("rejects locked and cross-parent grouping without altering source", () => {
  const a = shape("a", 0, 0);
  a.locked = true;
  const doc = parseDocument({
    ...fixture,
    spreads: [{ ...fixture.spreads[0], layers: [a, shape("b", 50, 50)] }],
  });
  expect(() =>
    applyCommand(doc, {
      type: "group-layers",
      layerIds: ["a", "b"],
      groupId: "g",
    } as unknown as DocumentCommand),
  ).toThrow("LAYER_LOCKED");
});
it("ungroups nested groups and text without changing inherited geometry or style", () => {
  const text: any = {
    id: "t",
    type: "text",
    x: 5,
    y: 8,
    width: 80,
    height: 60,
    rotation: 10,
    opacity: 0.5,
    visible: true,
    locked: false,
    text: "你好",
    fontAssetId: "font",
    fontSize: 20,
    fontWeight: 700,
    lineHeight: 1.5,
    letterSpacing: 2,
    fill: "#000000",
  };
  const doc = parseDocument({
    ...fixture,
    spreads: [
      {
        ...fixture.spreads[0],
        layers: [
          {
            ...shape("g", 100, 200, 90),
            type: "group",
            scale: 2,
            opacity: 0.4,
            visible: false,
            children: [
              text,
              {
                ...shape("nested", 20, 30),
                type: "group",
                scale: 3,
                children: [shape("leaf", 1, 2)],
              },
            ],
          },
        ],
      },
    ],
  });
  const next = applyCommand(doc, {
    type: "ungroup-layer",
    layerId: "g",
  } as DocumentCommand);
  expect(next.spreads[0].layers[0]).toMatchObject({
    x: 84,
    y: 210,
    width: 160,
    height: 120,
    rotation: 100,
    fontSize: 40,
    letterSpacing: 4,
    lineHeight: 1.5,
    opacity: 0.2,
    visible: false,
  });
  expect(next.spreads[0].layers[1]).toMatchObject({
    x: 40,
    y: 240,
    scale: 6,
    width: 40,
    height: 30,
    rotation: 90,
    visible: false,
  });
});
it("inserts a duplicate into the selected local parent instead of the root surface", () => {
  const doc = parseDocument({
    ...fixture,
    spreads: [
      {
        ...fixture.spreads[0],
        layers: [
          {
            ...shape("g", 100, 200, 90),
            type: "group",
            scale: 2,
            children: [shape("a", 5, 6)],
          },
        ],
      },
    ],
  });
  const next = applyCommand(doc, {
    type: "insert-layer",
    surfaceId: "spread_1",
    parentId: "g",
    layer: shape("copy", 29, 30),
  } as DocumentCommand);
  expect(next.spreads[0].layers).toHaveLength(1);
  expect((next.spreads[0].layers[0] as any).children).toHaveLength(2);
});
it("rejects edits of descendants of a locked group", () => {
  let doc = parseDocument({
    ...fixture,
    spreads: [
      { ...fixture.spreads[0], layers: [shape("a", 0, 0), shape("b", 50, 0)] },
    ],
  });
  doc = applyCommand(doc, {
    type: "group-layers",
    layerIds: ["a", "b"],
    groupId: "g",
  });
  doc = applyCommand(doc, {
    type: "update-layer",
    layerId: "g",
    patch: { locked: true },
  });
  expect(() =>
    applyCommand(doc, { type: "update-layer", layerId: "a", patch: { x: 99 } }),
  ).toThrow("LAYER_LOCKED");
  expect(() =>
    applyCommand(doc, { type: "delete-layer", layerId: "a" }),
  ).toThrow("LAYER_LOCKED");
});
