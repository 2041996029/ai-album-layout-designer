import type { ImageLayer, Rect } from "@album/document";
export function initialPhotoCrop(
  layer: ImageLayer,
  photo: { width: number; height: number },
): ImageLayer {
  const next = structuredClone(layer);
  if (
    layer.fitMode === "cover" &&
    (layer.crop.width < 1 || layer.crop.height < 1)
  )
    return next;
  const frame = layer.width / layer.height,
    source = photo.width / photo.height;
  const width = Math.min(1, frame / source),
    height = Math.min(1, source / frame);
  next.crop = { x: (1 - width) / 2, y: (1 - height) / 2, width, height };
  next.fitMode = "cover";
  return next;
}
export function movePhotoCrop(
  crop: Rect,
  dx: number,
  dy: number,
  width: number,
  height: number,
): Rect {
  return {
    ...crop,
    x: Math.max(
      0,
      Math.min(1 - crop.width, crop.x - (dx / width) * crop.width),
    ),
    y: Math.max(
      0,
      Math.min(1 - crop.height, crop.y - (dy / height) * crop.height),
    ),
  };
}
