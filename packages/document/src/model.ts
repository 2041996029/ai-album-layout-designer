/** Own JSON model is authoritative. Never persist Fabric serialization. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export interface FilterRef {
  presetId: string;
  recipeVersion: number;
  strength: number;
  seed: number;
}
export interface TemplateRef {
  id: string;
  version: number;
  sha256: string;
}
export interface BaseLayer extends Rect {
  id: string;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  [extension: string]: unknown;
}
export interface ImageLayer extends BaseLayer {
  type: "image";
  assetId: string;
  crop: Rect;
  fitMode?: "cover" | "contain";
  role?: string;
  filter?: FilterRef | null;
}
export interface TextLayer extends BaseLayer {
  type: "text";
  text: string;
  fontAssetId: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  textAlign?: "left" | "center" | "right" | "justify";
  fill: string;
  critical?: boolean;
}
export interface ShapeLayer extends BaseLayer {
  type: "shape";
  shapeKind: "rectangle" | "ellipse" | "line";
  fill: string;
  stroke: string;
  strokeWidth: number;
  radius?: number;
}
export interface GroupLayer extends BaseLayer {
  type: "group";
  scale?: number;
  children: Layer[];
}
export interface OpaqueLayer {
  id: string;
  type: string;
  [key: string]: unknown;
}
export type KnownLayer = ImageLayer | TextLayer | ShapeLayer | GroupLayer;
export type Layer = KnownLayer | OpaqueLayer;
export interface Spread {
  id: string;
  background: string;
  layers: Layer[];
  templateRef?: TemplateRef;
  [key: string]: unknown;
}
export interface DocumentModel {
  schemaVersion: 1;
  projectId: string;
  revision: number;
  unit: "px96";
  colorSpace: "srgb";
  pageSize: { width: number; height: number };
  printProfile: { bleedMm: number; safeMm: number };
  cover: { front: Layer[]; back: Layer[] };
  spreads: Spread[];
  [key: string]: unknown;
}
export interface DocumentIssue {
  code: string;
  path: string;
  severity: "blocker" | "warning";
  message: string;
  layerId?: string;
}
export const isImageLayer = (layer: Layer): layer is ImageLayer =>
  layer.type === "image";
export const isTextLayer = (layer: Layer): layer is TextLayer =>
  layer.type === "text";
export const isShapeLayer = (layer: Layer): layer is ShapeLayer =>
  layer.type === "shape";
export const isGroupLayer = (layer: Layer): layer is GroupLayer =>
  layer.type === "group";
export const isKnownLayer = (layer: Layer): layer is KnownLayer =>
  ["image", "text", "shape", "group"].includes(layer.type);
export function* walkLayers(layers: readonly Layer[]): Generator<Layer> {
  for (const layer of layers) {
    yield layer;
    if (isGroupLayer(layer)) yield* walkLayers(layer.children);
  }
}
export function allLayers(doc: DocumentModel): Layer[] {
  return [
    ...walkLayers(doc.cover.front),
    ...walkLayers(doc.cover.back),
    ...doc.spreads.flatMap((s) => [...walkLayers(s.layers)]),
  ];
}
