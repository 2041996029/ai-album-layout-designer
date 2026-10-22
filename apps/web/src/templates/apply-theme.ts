import {
  canonicalJson,
  isKnownLayer,
  isImageLayer,
  isTextLayer,
  isShapeLayer,
  isGroupLayer,
  walkLayers,
  type DocumentModel,
  type DocumentCommand,
  type Layer,
} from "@album/document";
import { createImportedPageProof } from "@album/layout";
import type { ImportedTheme } from "@album/template-import";
import type { ResourceManifest, ResourceWriter } from "@album/assets";
import type { ConvertedTheme } from "@album/template-import";
export async function prepareThemePage(
  theme: ImportedTheme,
  pageId: string,
  bindings: Record<string, string>,
  doc: DocumentModel,
  spreadId: string,
): Promise<DocumentCommand> {
  const page = theme.pages.find((p) => p.id === pageId),
    old = doc.spreads.find((s) => s.id === spreadId);
  if (!page || !old) throw Error("SPREAD_NOT_FOUND");
  if (page.issues.some((i) => i.severity === "blocker"))
    throw Error("UNSUPPORTED_TEMPLATE_PAGE");
  if ([...walkLayers(old.layers)].some((l) => l.locked))
    throw Error("LAYER_LOCKED");
  if (
    Math.abs(
      (doc.pageSize.width * 2) / doc.pageSize.height - page.width / page.height,
    ) > 1e-6
  )
    throw Error("PAGE_ASPECT_MISMATCH");
  const ids = page.photoSlots.map((s) => bindings[s.slotId]);
  if (ids.some((id) => !id)) throw Error("TEMPLATE_BINDING_REQUIRED");
  if (new Set(ids).size !== ids.length) throw Error("DUPLICATE_PHOTO_BINDING");
  const scale = doc.pageSize.height / page.height;
  const slots = new Map(page.photoSlots.map((s) => [s.layerId, s.slotId]));
  const transform = (layers: readonly Layer[]): Layer[] =>
    layers.map((source) => {
      const l = structuredClone(source);
      l.id = `mjlayer_${crypto.randomUUID().replaceAll("-", "")}`;
      if (isKnownLayer(l)) {
        l.x *= scale;
        l.y *= scale;
        l.width *= scale;
        l.height *= scale;
        if (isTextLayer(l)) {
          l.fontSize *= scale;
          l.letterSpacing *= scale;
        }
        if (isShapeLayer(l)) {
          l.strokeWidth *= scale;
          if (l.radius !== undefined) l.radius *= scale;
        }
        if (isGroupLayer(l)) l.children = transform(l.children);
      }
      const slot = slots.get(source.id);
      if (slot && isImageLayer(l)) {
        l.assetId = bindings[slot];
        l.crop = { x: 0, y: 0, width: 1, height: 1 };
        l.fitMode = "cover";
        l.layoutPhotoRole = "selection";
        delete l.layoutInputHash;
      }
      return l;
    });
  const proof = await createImportedPageProof(theme, page);
  return {
    type: "apply-template",
    spreadId,
    layers: transform(page.layers),
    background: page.background,
    templateRef: {
      id: `mjpage_${proof.sha256.slice(0, 32)}`,
      version: 1,
      sha256: proof.sha256,
    },
    importedTemplate: proof,
  };
}
/** Copies only live rendering dependencies, never an entire source theme into every project. */
export async function stageThemeResources(
  converted: ConvertedTheme,
  layers: readonly Layer[],
  existing: ResourceManifest,
  writer: ResourceWriter,
): Promise<ResourceManifest> {
  const imageIds = new Set<string>(),
    fontIds = new Set<string>();
  for (const l of walkLayers(layers as Layer[])) {
    if (isImageLayer(l)) {
      imageIds.add(l.assetId);
      if (l.alphaMask) imageIds.add(l.alphaMask.assetId);
    }
    if (isTextLayer(l)) fontIds.add(l.fontAssetId);
  }
  const assets = [...existing.assets],
    fonts = [...existing.fonts];
  const read = (key: string) => {
    const bytes = converted.files.get(key);
    if (!bytes) throw Error(`THEME_RESOURCE_MISSING:${key}`);
    return bytes;
  };
  for (const record of converted.theme.resources.assets) {
    if (!imageIds.has(record.id) || assets.some((a) => a.id === record.id))
      continue;
    await writer.putAsset(record, {
      original: read(`${record.id}:original`),
      normalized: read(`${record.id}:normalized`),
      preview: read(`${record.id}:preview`),
    });
    assets.push(record);
  }
  for (const record of converted.theme.resources.fonts) {
    if (!fontIds.has(record.id) || fonts.some((f) => f.id === record.id))
      continue;
    await writer.putFont(
      record,
      new Map(record.faces.map((f) => [f.id, read(`${f.id}:font`)])),
    );
    fonts.push(record);
  }
  if (
    [...imageIds].some((id) => !assets.some((a) => a.id === id)) ||
    [...fontIds].some((id) => !fonts.some((f) => f.id === id))
  )
    throw Error("THEME_RESOURCE_MISSING");
  return { assets, fonts };
}
