import { recipes, filterTile } from "@album/render";
import type { ResourcePort } from "@album/assets";
/** Thumbnail-only previews use the same pixel kernel as the canvas and export. */
export async function filterPreviews(
  port: ResourcePort,
  assetId: string,
): Promise<Record<string, string>> {
  const bytes = await port.read(assetId, "preview");
  const bitmap = await createImageBitmap(
    new Blob([new Uint8Array(bytes)], { type: "image/png" }),
  );
  const canvas = document.createElement("canvas");
  canvas.width = 96;
  canvas.height = 112;
  const ctx = canvas.getContext("2d")!;
  try {
    ctx.fillStyle = "#f2f0e9";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(
      canvas.width / bitmap.width,
      canvas.height / bitmap.height,
    );
    ctx.drawImage(
      bitmap,
      (canvas.width - bitmap.width * scale) / 2,
      (canvas.height - bitmap.height * scale) / 2,
      bitmap.width * scale,
      bitmap.height * scale,
    );
  } finally {
    bitmap.close();
  }
  const source = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const result: Record<string, string> = {};
  for (const recipe of recipes) {
    const bytes = filterTile(
      {
        bytes: source.data,
        width: canvas.width,
        height: canvas.height,
        offsetX: 0,
        offsetY: 0,
        fullWidth: canvas.width,
        fullHeight: canvas.height,
      },
      recipe,
      recipe.defaultStrength,
      recipe.seed,
    );
    ctx.putImageData(
      new ImageData(new Uint8ClampedArray(bytes), canvas.width, canvas.height),
      0,
      0,
    );
    result[recipe.id] = canvas.toDataURL("image/png");
  }
  return result;
}
