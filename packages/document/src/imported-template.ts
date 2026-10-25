import { canonicalJson, sha256 } from "./canonical";
import type { Layer, Spread } from "./model";
export interface ImportedTemplateProof {
  version: 1;
  sourceHash: string;
  pageId: string;
  width: number;
  height: number;
  background: string;
  sourceLayers: Layer[];
  sha256: string;
}
/** Local source identity travels in project backups; no remote template registry is required. */
export async function verifyImportedTemplateProof(
  spread: Spread,
): Promise<boolean> {
  try {
    const proof = spread.importedTemplate as ImportedTemplateProof | undefined;
    if (
      !proof ||
      proof.version !== 1 ||
      !/^[a-f0-9]{64}$/.test(proof.sourceHash) ||
      !Array.isArray(proof.sourceLayers) ||
      proof.sourceLayers.length > 100 ||
      !Number.isFinite(proof.width) ||
      !Number.isFinite(proof.height) ||
      proof.width <= 0 ||
      proof.height <= 0
    )
      return false;
    const { sha256: hash, ...payload } = proof;
    return (
      (await sha256(canonicalJson(payload))) === hash &&
      spread.templateRef?.sha256 === hash &&
      spread.templateRef.id === `mjpage_${hash.slice(0, 32)}` &&
      spread.templateRef.version === 1
    );
  } catch {
    return false;
  }
}
