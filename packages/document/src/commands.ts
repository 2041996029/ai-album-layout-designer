import { isVerifiedLayoutCommand } from "./layout-authorization";
import type {
  DocumentModel,
  Layer,
  Spread,
  TemplateRef,
  KnownLayer,
} from "./model";
import { isGroupLayer, isKnownLayer, walkLayers } from "./model";
import { parseDocument } from "./validate";
import { canonicalJson } from "./canonical";
export type DocumentCommand =
  | {
      type: "apply-layout";
      expectedDocument: string;
      spreads: Spread[];
      assignmentManifest: unknown;
      layoutContext: unknown;
    }
  | { type: "group-layers"; layerIds: string[]; groupId: string }
  | { type: "ungroup-layer"; layerId: string }
  | {
      type: "insert-layer";
      surfaceId: string;
      layer: Layer;
      index?: number;
      parentId?: string;
    }
  | { type: "delete-layer"; layerId: string }
  | { type: "update-layer"; layerId: string; patch: Record<string, unknown> }
  | { type: "reorder-layer"; layerId: string; index: number }
  | { type: "add-spread"; spread: Spread; index?: number }
  | { type: "delete-spread"; spreadId: string }
  | { type: "reorder-spread"; spreadId: string; index: number }
  | {
      type: "apply-template";
      spreadId: string;
      layers: Layer[];
      templateRef: TemplateRef;
      background?: string;
      importedTemplate?: import("./imported-template").ImportedTemplateProof;
    }
  | { type: "set-background"; spreadId: string; color: string }
  | { type: "batch"; commands: DocumentCommand[] };
export function surfaceLayers(doc: DocumentModel, surfaceId: string): Layer[] {
  if (surfaceId === "cover:front") return doc.cover.front;
  if (surfaceId === "cover:back") return doc.cover.back;
  const spread = doc.spreads.find((s) => s.id === surfaceId);
  if (!spread) throw new Error("SURFACE_NOT_FOUND");
  return spread.layers;
}
function locate(
  doc: DocumentModel,
  id: string,
): { list: Layer[]; index: number; layer: Layer } {
  const search = (list: Layer[]): ReturnType<typeof locate> | undefined => {
    for (let index = 0; index < list.length; index++) {
      const layer = list[index];
      if (layer.id === id) return { list, index, layer };
      if (isGroupLayer(layer)) {
        const child = search(layer.children);
        if (child) return child;
      }
    }
  };
  for (const list of [
    doc.cover.front,
    doc.cover.back,
    ...doc.spreads.map((s) => s.layers),
  ]) {
    const result = search(list);
    if (result) return result;
  }
  throw new Error("LAYER_NOT_FOUND");
}
const baseFields = [
  "x",
  "y",
  "width",
  "height",
  "rotation",
  "opacity",
  "visible",
  "locked",
];
const specific: Record<string, string[]> = {
  image: ["layoutPhotoRole", "assetId", "fitMode", "crop", "filter", "role"],
  text: [
    "text",
    "fontAssetId",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "textAlign",
    "fill",
    "critical",
  ],
  shape: ["shapeKind", "fill", "stroke", "strokeWidth", "radius"],
  group: ["scale"],
};
function indexAt(index: number, max: number): number {
  if (!Number.isSafeInteger(index) || index < 0 || index > max)
    throw new Error("INVALID_INDEX");
  return index;
}
function mutate(doc: DocumentModel, c: DocumentCommand): void {
  const targetIds =
    "layerId" in c
      ? [c.layerId]
      : "layerIds" in c
        ? c.layerIds
        : c.type === "insert-layer" && c.parentId
          ? [c.parentId]
          : [];
  const check = (layers: Layer[], ancestorLocked = false) => {
    for (const layer of layers) {
      if (ancestorLocked && targetIds.includes(layer.id))
        throw new Error("LAYER_LOCKED");
      if (isGroupLayer(layer))
        check(layer.children, ancestorLocked || layer.locked);
    }
  };
  for (const layers of [
    doc.cover.front,
    doc.cover.back,
    ...doc.spreads.map((s) => s.layers),
  ])
    check(layers);

  switch (c.type) {
    case "group-layers": {
      if (
        c.layerIds.length < 2 ||
        new Set(c.layerIds).size !== c.layerIds.length
      )
        throw new Error("INVALID_SELECTION");
      const found = c.layerIds.map((id) => locate(doc, id));
      const list = found[0].list;
      if (found.some((f) => f.list !== list))
        throw new Error("SELECT_SAME_PARENT");
      if (found.some((f) => f.layer.locked)) throw new Error("LAYER_LOCKED");
      if (found.some((f) => !isKnownLayer(f.layer)))
        throw new Error("UNSUPPORTED_LAYER");
      const children = list.filter((l) =>
        c.layerIds.includes(l.id),
      ) as KnownLayer[];
      // Rotated corners determine a conservative group box, without changing child transforms.
      const points = children.flatMap((l) => {
        const a = (l.rotation * Math.PI) / 180,
          z = isGroupLayer(l) ? (l.scale ?? 1) : 1;
        return [
          [0, 0],
          [l.width * z, 0],
          [0, l.height * z],
          [l.width * z, l.height * z],
        ].map(([x, y]) => ({
          x: l.x + x * Math.cos(a) - y * Math.sin(a),
          y: l.y + x * Math.sin(a) + y * Math.cos(a),
        }));
      });
      const x = Math.min(...points.map((p) => p.x)),
        y = Math.min(...points.map((p) => p.y));
      const group: Layer = {
        id: c.groupId,
        type: "group",
        x,
        y,
        width: Math.max(...points.map((p) => p.x)) - x,
        height: Math.max(...points.map((p) => p.y)) - y,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        scale: 1,
        children: children.map((l) => ({ ...l, x: l.x - x, y: l.y - y })),
      };
      const index = Math.max(...found.map((f) => f.index));
      // Keep the group at the highest selected painter position.
      const above = list.slice(index + 1);
      const below = list
        .slice(0, index + 1)
        .filter((l) => !c.layerIds.includes(l.id));
      list.splice(0, list.length, ...below, group, ...above);
      return;
    }
    case "ungroup-layer": {
      const { list, index, layer } = locate(doc, c.layerId);
      if (!isGroupLayer(layer)) throw new Error("NOT_A_GROUP");
      if (layer.locked) throw new Error("LAYER_LOCKED");
      const scale = layer.scale ?? 1,
        angle = (layer.rotation * Math.PI) / 180;
      const children = layer.children.map((child) => {
        if (!isKnownLayer(child)) throw new Error("UNSUPPORTED_LAYER");
        const next = structuredClone(child);
        next.x =
          layer.x +
          scale * (child.x * Math.cos(angle) - child.y * Math.sin(angle));
        next.y =
          layer.y +
          scale * (child.x * Math.sin(angle) + child.y * Math.cos(angle));
        next.rotation = (((child.rotation + layer.rotation) % 360) + 360) % 360;
        next.opacity *= layer.opacity;
        next.visible = child.visible && layer.visible;
        next.locked = child.locked || layer.locked;
        if (isGroupLayer(next)) next.scale = (next.scale ?? 1) * scale;
        else {
          next.width *= scale;
          next.height *= scale;
          if (next.type === "text") {
            next.fontSize *= scale;
            next.letterSpacing *= scale;
          }
          if (next.type === "shape") {
            next.strokeWidth *= scale;
            if (next.radius !== undefined) next.radius *= scale;
          }
        }
        return next;
      });
      list.splice(index, 1, ...children);
      return;
    }
    case "batch":
      for (const child of c.commands) mutate(doc, child);
      return;
    case "insert-layer": {
      const surface = surfaceLayers(doc, c.surfaceId);
      const parent = c.parentId
        ? [...walkLayers(surface)].find((l) => l.id === c.parentId)
        : undefined;
      if (c.parentId && (!parent || !isGroupLayer(parent)))
        throw new Error("PARENT_NOT_FOUND");
      if (parent?.locked) throw new Error("LAYER_LOCKED");
      const list = parent && isGroupLayer(parent) ? parent.children : surface;
      list.splice(
        indexAt(c.index ?? list.length, list.length),
        0,
        structuredClone(c.layer),
      );
      return;
    }
    case "update-layer": {
      const { layer } = locate(doc, c.layerId);
      if (!isKnownLayer(layer)) throw new Error("UNSUPPORTED_LAYER");
      const keys = Object.keys(c.patch);
      if (
        keys.some((k) => ![...baseFields, ...specific[layer.type]].includes(k))
      )
        throw new Error("INVALID_PATCH_FIELD");
      if (layer.locked && keys.some((k) => k !== "locked"))
        throw new Error("LAYER_LOCKED");
      Object.assign(layer, structuredClone(c.patch));
      return;
    }
    case "delete-layer":
    case "reorder-layer": {
      const { list, index, layer } = locate(doc, c.layerId);
      if (layer.locked) throw new Error("LAYER_LOCKED");
      if (c.type === "delete-layer") list.splice(index, 1);
      else {
        const dest = indexAt(c.index, list.length - 1);
        list.splice(index, 1);
        list.splice(dest, 0, layer);
      }
      return;
    }
    case "add-spread":
      doc.spreads.splice(
        indexAt(c.index ?? doc.spreads.length, doc.spreads.length),
        0,
        structuredClone(c.spread),
      );
      return;
    case "delete-spread":
    case "reorder-spread": {
      const index = doc.spreads.findIndex((s) => s.id === c.spreadId);
      if (index < 0) throw new Error("SPREAD_NOT_FOUND");
      if (c.type === "delete-spread") doc.spreads.splice(index, 1);
      else {
        const dest = indexAt(c.index, doc.spreads.length - 1);
        const [s] = doc.spreads.splice(index, 1);
        doc.spreads.splice(dest, 0, s);
      }
      return;
    }
    case "apply-layout": {
      if (canonicalJson(doc) !== c.expectedDocument)
        throw new Error("STALE_LAYOUT");
      if (!isVerifiedLayoutCommand(c))
        throw new Error("UNVERIFIED_LAYOUT_COMMAND");
      for (const spread of doc.spreads) {
        const next = c.spreads.find((s) => s.id === spread.id);
        for (const root of spread.layers)
          if ([...walkLayers([root])].some((l) => l.locked === true)) {
            if (
              canonicalJson(root) !==
              canonicalJson(next?.layers.find((l) => l.id === root.id) ?? null)
            )
              throw new Error("LAYER_LOCKED");
          }
      }
      doc.spreads = structuredClone(c.spreads);
      doc.assignmentManifest = structuredClone(c.assignmentManifest);
      doc.layoutContext = structuredClone(c.layoutContext);
      return;
    }
    case "apply-template": {
      const s = doc.spreads.find((s) => s.id === c.spreadId);
      if (!s) throw new Error("SPREAD_NOT_FOUND");
      s.layers = structuredClone(c.layers);
      s.templateRef = structuredClone(c.templateRef);
      if (c.importedTemplate)
        s.importedTemplate = structuredClone(c.importedTemplate);
      else delete s.importedTemplate;
      if (c.background !== undefined) s.background = c.background;
      return;
    }
    case "set-background": {
      const s = doc.spreads.find((s) => s.id === c.spreadId);
      if (!s) throw new Error("SPREAD_NOT_FOUND");
      s.background = c.color;
      return;
    }
  }
}
export function applyCommand(
  doc: DocumentModel,
  command: DocumentCommand,
): DocumentModel {
  const next = parseDocument(doc);
  mutate(next, command);
  return parseDocument(next);
}
