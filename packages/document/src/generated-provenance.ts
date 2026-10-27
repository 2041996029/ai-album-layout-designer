import type { DocumentModel, DocumentIssue } from "./model";
import { walkLayers, isImageLayer, isTextLayer } from "./model";
export type GenerationProvenance = {
  version: 1;
  jobId: string;
  modelVersionId: string;
  presetVersionId: string;
  inputHash: string;
  referenceAssetIds: string[];
  consentRef: string | null;
  licenseRef: string;
  labelPolicyVersion: string;
  moderationPolicyVersion: string;
  outputSha256: string;
  normalizedSha256: string;
  labelApplied: true;
};
export function generatedProvenanceIssues(
  doc: DocumentModel,
  asset: {
    id: string;
    sha256: string;
    variants: { normalized: { sha256: string } };
    provenance?: GenerationProvenance;
  },
  layerId: string,
): DocumentIssue[] {
  const issue = (code: string, message: string): DocumentIssue => ({
    code,
    message,
    path: "/generated/" + layerId,
    layerId,
    severity: "blocker",
  });
  const p = asset.provenance;
  if (!p || p.version !== 1)
    return [issue("UNSUPPORTED_PROVENANCE", "AI 来源格式尚未验证。")];
  if (
    !p.jobId ||
    !p.modelVersionId ||
    !p.presetVersionId ||
    !p.licenseRef ||
    !p.moderationPolicyVersion ||
    !p.labelPolicyVersion ||
    p.outputSha256 !== asset.sha256 ||
    p.normalizedSha256 !== asset.variants.normalized.sha256 ||
    p.labelApplied !== true
  )
    return [issue("AI_PROVENANCE_INVALID", "AI 来源链、审核或标识不完整。")];
  const surface = [
    { layers: doc.cover.front },
    { layers: doc.cover.back },
    ...doc.spreads,
  ].find((s) => [...walkLayers(s.layers)].some((l) => l.id === layerId));
  const image =
    surface && [...walkLayers(surface.layers)].find((l) => l.id === layerId);
  if (!image || !isImageLayer(image))
    return [issue("AI_PROVENANCE_INVALID", "AI 图层不可用。")];
  const label = surface?.layers.find(
    (l) =>
      isTextLayer(l) &&
      l.aiLabelFor === layerId &&
      l.text === "AI GENERATED" &&
      l.visible &&
      l.opacity === 1 &&
      l.fontSize >= 10 &&
      l.x >= 0 &&
      l.y >= 0 &&
      l.x + l.width <= doc.pageSize.width * 2 &&
      l.y + l.height <= doc.pageSize.height,
  );
  const result: DocumentIssue[] = [];
  if (!label)
    result.push(
      issue("AI_LABEL_MISSING", "请保留可见的 AI GENERATED 来源标识。"),
    );
  if (
    image.alphaMask ||
    image.fitMode !== "contain" ||
    image.crop.x !== 0 ||
    image.crop.y !== 0 ||
    image.crop.width !== 1 ||
    image.crop.height !== 1
  )
    result.push(issue("AI_LABEL_CROPPED", "AI 图片请完整显示，保留来源标识。"));
  return result;
}
