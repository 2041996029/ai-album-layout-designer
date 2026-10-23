import { describe, it, expect } from "vitest";
import { photoPool, autoBindings } from "./library-photos";
const assets = [{ id: "a" }, { id: "b" }, { id: "c" }] as any;
const layers = [
  {
    type: "group",
    id: "g",
    children: [
      { type: "image", id: "i", assetId: "b" },
      { type: "image", id: "j", assetId: "b" },
      { type: "image", id: "d", assetId: "c", layoutPhotoRole: "decoration" },
    ],
  },
] as any;
describe("library photo defaults", () => {
  it("prioritizes selected group photos and deduplicates assets", () =>
    expect(photoPool(assets, layers, ["g"]).map((a) => a.id)).toEqual(["b"]));
  it("falls back to imported photos for no photo selection", () =>
    expect(photoPool(assets, layers, []).map((a) => a.id)).toEqual([
      "a",
      "b",
      "c",
    ]));
  it("does not repeat photos to fill missing slots", () =>
    expect(autoBindings(["x", "y"], [{ id: "a" }] as any)).toEqual({ x: "a" }));
});

it("distinguishes explicitly empty photo selection from default all", () => {
  expect(photoPool(assets, layers, [], [])).toEqual([]);
  expect(photoPool(assets, layers, [], ["a", "c"])).toEqual([
    assets[0],
    assets[2],
  ]);
});
