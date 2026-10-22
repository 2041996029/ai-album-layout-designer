import type {
  DocumentModel,
  Layer,
  KnownLayer,
  DocumentCommand,
} from "@album/document";
import { isKnownLayer, isGroupLayer } from "@album/document";
export type Patch = (patch: Record<string, unknown>, ids?: string[]) => void;
export const uid = (prefix = "layer") =>
  prefix + "_" + crypto.randomUUID().replaceAll("-", "");
export const base = () => ({
  id: uid(),
  x: 80,
  y: 80,
  width: 300,
  height: 220,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
});
export function siblings(doc: DocumentModel, id: string): Layer[] | undefined {
  const visit = (layers: Layer[]): Layer[] | undefined => {
    if (layers.some((l) => l.id === id)) return layers;
    for (const layer of layers)
      if (isGroupLayer(layer)) {
        const found = visit(layer.children);
        if (found) return found;
      }
  };
  for (const layers of [
    doc.cover.front,
    doc.cover.back,
    ...doc.spreads.map((s) => s.layers),
  ]) {
    const found = visit(layers);
    if (found) return found;
  }
}
export function cloneLayer(layer: Layer): Layer {
  const next = structuredClone(layer);
  next.id = uid();
  if (isGroupLayer(next)) next.children = next.children.map(cloneLayer);
  return next;
}
export function label(layer: Layer) {
  if (!isKnownLayer(layer)) return `不支持的图层 ${layer.type}`;
  return layer.type === "text"
    ? layer.text.slice(0, 18) || "文字"
    : layer.type === "image"
      ? "照片"
      : layer.type === "group"
        ? "组合"
        : { rectangle: "矩形", ellipse: "圆形", line: "线条" }[layer.shapeKind];
}
export const rotation = (value: number) => ((value % 360) + 360) % 360;
export type Execute = (command: DocumentCommand) => boolean;
export function known(layers: Layer[]): KnownLayer[] {
  return layers.filter(isKnownLayer);
}
/** Axis-aligned frame bounds in the shared local parent coordinate system. */
export function frameBounds(layer: KnownLayer) {
  const angle = (layer.rotation * Math.PI) / 180,
    scale = isGroupLayer(layer) ? (layer.scale ?? 1) : 1;
  const points = [
    [0, 0],
    [layer.width * scale, 0],
    [0, layer.height * scale],
    [layer.width * scale, layer.height * scale],
  ].map(([x, y]) => ({
    x: layer.x + x * Math.cos(angle) - y * Math.sin(angle),
    y: layer.y + x * Math.sin(angle) + y * Math.cos(angle),
  }));
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}
