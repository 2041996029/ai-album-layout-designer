import {
  isGroupLayer,
  type DocumentModel,
  type Layer,
  type Spread,
} from "@album/document";
import type { components } from "@album/contracts";
import { fail } from "@album/server-core";
export type MiniPatch =
  | components["schemas"]["SetText"]
  | components["schemas"]["SetCrop"]
  | components["schemas"]["ReplaceAsset"]
  | components["schemas"]["ReorderSpreads"];
export interface MiniFieldPolicy {
  editableFields: readonly string[];
  allowedAssetIds?: readonly string[];
  assetDimensions?: { width: number; height: number };
}
export type MiniPolicy = (
  spread: Spread,
  layer: Layer,
) => MiniFieldPolicy | undefined;
const forbidden = () => fail("MINI_PATCH_FORBIDDEN", 403);
export function patchDocument(
  document: DocumentModel,
  patches: MiniPatch[],
  policy: MiniPolicy,
): DocumentModel {
  if (!Array.isArray(patches) || !patches.length || patches.length > 100)
    forbidden();
  const doc = structuredClone(document);
  for (const patch of patches) {
    if (!patch || typeof patch !== "object") forbidden();
    const keys: Record<string, string[]> = {
      setText: ["type", "spreadId", "layerId", "text"],
      setCrop: ["type", "spreadId", "layerId", "crop"],
      replaceAsset: ["type", "spreadId", "layerId", "assetId"],
      reorderSpreads: ["type", "spreadIds"],
    };
    const allowed = keys[patch.type];
    if (
      !allowed ||
      Object.keys(patch).some((k) => !allowed.includes(k)) ||
      allowed.some((k) => !(k in patch))
    )
      forbidden();
    if (patch.type === "reorderSpreads") {
      const ids = patch.spreadIds;
      if (
        !Array.isArray(ids) ||
        ids.length !== doc.spreads.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !doc.spreads.some((s) => s.id === id))
      )
        forbidden();
      doc.spreads = ids.map((id) => doc.spreads.find((s) => s.id === id)!);
      continue;
    }
    const spread = doc.spreads.find((s) => s.id === patch.spreadId);
    if (!spread) forbidden();
    const locate = (
      layers: Layer[],
      ancestorLocked = false,
    ): { layer: Layer; locked: boolean } | undefined => {
      for (const candidate of layers) {
        const locked = ancestorLocked || Boolean(candidate.locked);
        if (candidate.id === patch.layerId) return { layer: candidate, locked };
        if (isGroupLayer(candidate)) {
          const child = locate(candidate.children, locked);
          if (child) return child;
        }
      }
    };
    const found = locate(spread!.layers),
      layer = found?.layer;
    if (found?.locked) forbidden();
    if (!layer || layer.locked) forbidden();
    const permissions = policy(spread!, layer!);
    if (!permissions) forbidden();
    if (patch.type === "setText") {
      if (
        layer!.type !== "text" ||
        !permissions!.editableFields.includes("text") ||
        typeof patch.text !== "string" ||
        patch.text.length > 20000
      )
        forbidden();
      layer!.text = patch.text;
    } else if (patch.type === "setCrop") {
      const c = patch.crop;
      if (
        layer!.type !== "image" ||
        !permissions!.editableFields.includes("crop") ||
        !c ||
        Object.keys(c).some(
          (k) => !["x", "y", "width", "height"].includes(k),
        ) ||
        ![c.x, c.y, c.width, c.height].every(Number.isFinite) ||
        c.x < 0 ||
        c.y < 0 ||
        c.width <= 0 ||
        c.height <= 0 ||
        c.x + c.width > 1 ||
        c.y + c.height > 1
      )
        forbidden();
      const size = permissions!.assetDimensions;
      if (
        layer!.fitMode !== "contain" &&
        (!size ||
          Math.abs(
            (c.width * size.width) / (c.height * size.height) -
              Number(layer!.width) / Number(layer!.height),
          ) > 1e-4)
      )
        forbidden();
      layer!.crop = structuredClone(c);
    } else {
      if (
        layer!.type !== "image" ||
        !permissions!.editableFields.includes("assetId") ||
        !permissions!.allowedAssetIds?.includes(patch.assetId)
      )
        forbidden();
      layer!.assetId = patch.assetId;
    }
  }
  return doc;
}
