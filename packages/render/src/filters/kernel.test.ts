import { it, expect } from "vitest";
import { getRecipe, filterTile, recipes, filterManifest } from "./index";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import type { FilterRecipe, PixelTile } from "./types";
const tile: PixelTile = {
  bytes: new Uint8ClampedArray([128, 64, 32, 128]),
  width: 1,
  height: 1,
  offsetX: 0,
  offsetY: 0,
  fullWidth: 1,
  fullHeight: 1,
};
const one = (operations: string): FilterRecipe => ({
  id: "fixture",
  name: "test",
  recipeVersion: 1,
  operationsInOrder: operations,
  defaultStrength: 0.65,
  seed: 1729,
});
it("has every stable ID with the contracted strength and seed", () => {
  expect(recipes.map((r) => r.id)).toEqual(
    Array.from({ length: 33 }, (_, i) => "F" + String(i + 1).padStart(2, "0")),
  );
  expect(
    recipes.every((r) => r.defaultStrength === 0.65 && r.seed === 1729),
  ).toBe(true);
  expect(
    getRecipe({ presetId: "F07", recipeVersion: 1, strength: 0.65, seed: 1729 })
      .id,
  ).toBe("F07");
  expect(filterManifest.sourceCsvSha256).toBe(
    createHash("sha256")
      .update(readFileSync("docs/ai-album-v0.1/filters.csv"))
      .digest("hex"),
  );
});
it("keeps zero strength bytes and alpha unchanged", () => {
  expect(filterTile(tile, one("exposure:1"), 0, 1729)).toEqual(tile.bytes);
  expect([...filterTile(tile, one("exposure:1"), 1, 1729)]).toEqual([
    255, 128, 64, 128,
  ]);
});
it.each([
  ["exposure:1", [255, 128, 64, 128]],
  ["contrast:1", [129, 0, 0, 128]],
  ["saturation:-1", [75, 75, 75, 128]],
  ["temperature:1", [148, 69, 12, 128]],
  ["tint:1", [138, 44, 42, 128]],
  ["gamma:2", [181, 128, 90, 128]],
  ["grayscale:1", [75, 75, 75, 128]],
  ["sepia:1", [106, 94, 73, 128]],
  ["duotone:#000000,#ffffff", [75, 75, 75, 128]],
  ["posterize:2", [255, 0, 0, 128]],
  ["vignette:1", [128, 64, 32, 128]],
  ["grain:0", [128, 64, 32, 128]],
])("computes %s with fixed numeric outputs", (operations, expected) =>
  expect([...filterTile(tile, one(operations), 1, 1729)]).toEqual(expected),
);
it("rejects unknown versions and out-of-bound inputs instead of falling back", () => {
  expect(() =>
    getRecipe({ presetId: "F01", recipeVersion: 99, strength: 1, seed: 1 }),
  ).toThrow();
  expect(() => filterTile(tile, one("gamma:0"), 1, 1)).toThrow();
  expect(() => filterTile(tile, one("unknown:1"), 1, 1)).toThrow();
  expect(() => filterTile(tile, one("exposure:0"), 1.1, 1)).toThrow();
  expect(() =>
    filterTile({ ...tile, width: 2 }, one("exposure:0"), 1, 1),
  ).toThrow();
});
it("mixes strength in linear light rather than parameter space", () => {
  const result = filterTile(tile, one("exposure:1"), 0.5, 1729);
  expect(result[0]).toBe(205);
  expect(result[3]).toBe(128);
});
it("is tile independent and grain seed dependent", () => {
  const bytes = new Uint8ClampedArray(
    Array.from({ length: 4 * 4 * 4 }, (_, i) => (i % 4 === 3 ? 17 : 128)),
  );
  const full = {
    bytes,
    width: 4,
    height: 4,
    offsetX: 0,
    offsetY: 0,
    fullWidth: 4,
    fullHeight: 4,
  };
  const recipe = one("grain:0.2;vignette:0.6");
  const expected = filterTile(full, recipe, 0.65, 1729);
  const actual = new Uint8ClampedArray(bytes.length);
  for (let y = 0; y < 4; y += 2)
    for (let x = 0; x < 4; x += 2) {
      const input = new Uint8ClampedArray(16);
      for (let row = 0; row < 2; row++)
        input.set(
          bytes.slice(((y + row) * 4 + x) * 4, ((y + row) * 4 + x + 2) * 4),
          row * 8,
        );
      const output = filterTile(
        { ...full, bytes: input, width: 2, height: 2, offsetX: x, offsetY: y },
        recipe,
        0.65,
        1729,
      );
      for (let row = 0; row < 2; row++)
        actual.set(output.slice(row * 8, row * 8 + 8), ((y + row) * 4 + x) * 4);
    }
  expect(actual).toEqual(expected);
  expect(filterTile(full, recipe, 0.65, 1730)).not.toEqual(expected);
  expect(filterTile(full, recipe, 0.65, 1729)).toEqual(expected);
});
