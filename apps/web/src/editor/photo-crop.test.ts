import { it, expect } from "vitest";
import { initialPhotoCrop, movePhotoCrop } from "./photo-crop";
it("starts a movable crop for a portrait in a wide frame and moves the image without moving its frame", () => {
  const layer: any = {
    x: 24,
    y: 40,
    width: 456,
    height: 180,
    fitMode: "contain",
    crop: { x: 0, y: 0, width: 1, height: 1 },
  };
  const next = initialPhotoCrop(layer, { width: 1080, height: 1438 });
  expect(next.crop.height).toBeLessThan(1);
  expect(next.fitMode).toBe("cover");
  const moved = movePhotoCrop(next.crop, 0, 40, 456, 180);
  expect(moved.y).toBeLessThan(next.crop.y);
  expect(layer.x).toBe(24);
  expect(layer.y).toBe(40);
});
