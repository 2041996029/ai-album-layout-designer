import type { ImageLayer, Rect } from "@album/document";
import {
  sha256,
  inspectImage,
  ResourceError,
  type AssetRecord,
  type ResourcePort,
} from "@album/assets";
import { filterTile, getRecipe } from "./filters";
import { abortable } from "./async-resource";
export interface ImagePlacement {
  source: Rect;
  destination: Rect;
}
/** Crop is in normalized, orientation-corrected source coordinates. Cover is centered within that crop. */
export function imagePlacement(
  layer: ImageLayer,
  width: number,
  height: number,
): ImagePlacement {
  const crop = layer.crop;
  if (
    ![crop.x, crop.y, crop.width, crop.height].every(Number.isFinite) ||
    crop.x < 0 ||
    crop.y < 0 ||
    crop.width <= 0 ||
    crop.height <= 0 ||
    crop.x + crop.width > 1 + 1e-9 ||
    crop.y + crop.height > 1 + 1e-9
  )
    throw new ResourceError(
      "INVALID_CROP",
      "Crop must be a nonempty normalized source rectangle.",
    );
  const source = {
    x: crop.x * width,
    y: crop.y * height,
    width: crop.width * width,
    height: crop.height * height,
  };
  let destination = { x: 0, y: 0, width: layer.width, height: layer.height };
  const ratio = layer.width / layer.height,
    sourceRatio = source.width / source.height;
  if (layer.fitMode === "contain") {
    if (sourceRatio > ratio) {
      destination.height = layer.width / sourceRatio;
      destination.y = (layer.height - destination.height) / 2;
    } else {
      destination.width = layer.height * sourceRatio;
      destination.x = (layer.width - destination.width) / 2;
    }
  } else if (sourceRatio > ratio) {
    const next = source.height * ratio;
    source.x += (source.width - next) / 2;
    source.width = next;
  } else {
    const next = source.width / ratio;
    source.y += (source.height - next) / 2;
    source.height = next;
  }
  return { source, destination };
}
export interface PipelineImage {
  canvas: HTMLCanvasElement;
  dispose(): void;
}
function canvas(width: number, height: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}
export async function renderImage(
  layer: ImageLayer,
  record: AssetRecord,
  port: ResourcePort,
  signal: AbortSignal,
  pixelScale = 1,
): Promise<PipelineImage> {
  signal.throwIfAborted();
  if (record.status !== "ready" || !record.license.usable)
    throw new ResourceError(
      "RESOURCE_MISSING",
      `Image ${record.id} is not available and licensed.`,
    );
  const bytes = await abortable(port.read(record.id, "normalized"), signal);
  signal.throwIfAborted();
  if ((await sha256(bytes)) !== record.variants.normalized.sha256)
    throw new ResourceError(
      "HASH_MISMATCH",
      "Normalized image differs from pinned resource.",
    );
  const info = inspectImage(bytes);
  if (info.width !== record.width || info.height !== record.height)
    throw new ResourceError(
      "INVALID_IMAGE",
      "Normalized source dimensions differ from manifest.",
    );
  signal.throwIfAborted();
  const bitmap = await abortable(
    createImageBitmap(
      new Blob([new Uint8Array(bytes)], { type: info.mimeType }),
      { imageOrientation: "from-image" },
    ),
    signal,
    (b) => b.close(),
  );
  let source: HTMLCanvasElement | undefined,
    output: HTMLCanvasElement | undefined;
  try {
    signal.throwIfAborted();
    source = canvas(bitmap.width, bitmap.height);
    const ctx = source.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(bitmap, 0, 0);
    // One bounded RGBA8 tile at a time. Vignette/grain coordinates always refer to the full source, before crop/resize.
    if (layer.filter) {
      const recipe = getRecipe(layer.filter);
      let tiles = 0;
      for (let y = 0; y < source.height; y += 512)
        for (let x = 0; x < source.width; x += 512) {
          signal.throwIfAborted();
          const width = Math.min(512, source.width - x),
            height = Math.min(512, source.height - y);
          const tile = ctx.getImageData(x, y, width, height);
          tile.data.set(
            filterTile(
              {
                bytes: tile.data,
                width,
                height,
                offsetX: x,
                offsetY: y,
                fullWidth: source.width,
                fullHeight: source.height,
              },
              recipe,
              layer.filter.strength,
              layer.filter.seed,
            ),
          );
          ctx.putImageData(tile, x, y);
          if (++tiles % 8 === 0) await new Promise((r) => setTimeout(r, 0));
        }
    }
    signal.throwIfAborted();
    const width = Math.max(1, Math.ceil(layer.width * pixelScale)),
      height = Math.max(1, Math.ceil(layer.height * pixelScale));
    if (width * height > 50_000_000)
      throw new ResourceError("SURFACE_TOO_LARGE", "Image frame exceeds 50MP.");
    output = canvas(width, height);
    const out = output.getContext("2d")!;
    const { source: s, destination: d } = imagePlacement(
      layer,
      source.width,
      source.height,
    );
    out.drawImage(
      source,
      s.x,
      s.y,
      s.width,
      s.height,
      (d.x * width) / layer.width,
      (d.y * height) / layer.height,
      (d.width * width) / layer.width,
      (d.height * height) / layer.height,
    );
    const result = output;
    output = undefined;
    let disposed = false;
    return {
      canvas: result,
      dispose() {
        if (disposed) return;
        disposed = true;
        result.width = 0;
        result.height = 0;
      },
    };
  } finally {
    bitmap.close();
    if (source) {
      source.width = 0;
      source.height = 0;
    }
    if (output) {
      output.width = 0;
      output.height = 0;
    }
  }
}
