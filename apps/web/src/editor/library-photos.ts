import { isImageLayer, isGroupLayer, type Layer } from "@album/document";
export function photoPool<T extends { id: string }>(
  assets: T[],
  layers: Layer[],
  selectedIds: string[],
): T[] {
  const selected = new Set(selectedIds),
    ids = new Set<string>();
  const visit = (items: Layer[], inherited = false) => {
    for (const layer of items) {
      const chosen = inherited || selected.has(layer.id);
      if (
        chosen &&
        isImageLayer(layer) &&
        layer.layoutPhotoRole !== "decoration"
      )
        ids.add(layer.assetId);
      if (isGroupLayer(layer)) visit(layer.children, chosen);
    }
  };
  visit(layers);
  const chosen = assets.filter((a) => ids.has(a.id));
  return chosen.length ? chosen : assets;
}
export function autoBindings<T extends { id: string }>(
  slots: string[],
  photos: T[],
): Record<string, string> {
  return Object.fromEntries(
    slots.flatMap((slot, index) =>
      photos[index] ? [[slot, photos[index].id]] : [],
    ),
  );
}
