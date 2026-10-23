import { framesWithinPage } from "./geometry";
import {
  instantiateTemplate,
  isImageLayer,
  isKnownLayer,
  isTextLayer,
  isShapeLayer,
  isGroupLayer,
  walkLayers,
  templateVersions,
  canonicalJson,
  type DocumentModel,
  type Layer,
  type ImageLayer,
  type TemplateVersion,
} from "@album/document";
import { scoreSpread } from "./score";
import type { PreparedLayout, LayoutWeights } from "./types";
import type { Allocation } from "./allocate";
export type SubjectHint = {
  assetId: string;
  rect: { x: number; y: number; width: number; height: number };
  confidence: number;
};
export type ComposedSpread = {
  spreadId: string;
  layers: Layer[];
  hardViolations: string[];
  warnings: string[];
  score: {
    subject: number;
    timeline: number;
    whitespace: number;
    variety: number;
    color: number;
    total: number;
  };
};
export function composeSpread(
  p: PreparedLayout,
  a: Allocation,
  d: DocumentModel,
  t: TemplateVersion,
  hints: SubjectHint[],
  variant = 0,
): ComposedSpread[] {
  if (
    !templateVersions.some((v) => canonicalJson(v) === canonicalJson(t)) ||
    t.id !== p.input.templateRef.id ||
    t.version !== p.input.templateRef.version ||
    t.sha256 !== p.input.templateRef.sha256
  )
    throw new Error("TEMPLATE_UNAVAILABLE");
  const width = d.pageSize.width * 2,
    height = d.pageSize.height;
  const lockedIds = new Set(p.input.constraints.lockedLayerIds ?? []);
  return a.spreads.map((allocation, page) => {
    const old = d.spreads.find((s) => s.id === allocation.spreadId);
    const fixed =
      p.input.constraints.lockedSpreadIds?.includes(allocation.spreadId) ||
      (p.input.constraints.targetSpreadIds &&
        !p.input.constraints.targetSpreadIds.includes(allocation.spreadId));
    const retained = (old?.layers ?? []).filter(
      (l) =>
        fixed ||
        [...walkLayers([l])].some(
          (child) => child.locked === true || lockedIds.has(child.id),
        ),
    );
    const remaining = [...allocation.assetIds];
    for (const l of retained.flatMap((l) => [...walkLayers([l])]))
      if (isImageLayer(l) && l.layoutPhotoRole !== "decoration") {
        const i = remaining.indexOf(l.assetId);
        if (i >= 0) remaining.splice(i, 1);
      }
    const hardViolations: string[] = [],
      warnings: string[] = [];
    let counter = 0;
    const occupiedIds = new Set(
      d.spreads.flatMap((s) => [...walkLayers(s.layers)].map((l) => l.id)),
    );
    const nextId = () => {
      let id: string;
      do {
        id = `ly_${p.inputHash.slice(0, 16)}_${page}_${variant}_${counter++}`;
      } while (occupiedIds.has(id));
      occupiedIds.add(id);
      return id;
    };
    // Prefer the fixed composition for this style and actual allocated count.
    const composition =
      t.id.startsWith("style_") || Boolean(t.themeId)
        ? (templateVersions.find(
            (v) =>
              (t.themeId
                ? v.themeId === t.themeId
                : v.id.startsWith("style_")) &&
              v.category === t.category &&
              v.version === t.version &&
              v.slots.filter((s) => s.kind === "image").length ===
                remaining.length,
          ) ?? t)
        : t;
    const compositionSlots = composition.slots.filter(
      (s) => s.kind === "image",
    );
    let layers: Layer[] = [];
    const sameAspect =
      Math.abs(width / height - (t.pageSize.width * 2) / t.pageSize.height) <
      0.000001;
    if (
      !fixed &&
      remaining.length &&
      remaining.length === compositionSlots.length &&
      sameAspect &&
      !retained.length &&
      (variant === 0 || t.id.startsWith("style_") || Boolean(t.themeId))
    ) {
      const bindings = Object.fromEntries(
        compositionSlots.map((slot, i) => [slot.slotId, remaining[i]]),
      );
      const scale = height / t.pageSize.height;
      layers = instantiateTemplate(composition, bindings, nextId);
      for (const l of layers)
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
        }
    } else if (!fixed && remaining.length) {
      // Original versioned local-grid geometry. Template supplies style; never mutate its registered slots.
      const cols = Math.max(
        1,
        Math.min(
          remaining.length,
          Math.ceil(Math.sqrt((remaining.length * width) / height)) +
            (variant === 2 ? 1 : 0),
        ),
      );
      const rows = Math.ceil(remaining.length / cols),
        margin = Math.min(width, height) * 0.055,
        gap = Math.min(width, height) * 0.025;
      // Reserve a bottom caption band. With retained content use the right half and flag manual review.
      const origin = retained.length ? width / 2 + margin : margin;
      const areaWidth = width - margin - origin,
        areaHeight = height * 0.82 - margin;
      const cellW = (areaWidth - gap * (cols - 1)) / cols,
        cellH = (areaHeight - gap * (rows - 1)) / rows;
      layers = remaining.map((assetId, index): ImageLayer => ({
        id: nextId(),
        type: "image",
        assetId,
        x: origin + (index % cols) * (cellW + gap),
        y: margin + Math.floor(index / cols) * (cellH + gap),
        width: cellW,
        height: cellH,
        rotation: 0,
        opacity: 1,
        visible: true,
        locked: false,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        fitMode: variant === 1 ? "contain" : "cover",
        layoutGeometryVersion: "local-grid-v1",
      }));
      if (retained.length) warnings.push("LOCKED_CONTENT_OVERLAP_REVIEW");
    }
    layers = [...structuredClone(retained), ...layers];
    const retention: number[] = [];
    for (const l of layers.flatMap((l) => [...walkLayers([l])])) {
      if (
        !isImageLayer(l) ||
        retained.some((root) =>
          [...walkLayers([root])].some((v) => v.id === l.id),
        )
      )
        continue;
      if ((t.id.startsWith("style_") || Boolean(t.themeId)) && variant === 1)
        l.fitMode = "contain";
      l.layoutPhotoRole = "selection";
      l.layoutInputHash = p.inputHash;
      const photo = p.input.photos.find((v) => v.assetId === l.assetId);
      if (!photo) {
        hardViolations.push("UNKNOWN_PHOTO_ID");
        continue;
      }
      const frameAspect = l.width / l.height,
        aspect = photo.width / photo.height;
      let crop =
        l.fitMode === "contain"
          ? { x: 0, y: 0, width: 1, height: 1 }
          : aspect > frameAspect
            ? {
                x: (1 - frameAspect / aspect) / 2,
                y: 0,
                width: frameAspect / aspect,
                height: 1,
              }
            : {
                x: 0,
                y: (1 - aspect / frameAspect) / 2,
                width: 1,
                height: aspect / frameAspect,
              };
      l.crop = crop;
      const subjects = hints.filter(
        (h) =>
          h.assetId === l.assetId &&
          h.confidence >= 0.5 &&
          h.confidence <= 1 &&
          [h.rect.x, h.rect.y, h.rect.width, h.rect.height].every(
            Number.isFinite,
          ) &&
          h.rect.x >= 0 &&
          h.rect.y >= 0 &&
          h.rect.width > 0 &&
          h.rect.height > 0 &&
          h.rect.x + h.rect.width <= 1 &&
          h.rect.y + h.rect.height <= 1,
      );
      // A warning does not prevent a damaged album. Unknown subjects or any
      // subject crossing the crop boundary must fall back to the complete photo.
      const safe =
        subjects.length > 0 &&
        subjects.every(
          ({ rect: r }) =>
            crop.x <= Math.max(0, r.x - 0.02) + 1e-8 &&
            crop.y <= Math.max(0, r.y - 0.02) + 1e-8 &&
            crop.x + crop.width >= Math.min(1, r.x + r.width + 0.02) - 1e-8 &&
            crop.y + crop.height >= Math.min(1, r.y + r.height + 0.02) - 1e-8,
        );
      if (!safe) {
        l.fitMode = "contain";
        crop = { x: 0, y: 0, width: 1, height: 1 };
        l.crop = crop;
        warnings.push("SAFE_FIT_APPLIED");
      }
      if (!subjects.length) {
        warnings.push("SUBJECT_UNKNOWN");
        retention.push(0.5);
      } else retention.push(1);
    }
    if (!framesWithinPage(layers, width, height))
      hardViolations.push("FRAME_OUT_OF_BOUNDS");
    if (
      !Number.isFinite(width) ||
      !Number.isFinite(height) ||
      width <= 0 ||
      height <= 0
    )
      hardViolations.push("FRAME_OUT_OF_BOUNDS");
    const imageLayers = layers.filter(isImageLayer),
      area = imageLayers.reduce((sum, l) => sum + l.width * l.height, 0),
      declaredArea =
        compositionSlots.reduce(
          (sum, s) => sum + s.frame.width * s.frame.height,
          0,
        ) /
        (t.pageSize.width * 2 * t.pageSize.height);
    const indices = allocation.assetIds.map((id) =>
      p.orderedAssetIds.indexOf(id),
    );
    let inversions = 0;
    for (let i = 0; i < indices.length; i++)
      for (let j = i + 1; j < indices.length; j++)
        if (indices[i] > indices[j]) inversions++;
    const result: ComposedSpread = {
      spreadId: allocation.spreadId,
      layers,
      hardViolations: [...new Set(hardViolations)],
      warnings: [...new Set(warnings)],
      score: {
        subject: retention.length
          ? retention.reduce((a, b) => a + b, 0) / retention.length
          : 0.5,
        timeline:
          indices.length > 1
            ? 1 - inversions / ((indices.length * (indices.length - 1)) / 2)
            : 1,
        whitespace: Math.max(
          0,
          1 - Math.abs(area / (width * height) - declaredArea),
        ),
        variety: old?.templateRef?.id === t.id ? 0 : 1,
        color: 0.5,
        total: 0,
      },
    };
    result.score = scoreSpread(result, p.policy.weights);
    return result;
  });
}
