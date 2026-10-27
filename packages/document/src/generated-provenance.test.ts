import { it, expect } from "vitest";
import fixture from "../../../tests/fixtures/documents/minimal.json";
import { createGeneratedInsertionCommand } from "./generated-insertion";
import { generatedProvenanceIssues } from "./generated-provenance";
import { applyCommand } from "./commands";
it("blocks missing labels, altered provenance and cropped generated pictures", () => {
  const doc: any = structuredClone(fixture);
  let n = 0;
  const p: any = {
    version: 1,
    jobId: "job",
    modelVersionId: "model",
    presetVersionId: "preset",
    inputHash: "a".repeat(64),
    referenceAssetIds: [],
    consentRef: "consent",
    licenseRef: "license",
    labelPolicyVersion: "label",
    moderationPolicyVersion: "moderation",
    outputSha256: "b".repeat(64),
    normalizedSha256: "c".repeat(64),
    labelApplied: true,
  };
  const asset: any = {
    id: "art",
    sha256: p.outputSha256,
    variants: { normalized: { sha256: p.normalizedSha256 } },
    provenance: p,
  };
  const next = applyCommand(
    doc,
    createGeneratedInsertionCommand(
      doc,
      {
        assetId: "art",
        spreadId: doc.spreads[0].id,
        provenance: p,
        title: null,
        dateText: null,
      },
      () => `generated-${++n}`,
    ),
  );
  const image: any = next.spreads[0].layers.find((l) => l.id === "generated-1");
  expect(generatedProvenanceIssues(next, asset, image.id)).toEqual([]);
  image.crop.width = 0.5;
  expect(
    generatedProvenanceIssues(next, asset, image.id).map((i) => i.code),
  ).toContain("AI_LABEL_CROPPED");
  image.crop.width = 1;
  next.spreads[0].layers = next.spreads[0].layers.filter(
    (l) => l.aiLabelFor !== image.id,
  );
  expect(
    generatedProvenanceIssues(next, asset, image.id).map((i) => i.code),
  ).toContain("AI_LABEL_MISSING");
  asset.provenance.labelApplied = false;
  expect(
    generatedProvenanceIssues(next, asset, image.id).map((i) => i.code),
  ).toContain("AI_PROVENANCE_INVALID");
});
