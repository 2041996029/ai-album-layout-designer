import type {
  DocumentModel,
  Layer,
  TemplateRef,
} from "../../../packages/document/src/model";
import type { Schema } from "./api";
import type { MiniPatch } from "./album";
export function editableMiniSlots(
  document: DocumentModel,
  templates: Schema<"Template">[],
  patches: MiniPatch[] = [],
) {
  const result: Array<{
    spreadId: string;
    layerId: string;
    text: string;
    canText: boolean;
    canCrop: boolean;
    crop: { x: number; y: number; width: number; height: number };
  }> = [];
  const visit = (layers: Layer[], spreadId: string, ref?: TemplateRef) => {
    for (const layer of layers) {
      if (layer.locked) continue;
      if (layer.type === "group" && Array.isArray(layer.children)) {
        visit(layer.children as Layer[], spreadId, ref);
        continue;
      }
      const slotIdentity = (
        layer.templateSlot as { slotId?: string } | undefined
      )?.slotId;
      const slot = templates
        .filter((t) => !ref || (t.id === ref.id && t.version === ref.version))
        .flatMap((t) => t.slots)
        .find((s) =>
          slotIdentity
            ? s.slotId === slotIdentity
            : s.spreadId === spreadId && s.layerId === layer.id,
        );
      if (!slot) continue;
      const canText =
        layer.type === "text" &&
        slot.miniEditableFields.includes("text") &&
        Array.isArray(layer.editableFields) &&
        layer.editableFields.includes("text");
      const canCrop =
        layer.type === "image" && slot.miniEditableFields.includes("crop");
      if (canText || canCrop)
        result.push({
          spreadId,
          layerId: layer.id,
          text: typeof layer.text === "string" ? layer.text : "",
          canText,
          canCrop,
          crop: canCrop
            ? (layer.crop as {
                x: number;
                y: number;
                width: number;
                height: number;
              })
            : { x: 0, y: 0, width: 1, height: 1 },
        });
    }
  };
  for (const spread of document.spreads)
    visit(spread.layers, spread.id, spread.templateRef);
  for (const patch of patches) {
    if (patch.type === "setText" || patch.type === "setCrop") {
      const slot = result.find(
        (s) => s.spreadId === patch.spreadId && s.layerId === patch.layerId,
      );
      if (slot) {
        if (patch.type === "setText") slot.text = patch.text;
        else slot.crop = { ...patch.crop };
      }
    }
  }
  return result;
}
export function buildMiniPreview(
  document: DocumentModel,
  urls: Record<string, string>,
) {
  let unsupported = false;
  const spreads = document.spreads.map((spread) => ({
    id: spread.id,
    background: spread.background,
    layers: spread.layers.flatMap((layer) => {
      if (!["text", "image", "shape"].includes(layer.type)) {
        unsupported = true;
        return [];
      }
      const x = (Number(layer.x) / (document.pageSize.width * 2)) * 100,
        y = (Number(layer.y) / document.pageSize.height) * 100;
      const width = (Number(layer.width) / (document.pageSize.width * 2)) * 100,
        height = (Number(layer.height) / document.pageSize.height) * 100;
      const style = `left:${x}%;top:${y}%;width:${width}%;height:${height}%;transform:rotate(${Number(layer.rotation) || 0}deg);opacity:${layer.opacity ?? 1};`;
      const crop = layer.crop as
        { x: number; y: number; width: number; height: number } | undefined;
      const imageStyle = crop
        ? `position:absolute;width:${100 / crop.width}%;height:${100 / crop.height}%;left:${(-100 * crop.x) / crop.width}%;top:${(-100 * crop.y) / crop.height}%;`
        : "";
      return [
        {
          id: layer.id,
          type: layer.type,
          text: typeof layer.text === "string" ? layer.text : "",
          url:
            typeof layer.assetId === "string"
              ? (urls[layer.assetId] ?? "")
              : "",
          style:
            style +
            (layer.type === "text"
              ? `color:${layer.fill};font-size:${(Number(layer.fontSize) * 638) / (document.pageSize.width * 2)}rpx;`
              : ""),
          imageStyle,
          fill:
            layer.type !== "text" && typeof layer.fill === "string"
              ? layer.fill
              : "transparent",
        },
      ];
    }),
  }));
  return { spreads, unsupported };
}
