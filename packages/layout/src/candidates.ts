import {
  canonicalJson,
  type DocumentModel,
  type TemplateVersion,
} from "@album/document";
import type { PreparedLayout } from "./types";
import { composeSpread, type SubjectHint } from "./compose";
import { allocateBook } from "./allocate";
import {
  deriveAssignment,
  verifyCandidate,
  type LayoutCandidate,
} from "./integrity";
import { deepFreeze } from "./prepare";
export const candidateContexts = new WeakMap<
  LayoutCandidate,
  { prepared: PreparedLayout; before: string }
>();
export function generateCandidates(
  p: PreparedLayout,
  d: DocumentModel,
  t: TemplateVersion,
  h: SubjectHint[],
): LayoutCandidate[] {
  const allocation = allocateBook(p, d);
  if (!allocation.ok) return [];
  const results: { candidate: LayoutCandidate; score: number }[] = [],
    geometries = new Set<string>();
  for (let variant = 0; variant < 3; variant++) {
    const composed = composeSpread(p, allocation.value, d, t, h, variant);
    if (composed.some((s) => s.hardViolations.length)) continue;
    const spreads = composed.map((s, i) => {
      const old = d.spreads.find((v) => v.id === s.spreadId);
      const fixed =
        p.input.constraints.lockedSpreadIds?.includes(s.spreadId) ||
        (p.input.constraints.targetSpreadIds &&
          !p.input.constraints.targetSpreadIds.includes(s.spreadId));
      return fixed
        ? structuredClone(old!)
        : {
            ...old,
            id: s.spreadId,
            background: t.background,
            layers: s.layers,
            templateRef: { ...p.input.templateRef },
            layoutGeometryVersion:
              variant === 0
                ? "template-or-grid-v1"
                : `local-grid-v1-${variant}`,
          };
    });
    const manifest = deriveAssignment(p.input, { ...d, spreads });
    const candidate: LayoutCandidate = {
      candidateId: `lc_${p.inputHash.slice(0, 20)}_${variant}`,
      baseRevision: p.input.baseRevision,
      inputHash: p.inputHash,
      templateVersion: t.version,
      algorithmVersion: p.input.algorithmVersion,
      seed: p.input.seed,
      spreads,
      assignmentManifest: manifest,
      constraintReport: {
        valid: manifest.violations.length === 0,
        violations: manifest.violations,
      },
      warnings: [...new Set(composed.flatMap((s) => s.warnings))].map(
        (code) => ({ code, message: code }),
      ),
    };
    if (verifyCandidate(p.input, d, candidate).length) continue;
    const geometry = canonicalJson(
      spreads.map((s) =>
        s.layers.map((l) => {
          const { id, layoutInputHash, ...rest } = l;
          return rest;
        }),
      ),
    );
    if (geometries.has(geometry)) continue;
    geometries.add(geometry);
    candidateContexts.set(candidate, { prepared: p, before: canonicalJson(d) });
    results.push({
      candidate: deepFreeze(candidate),
      score:
        composed.reduce((sum, s) => sum + s.score.total, 0) / composed.length,
    });
  }
  return results
    .sort(
      (a, b) =>
        b.score - a.score ||
        a.candidate.candidateId.localeCompare(b.candidate.candidateId),
    )
    .slice(0, p.policy.candidateCount)
    .map((r) => r.candidate);
}
