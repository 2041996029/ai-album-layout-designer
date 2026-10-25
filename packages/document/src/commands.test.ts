import { it, expect } from "vitest";
import fixture from "../../../tests/fixtures/documents/minimal.json";
import { parseDocument } from "./index";
import { applyCommand } from "./commands";
import { History } from "../../../apps/web/src/state/history";
const shape: any = {
  id: "shape_1",
  type: "shape",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  shapeKind: "rectangle",
  fill: "#ffffff",
  stroke: "#000000",
  strokeWidth: 0,
  extension: { untouched: 3 },
};
const initial = () =>
  parseDocument({
    ...structuredClone(fixture),
    spreads: [{ ...fixture.spreads[0], layers: [structuredClone(shape)] }],
  });
it("updates whitelisted fields without losing unknown extensions or mutating source", () => {
  const before = initial();
  const after = applyCommand(before, {
    type: "update-layer",
    layerId: "shape_1",
    patch: { x: 20 },
  });
  expect(after.spreads[0].layers[0]).toMatchObject({
    x: 20,
    extension: { untouched: 3 },
  });
  expect(before.spreads[0].layers[0].x).toBe(0);
  expect(() =>
    applyCommand(before, {
      type: "update-layer",
      layerId: "shape_1",
      patch: { id: "new" },
    }),
  ).toThrow();
});
it("rejects invalid commands without poisoning history and preserves 100 undo/redo entries", () => {
  const history = new History(initial());
  for (let x = 1; x <= 100; x++)
    history.execute({ type: "update-layer", layerId: "shape_1", patch: { x } });
  expect(() =>
    history.execute({
      type: "update-layer",
      layerId: "shape_1",
      patch: { width: -1 },
    }),
  ).toThrow();
  for (let i = 0; i < 100; i++) history.undo();
  expect(history.current.spreads[0].layers[0].x).toBe(0);
  for (let i = 0; i < 100; i++) history.redo();
  expect(history.current.spreads[0].layers[0].x).toBe(100);
});
it("applies a batch as one undoable action", () => {
  const h = new History(initial());
  h.execute({
    type: "batch",
    commands: [
      { type: "update-layer", layerId: "shape_1", patch: { x: 99 } },
      { type: "update-layer", layerId: "shape_1", patch: { y: 88 } },
    ],
  });
  expect(h.undo()).toEqual(initial());
  expect(h.redo().spreads[0].layers[0]).toMatchObject({ x: 99, y: 88 });
});
it("adds a spread by value so editing a copied spread cannot modify the source", () => {
  const h = new History(initial());
  const copy = structuredClone(initial().spreads[0]);
  copy.id = "spread_2";
  copy.layers[0].id = "shape_2";
  h.execute({ type: "add-spread", spread: copy });
  copy.layers[0].x = 9;
  h.execute({ type: "update-layer", layerId: "shape_2", patch: { x: 10 } });
  expect(h.current.spreads[0].layers[0].x).toBe(0);
  expect(h.current.spreads[1].layers[0].x).toBe(10);
});
it("keeps at least one inner spread and rejects invalid reordering", () => {
  expect(() =>
    applyCommand(initial(), { type: "delete-spread", spreadId: "spread_1" }),
  ).toThrow();
  expect(() =>
    applyCommand(initial(), {
      type: "reorder-layer",
      layerId: "shape_1",
      index: 100,
    }),
  ).toThrow();
});
it("prevents locked layer modification but allows explicit unlocking", () => {
  const d = initial();
  (d.spreads[0].layers[0] as any).locked = true;
  expect(() =>
    applyCommand(d, {
      type: "update-layer",
      layerId: "shape_1",
      patch: { x: 3 },
    }),
  ).toThrow();
  expect(
    applyCommand(d, {
      type: "update-layer",
      layerId: "shape_1",
      patch: { locked: false },
    }).spreads[0].layers[0].locked,
  ).toBe(false);
});
