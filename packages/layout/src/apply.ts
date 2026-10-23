import { registerLayoutCommand } from "../../document/src/layout-authorization";
import {
  canonicalJson,
  sha256,
  type DocumentCommand,
  type DocumentModel,
} from "@album/document";
import type { LayoutInput, LayoutPolicy } from "./types";
import {
  deriveAssignment,
  normalizeAssignment,
  verifyCandidate,
  type LayoutCandidate,
} from "./integrity";
import { candidateContexts } from "./candidates";
import { validateLayoutInputShape } from "./prepare";
type LayoutContext = {
  version: 1;
  input: LayoutInput;
  policy: LayoutPolicy;
  inputHash: string;
};
export function createLayoutCommand(
  input: LayoutInput,
  candidate: LayoutCandidate,
  current: DocumentModel,
): DocumentCommand {
  const origin = candidateContexts.get(candidate);
  if (!origin) throw new Error("UNTRUSTED_CANDIDATE");
  if (
    origin.before !== canonicalJson(current) ||
    candidate.baseRevision !== current.revision
  )
    throw new Error("STALE_LAYOUT");
  if (
    canonicalJson(input) !== canonicalJson(origin.prepared.input) ||
    candidate.inputHash !== origin.prepared.inputHash
  )
    throw new Error("CANDIDATE_INPUT_MISMATCH");
  const errors = verifyCandidate(input, current, candidate);
  if (errors.length) throw new Error(errors.join(","));
  const layoutContext: LayoutContext = {
    version: 1,
    input: structuredClone(input),
    policy: structuredClone(origin.prepared.policy),
    inputHash: candidate.inputHash,
  };
  const next = {
    ...current,
    spreads: candidate.spreads,
    assignmentManifest: candidate.assignmentManifest,
    layoutContext,
  };
  const finalErrors = validateDocumentAssignment(next);
  if (finalErrors.length) throw new Error(finalErrors.join(","));
  return registerLayoutCommand({
    type: "apply-layout",
    expectedDocument: canonicalJson(current),
    spreads: structuredClone(candidate.spreads),
    assignmentManifest: structuredClone(candidate.assignmentManifest),
    layoutContext,
  });
}
export function validateDocumentAssignment(doc: DocumentModel): string[] {
  if (doc.assignmentManifest == null && doc.layoutContext == null) return [];
  const manifest = doc.assignmentManifest as
      Record<string, unknown> | undefined,
    context = doc.layoutContext as LayoutContext | undefined;
  if (!manifest || manifest.version !== 1 || !context || context.version !== 1)
    return ["UNSUPPORTED_LAYOUT_MANIFEST"];
  try {
    if (
      !validateLayoutInputShape(context.input) ||
      (context.input.projectId !== doc.projectId &&
        context.input.projectId !== doc.sourceProjectId &&
        context.input.projectId !== doc.layoutSourceProjectId) ||
      !context.policy ||
      context.policy.algorithmVersion !== context.input.algorithmVersion ||
      !context.inputHash?.match(/^[0-9a-f]{64}$/)
    )
      return ["LAYOUT_INTEGRITY_FAILED"];
    const actual = deriveAssignment(context.input, doc);
    if (
      actual.violations.length ||
      canonicalJson(actual) !==
        canonicalJson(
          normalizeAssignment(
            manifest as unknown as import("./integrity").AssignmentManifest,
          ),
        )
    )
      return [
        "LAYOUT_INTEGRITY_FAILED",
        ...actual.violations.map((v) => v.code),
      ];
    return [];
  } catch {
    return ["LAYOUT_INTEGRITY_FAILED"];
  }
}
export async function validateLayoutContextHash(
  doc: DocumentModel,
): Promise<boolean> {
  if (doc.assignmentManifest == null && doc.layoutContext == null) return true;
  const c = doc.layoutContext as LayoutContext | undefined;
  if (!c || c.version !== 1) return false;
  try {
    return (
      (await sha256(canonicalJson({ input: c.input, policy: c.policy }))) ===
      c.inputHash
    );
  } catch {
    return false;
  }
}
