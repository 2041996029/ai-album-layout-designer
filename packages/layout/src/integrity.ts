import { framesWithinPage } from "./geometry";
import {
  canonicalJson,
  isImageLayer,
  isKnownLayer,
  isGroupLayer,
  isTextLayer,
  isShapeLayer,
  type ImportedTemplateProof,
  walkLayers,
  validateDocument,
  type DocumentModel,
  type Spread,
  type Layer,
} from "@album/document";
import type { LayoutInput } from "./types";
export type Placement = { assetId: string; spreadId: string; layerId: string };
export type LayoutViolation = {
  code: string;
  message: string;
  assetIds?: string[];
  layerIds?: string[];
};
export type AssignmentManifest = {
  version?: 1;
  selectionPolicy: LayoutInput["constraints"]["selectionPolicy"];
  duplicatePolicy: LayoutInput["constraints"]["duplicatePolicy"];
  inputAssetIds: string[];
  placements: Placement[];
  unusedAssetIds: string[];
  repeatedAssetIds: string[];
  violations: LayoutViolation[];
};
export type LayoutCandidate = {
  candidateId: string;
  baseRevision: number;
  inputHash: string;
  templateVersion: number;
  algorithmVersion: string;
  seed: number;
  spreads: Spread[];
  assignmentManifest: AssignmentManifest;
  constraintReport: { valid: boolean; violations: LayoutViolation[] };
  warnings: LayoutViolation[];
};
export function normalizeAssignment(
  manifest: AssignmentManifest,
): AssignmentManifest {
  return {
    ...manifest,
    placements: [...manifest.placements].sort((a, b) =>
      a.spreadId < b.spreadId
        ? -1
        : a.spreadId > b.spreadId
          ? 1
          : a.layerId < b.layerId
            ? -1
            : a.layerId > b.layerId
              ? 1
              : a.assetId < b.assetId
                ? -1
                : a.assetId > b.assetId
                  ? 1
                  : 0,
    ),
  };
}
export function deriveAssignment(
  input: LayoutInput,
  doc: DocumentModel,
): AssignmentManifest {
  const c = input.constraints,
    ids = input.photos.map((p) => p.assetId),
    selected = new Set(ids),
    placements: Placement[] = [],
    violations: LayoutViolation[] = [];
  const add = (code: string, assetIds?: string[]) =>
    violations.push({ code, message: code, ...(assetIds ? { assetIds } : {}) });
  for (const spread of doc.spreads) {
    const fixed =
      !!c.lockedSpreadIds?.includes(spread.id) ||
      (!!c.targetSpreadIds && !c.targetSpreadIds.includes(spread.id));
    const visit = (layers: Layer[], locked: boolean) => {
      for (const l of layers) {
        const isLocked =
          locked || l.locked === true || !!c.lockedLayerIds?.includes(l.id);
        if (
          isImageLayer(l) &&
          (l.layoutPhotoRole === "selection" ||
            (isLocked &&
              selected.has(l.assetId) &&
              l.layoutPhotoRole !== "decoration"))
        )
          placements.push({
            assetId: l.assetId,
            spreadId: spread.id,
            layerId: l.id,
          });
        if (isGroupLayer(l)) visit(l.children, isLocked);
      }
    };
    for (const root of spread.layers)
      visit(
        [root],
        fixed ||
          [...walkLayers([root])].some(
            (l) => l.locked === true || c.lockedLayerIds?.includes(l.id),
          ),
      );
  }
  const count = new Map<string, number>();
  for (const p of placements) {
    count.set(p.assetId, (count.get(p.assetId) ?? 0) + 1);
    if (!selected.has(p.assetId)) add("UNKNOWN_PHOTO_ID", [p.assetId]);
  }
  const unusedAssetIds = ids.filter((id) => !count.has(id)),
    repeatedAssetIds = ids.filter((id) => (count.get(id) ?? 0) > 1);
  if (c.selectionPolicy === "all" && unusedAssetIds.length)
    add("MISSING_PHOTO", unusedAssetIds);
  const missingRequired = (c.requiredAssetIds ?? []).filter(
    (id) => !count.has(id),
  );
  if (missingRequired.length) add("MISSING_REQUIRED_PHOTO", missingRequired);
  const excluded = (c.excludedAssetIds ?? []).filter((id) => count.has(id));
  if (excluded.length) add("EXCLUDED_PHOTO_PLACED", excluded);
  const forbidden = repeatedAssetIds.filter(
    (id) =>
      c.duplicatePolicy === "forbid" || !c.explicitRepeatAssetIds?.includes(id),
  );
  if (forbidden.length) add("UNAPPROVED_REPEAT", forbidden);
  for (const s of doc.spreads) {
    const n = placements.filter((p) => p.spreadId === s.id).length;
    if (n < c.minPhotosPerSpread || n > c.maxPhotosPerSpread)
      add("SPREAD_CAPACITY");
  }
  if (doc.spreads.length !== c.spreadCount) add("SPREAD_COUNT");
  return normalizeAssignment({
    version: 1,
    selectionPolicy: c.selectionPolicy,
    duplicatePolicy: c.duplicatePolicy,
    inputAssetIds: ids,
    placements,
    unusedAssetIds,
    repeatedAssetIds,
    violations,
  });
}
/** The source may intentionally bleed beyond the page. Only its exact uniformly
 * scaled composition qualifies; ordinary layouts retain strict frame bounds. */
export function importedSourceGeometryMatches(
  spread: Spread,
  width: number,
  height: number,
): boolean {
  try {
    const proof = spread.importedTemplate as ImportedTemplateProof | undefined;
    if (
      !proof ||
      proof.version !== 1 ||
      !Array.isArray(proof.sourceLayers) ||
      !Number.isFinite(proof.width) ||
      !Number.isFinite(proof.height) ||
      proof.width <= 0 ||
      proof.height <= 0 ||
      Math.abs(width / height - proof.width / proof.height) > 1e-6 ||
      spread.templateRef?.sha256 !== proof.sha256 ||
      spread.templateRef.id !== `mjpage_${proof.sha256.slice(0, 32)}` ||
      spread.templateRef.version !== 1 ||
      spread.background !== proof.background
    )
      return false;
    const scale = width / proof.width;
    const compare = (source: Layer[], actual: Layer[]): boolean =>
      source.length === actual.length &&
      source.every((original, index) => {
        const expected = structuredClone(original),
          found = structuredClone(actual[index]);
        if (
          !isKnownLayer(expected) ||
          !isKnownLayer(found) ||
          expected.type !== found.type
        )
          return false;
        expected.x *= scale;
        expected.y *= scale;
        expected.width *= scale;
        expected.height *= scale;
        if (isTextLayer(expected)) {
          expected.fontSize *= scale;
          expected.letterSpacing *= scale;
        }
        if (isShapeLayer(expected)) {
          expected.strokeWidth *= scale;
          if (expected.radius !== undefined) expected.radius *= scale;
        }
        if (isGroupLayer(expected)) {
          if (
            !isGroupLayer(found) ||
            !compare(expected.children, found.children)
          )
            return false;
          expected.children = [];
          found.children = [];
        }
        // The compositor changes identity and attribution; declared photo slots
        // additionally replace the demonstration image and normalize its crop.
        for (const layer of [expected, found]) {
          delete (layer as Record<string, unknown>).id;
          delete layer.layoutInputHash;
          delete layer.layoutPhotoRole;
        }
        if (
          isImageLayer(expected) &&
          isImageLayer(found) &&
          actual[index].layoutPhotoRole === "selection"
        ) {
          if (
            expected.templateSlot &&
            canonicalJson(expected.templateSlot) !==
              canonicalJson(found.templateSlot)
          )
            return false;
          delete expected.templateSlot;
          delete found.templateSlot;
          expected.assetId = found.assetId;
          expected.crop = { x: 0, y: 0, width: 1, height: 1 };
          // Older saved imported pages used cover; new substitutions preserve the full photo.
          expected.fitMode = found.fitMode === "contain" ? "contain" : "cover";
        }
        return canonicalJson(expected) === canonicalJson(found);
      });
    return compare(proof.sourceLayers, spread.layers);
  } catch {
    return false;
  }
}
export function verifyCandidate(
  input: LayoutInput,
  before: DocumentModel,
  candidate: LayoutCandidate,
): string[] {
  const errors: string[] = [],
    c = input.constraints;
  if (
    input.baseRevision !== before.revision ||
    candidate.baseRevision !== before.revision ||
    input.projectId !== before.projectId
  )
    errors.push("STALE_DOCUMENT");
  if (
    candidate.algorithmVersion !== input.algorithmVersion ||
    candidate.seed !== input.seed ||
    candidate.templateVersion !== input.templateRef.version
  )
    errors.push("CANDIDATE_INPUT_MISMATCH");
  const after = { ...before, spreads: candidate.spreads },
    actual = deriveAssignment(input, after);
  if (
    canonicalJson(actual) !==
    canonicalJson(normalizeAssignment(candidate.assignmentManifest))
  )
    errors.push("MANIFEST_DOCUMENT_MISMATCH");
  errors.push(...actual.violations.map((v) => v.code));
  for (const spread of before.spreads) {
    const next = candidate.spreads.find((s) => s.id === spread.id);
    if (
      c.lockedSpreadIds?.includes(spread.id) ||
      (c.targetSpreadIds && !c.targetSpreadIds.includes(spread.id))
    ) {
      if (canonicalJson(spread) !== canonicalJson(next ?? null))
        errors.push("FIXED_SPREAD_CHANGED");
    }
    const nextLayers = next ? [...walkLayers(next.layers)] : [];
    for (const root of spread.layers)
      if (
        [...walkLayers([root])].some(
          (l) => l.locked === true || c.lockedLayerIds?.includes(l.id),
        )
      ) {
        if (
          canonicalJson(root) !==
          canonicalJson(next?.layers.find((l) => l.id === root.id) ?? null)
        )
          errors.push("LOCKED_LAYER_CHANGED");
      }

    const visit = (layers: Layer[], parentLocked: boolean) => {
      for (const layer of layers) {
        const locked =
          parentLocked ||
          layer.locked === true ||
          !!c.lockedLayerIds?.includes(layer.id);
        if (
          locked &&
          canonicalJson(layer) !==
            canonicalJson(nextLayers.find((l) => l.id === layer.id) ?? null)
        )
          errors.push("LOCKED_LAYER_CHANGED");
        if (isGroupLayer(layer)) visit(layer.children, locked);
      }
    };
    visit(spread.layers, false);
  }
  for (const l of candidate.spreads.flatMap((s) => [...walkLayers(s.layers)]))
    if (
      isImageLayer(l) &&
      l.layoutPhotoRole === "selection" &&
      l.layoutInputHash !== candidate.inputHash
    ) {
      // Preserved old tagged layers retain their original attribution.
      const old = before.spreads
        .flatMap((s) => [...walkLayers(s.layers)])
        .find((v) => v.id === l.id);
      if (!old || canonicalJson(old) !== canonicalJson(l))
        errors.push("PHOTO_INPUT_HASH_MISMATCH");
    }
  if (
    candidate.spreads.some(
      (s) =>
        !framesWithinPage(
          s.layers,
          before.pageSize.width * 2,
          before.pageSize.height,
        ) &&
        !importedSourceGeometryMatches(
          s,
          before.pageSize.width * 2,
          before.pageSize.height,
        ),
    )
  )
    errors.push("FRAME_OUT_OF_BOUNDS");
  errors.push(
    ...validateDocument(after)
      .filter((v) => v.severity === "blocker")
      .map((v) => v.code),
  );
  if (
    !candidate.constraintReport.valid ||
    canonicalJson(candidate.constraintReport.violations) !==
      canonicalJson(actual.violations)
  )
    errors.push("INVALID_CONSTRAINT_REPORT");
  return [...new Set(errors)];
}
