import type { FilterRecipe, PixelTile } from "./types";
type RGB = [number, number, number];
const clamp = (n: number) => Math.min(1, Math.max(0, n));
const map = (rgb: RGB, fn: (n: number, i: number) => number): RGB =>
  rgb.map((n, i) => clamp(fn(n, i))) as RGB;
const luminance = ([r, g, b]: RGB) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const linear = (c: number) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const srgb = (c: number) =>
  c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
const bounded = (value: number, min: number, max: number) =>
  Number.isFinite(value) && value >= min && value <= max;
function parse(
  recipe: FilterRecipe,
): { name: string; value: number; colors?: [RGB, RGB] }[] {
  if (recipe.recipeVersion !== 1) throw new Error("UNSUPPORTED_FILTER_VERSION");
  return recipe.operationsInOrder.split(";").map((raw) => {
    const [name, param, ...extra] = raw.split(":");
    if (extra.length || !param) throw new Error("INVALID_FILTER_RECIPE");
    if (name === "duotone") {
      const colors = param.split(",");
      if (colors.length !== 2 || colors.some((c) => !/^#[0-9a-f]{6}$/i.test(c)))
        throw new Error("INVALID_FILTER_PARAMETERS");
      return {
        name,
        value: 0,
        colors: colors.map((c) =>
          [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255),
        ) as [RGB, RGB],
      };
    }
    const value = Number(param);
    const ranges: Record<string, [number, number]> = {
      exposure: [-8, 8],
      contrast: [-1, 4],
      saturation: [-1, 4],
      temperature: [-1, 1],
      tint: [-1, 1],
      gamma: [0.01, 10],
      grayscale: [0, 1],
      sepia: [0, 1],
      posterize: [2, 256],
      vignette: [0, 1],
      grain: [0, 1],
    };
    const range = ranges[name];
    if (
      !range ||
      !bounded(value, ...range) ||
      (name === "posterize" && !Number.isInteger(value))
    )
      throw new Error("INVALID_FILTER_PARAMETERS");
    return { name, value };
  });
}
function noise(x: number, y: number, seed: number): number {
  let h = seed ^ Math.imul(x + 1, 73856093) ^ Math.imul(y + 1, 19349663);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296 - 0.5;
}
export function filterTile(
  tile: PixelTile,
  recipe: FilterRecipe,
  strength: number,
  seed: number,
): Uint8ClampedArray {
  const { width, height, offsetX, offsetY, fullWidth, fullHeight } = tile;
  if (
    !bounded(strength, 0, 1) ||
    !Number.isInteger(seed) ||
    !bounded(seed, 0, 0xffffffff) ||
    [width, height, fullWidth, fullHeight].some(
      (n) => !Number.isSafeInteger(n) || n <= 0,
    ) ||
    [offsetX, offsetY].some((n) => !Number.isSafeInteger(n) || n < 0) ||
    offsetX + width > fullWidth ||
    offsetY + height > fullHeight ||
    tile.bytes.length !== width * height * 4
  )
    throw new Error("INVALID_FILTER_TILE");
  const ops = parse(recipe);
  const result = new Uint8ClampedArray(tile.bytes);
  if (strength === 0) return result;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const original: RGB = [
        tile.bytes[i] / 255,
        tile.bytes[i + 1] / 255,
        tile.bytes[i + 2] / 255,
      ];
      let rgb: RGB = [...original];
      for (const op of ops) {
        const v = op.value;
        const lum = luminance(rgb);
        switch (op.name) {
          case "exposure":
            rgb = map(rgb, (c) => c * 2 ** v);
            break;
          case "contrast":
            rgb = map(rgb, (c) => (c - 0.5) * (1 + v) + 0.5);
            break;
          case "saturation":
            rgb = map(rgb, (c) => lum + (c - lum) * (1 + v));
            break;
          case "temperature":
            rgb = map(rgb, (c, j) => c + [0.08, 0.02, -0.08][j] * v);
            break;
          case "tint":
            rgb = map(rgb, (c, j) => c + [0.04, -0.08, 0.04][j] * v);
            break;
          case "gamma":
            rgb = map(rgb, (c) => c ** (1 / v));
            break;
          case "grayscale":
            rgb = map(rgb, (c) => c * (1 - v) + lum * v);
            break;
          case "sepia": {
            const [r, g, b] = rgb;
            const out: RGB = [
              clamp(0.393 * r + 0.769 * g + 0.189 * b),
              clamp(0.349 * r + 0.686 * g + 0.168 * b),
              clamp(0.272 * r + 0.534 * g + 0.131 * b),
            ];
            rgb = map(rgb, (c, j) => c * (1 - v) + out[j] * v);
            break;
          }
          case "duotone": {
            const [dark, light] = op.colors!;
            rgb = map(rgb, (_c, j) => dark[j] * (1 - lum) + light[j] * lum);
            break;
          }
          case "posterize":
            rgb = map(rgb, (c) => Math.round(c * (v - 1)) / (v - 1));
            break;
          case "vignette": {
            const xx = (2 * (x + offsetX + 0.5)) / fullWidth - 1,
              yy = (2 * (y + offsetY + 0.5)) / fullHeight - 1;
            const d = Math.min(1, Math.hypot(xx, yy) / Math.SQRT2),
              factor = 1 - v * clamp((d - 0.2) / 0.8) ** 2;
            rgb = map(rgb, (c) => c * factor);
            break;
          }
          case "grain": {
            const n = noise(x + offsetX, y + offsetY, seed);
            rgb = map(rgb, (c) => c + v * n);
            break;
          }
        }
      }
      for (let j = 0; j < 3; j++)
        result[i + j] = Math.round(
          255 *
            clamp(
              strength === 1
                ? rgb[j]
                : srgb(
                    linear(original[j]) * (1 - strength) +
                      linear(rgb[j]) * strength,
                  ),
            ),
        );
    }
  return result;
}
