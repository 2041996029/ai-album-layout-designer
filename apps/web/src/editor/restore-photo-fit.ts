import {
  isGroupLayer,
  isImageLayer,
  type DocumentModel,
  type DocumentCommand,
  type Layer,
} from "@album/document";
/** Explicit repair: preserve layout, filters, decorations and locked subtrees. */
export function restorePhotoFit(
  doc: DocumentModel,
  photoAssetIds: ReadonlySet<string>,
): DocumentCommand {
  const commands: DocumentCommand[] = [];
  const visit = (layers: Layer[]) => {
    for (const layer of layers) {
      if (layer.locked) continue;
      if (isGroupLayer(layer)) visit(layer.children);
      else if (
        isImageLayer(layer) &&
        photoAssetIds.has(layer.assetId) &&
        layer.layoutPhotoRole !== "decoration" &&
        (layer.fitMode !== "contain" ||
          layer.crop.x !== 0 ||
          layer.crop.y !== 0 ||
          layer.crop.width !== 1 ||
          layer.crop.height !== 1)
      )
        commands.push({
          type: "update-layer",
          layerId: layer.id,
          patch: {
            fitMode: "contain",
            crop: { x: 0, y: 0, width: 1, height: 1 },
          },
        });
    }
  };
  visit(doc.cover.front);
  visit(doc.cover.back);
  for (const spread of doc.spreads) visit(spread.layers);
  return { type: "batch", commands };
}
