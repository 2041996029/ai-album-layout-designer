import {
  canonicalJson,
  sha256,
  isImageLayer,
  isGroupLayer,
  isKnownLayer,
  isTextLayer,
  isShapeLayer,
  walkLayers,
  type DocumentModel,
  type Layer,
  type Spread,
} from "@album/document";
import type { ImportedTheme, ImportedPage } from "@album/template-import";
import type { LayoutInput } from "./types";
import { prepareLayout, deepFreeze } from "./prepare";
import {
  deriveAssignment,
  verifyCandidate,
  type LayoutCandidate,
} from "./integrity";
import { candidateContexts } from "./candidates";
export async function createImportedPageProof(
  theme: ImportedTheme,
  page: ImportedPage,
) {
  const payload = {
    version: 1 as const,
    sourceHash: theme.sourceHash,
    pageId: page.id,
    width: page.width,
    height: page.height,
    background: page.background,
    sourceLayers: structuredClone(page.layers),
  };
  return { ...payload, sha256: await sha256(canonicalJson(payload)) };
}
/** Compose the chosen source pages verbatim, substituting only their declared photo slots. */
export async function generateThemeCandidates(
  input: LayoutInput,
  before: DocumentModel,
  theme: ImportedTheme,
  selectedPageIds: readonly string[],
): Promise<LayoutCandidate[]> {
  // Snapshot theme and page order before any asynchronous hashing.
  theme = structuredClone(theme);
  selectedPageIds = [...selectedPageIds];
  if (
    input.templateRef.id !== theme.id ||
    input.templateRef.version !== 1 ||
    input.templateRef.sha256 !== theme.sourceHash
  )
    throw new Error("TEMPLATE_UNAVAILABLE");
  if (canonicalJson(input.templatePageIds) !== canonicalJson(selectedPageIds))
    throw new Error("THEME_PAGE_SEQUENCE_MISMATCH");
  if (
    !selectedPageIds.length ||
    new Set(selectedPageIds).size !== selectedPageIds.length
  )
    throw new Error("INVALID_THEME_PAGE_SEQUENCE");
  const pages = selectedPageIds.map((id) => {
    const p = theme.pages.find((p) => p.id === id);
    if (!p) throw new Error("UNKNOWN_THEME_PAGE");
    if (p.issues.some((issue) => issue.severity === "blocker"))
      throw new Error("UNSUPPORTED_TEMPLATE_PAGE");
    return p;
  });
  const p = await prepareLayout(input),
    c = p.input.constraints;
  if (
    before.projectId !== p.input.projectId ||
    before.revision !== p.input.baseRevision
  )
    throw new Error("STALE_DOCUMENT");
  if (
    c.spreadCount !== pages.length ||
    (c.targetSpreadIds && c.spreadCount !== before.spreads.length) ||
    before.spreads.slice(c.spreadCount).some((s) => s.layers.length)
  )
    throw new Error("THEME_CAPACITY_MISMATCH");
  const allOld = [
    ...walkLayers(before.cover.front),
    ...walkLayers(before.cover.back),
    ...before.spreads.flatMap((s) => [...walkLayers(s.layers)]),
  ];
  if (
    c.lockedLayerIds?.some((id) => !allOld.some((l) => l.id === id)) ||
    [...(c.lockedSpreadIds ?? []), ...(c.targetSpreadIds ?? [])].some(
      (id) => !before.spreads.some((s) => s.id === id),
    )
  )
    throw new Error("UNKNOWN_LOCK_OR_TARGET");
  const ordered = p.orderedAssetIds.filter(
    (id) => !c.excludedAssetIds?.includes(id),
  );
  if (
    ordered.length !==
    pages.reduce((sum, page) => sum + page.photoSlots.length, 0)
  )
    throw new Error("THEME_CAPACITY_MISMATCH");
  const width = before.pageSize.width * 2,
    height = before.pageSize.height;
  const spreads: Spread[] = [];
  let cursor = 0;
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index],
      old = before.spreads[index],
      spreadId = old?.id ?? `layout_spread_${index + 1}`;
    if (
      !Number.isFinite(page.width) ||
      !Number.isFinite(page.height) ||
      page.width <= 0 ||
      page.height <= 0 ||
      Math.abs(width / height - page.width / page.height) > 1e-6
    )
      throw new Error("PAGE_ASPECT_MISMATCH");
    const assigned = ordered.slice(cursor, cursor + page.photoSlots.length);
    cursor += assigned.length;
    const fixed =
      old &&
      (c.lockedSpreadIds?.includes(spreadId) ||
        (c.targetSpreadIds && !c.targetSpreadIds.includes(spreadId)) ||
        [...walkLayers(old.layers)].some(
          (l) => l.locked === true || c.lockedLayerIds?.includes(l.id),
        ));
    if (fixed) {
      const selected = new Set(p.input.photos.map((photo) => photo.assetId));
      const retained = [...walkLayers(old.layers)]
        .filter(isImageLayer)
        .filter(
          (l) => l.layoutPhotoRole !== "decoration" && selected.has(l.assetId),
        )
        .map((l) => l.assetId);
      if (canonicalJson(retained) !== canonicalJson(assigned))
        throw new Error("THEME_CAPACITY_MISMATCH");
      spreads.push(structuredClone(old));
      continue;
    }
    const proof = await createImportedPageProof(theme, page),
      scale = width / page.width;
    const slots = new Map(
      page.photoSlots.map((slot, i) => [
        slot.layerId,
        { slot, assetId: assigned[i] },
      ]),
    );
    if (slots.size !== page.photoSlots.length)
      throw new Error("INVALID_THEME_SLOTS");
    const seen = new Set<string>();
    let n = 0;
    const transform = (layers: Layer[]): Layer[] =>
      layers.map((source) => {
        const layer = structuredClone(source),
          slot = slots.get(source.id);
        layer.id = `ly_${p.inputHash.slice(0, 16)}_${index}_${n++}`;
        if (isKnownLayer(layer)) {
          layer.x *= scale;
          layer.y *= scale;
          layer.width *= scale;
          layer.height *= scale;
          if (isTextLayer(layer)) {
            layer.fontSize *= scale;
            layer.letterSpacing *= scale;
          }
          if (isShapeLayer(layer)) {
            layer.strokeWidth *= scale;
            if (layer.radius !== undefined) layer.radius *= scale;
          }
          if (isGroupLayer(layer)) layer.children = transform(layer.children);
        }
        if (slot) {
          if (!isImageLayer(layer)) throw new Error("INVALID_THEME_SLOTS");
          seen.add(source.id);
          layer.assetId = slot.assetId;
          layer.templateSlot = { version: 1, slotId: slot.slot.slotId };
          layer.layoutPhotoRole = "selection";
          layer.layoutInputHash = p.inputHash;
          layer.crop = { x: 0, y: 0, width: 1, height: 1 };
          layer.fitMode = "contain";
        } else if (isImageLayer(layer)) {
          layer.layoutPhotoRole = "decoration";
          delete layer.layoutInputHash;
        }
        return layer;
      });
    const layers = transform(page.layers);
    if (seen.size !== slots.size) throw new Error("INVALID_THEME_SLOTS");
    spreads.push({
      ...old,
      id: spreadId,
      background: page.background,
      layers,
      templateRef: {
        id: `mjpage_${proof.sha256.slice(0, 32)}`,
        version: 1,
        sha256: proof.sha256,
      },
      importedTemplate: proof,
      layoutGeometryVersion: "imported-theme-v1",
    });
  }
  const manifest = deriveAssignment(p.input, { ...before, spreads });
  const candidate: LayoutCandidate = {
    candidateId: `lc_${p.inputHash.slice(0, 20)}_theme`,
    baseRevision: p.input.baseRevision,
    inputHash: p.inputHash,
    templateVersion: 1,
    algorithmVersion: p.input.algorithmVersion,
    seed: p.input.seed,
    spreads,
    assignmentManifest: manifest,
    constraintReport: {
      valid: manifest.violations.length === 0,
      violations: manifest.violations,
    },
    warnings: [],
  };
  const errors = verifyCandidate(p.input, before, candidate);
  if (errors.length) throw new Error(errors.join(","));
  candidateContexts.set(candidate, {
    prepared: p,
    before: canonicalJson(before),
  });
  return [deepFreeze(candidate)];
}
