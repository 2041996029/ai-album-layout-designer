import { it, expect } from "vitest";
import fixture from "../../../tests/fixtures/documents/minimal.json";
import { createGeneratedInsertionCommand } from "./generated-insertion";
import { applyCommand } from "./commands";
it("inserts generated art and separate editable captions without replacing existing layers and replays once", () => {
  const doc: any = structuredClone(fixture),
    before = JSON.stringify(doc.spreads[0].layers);
  let count = 0;
  const provenance: any = {
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
  const command = createGeneratedInsertionCommand(
    doc,
    {
      assetId: "generated-asset",
      spreadId: doc.spreads[0].id,
      provenance,
      title: "山水",
      dateText: "2026",
      commandId: "insert-job",
    },
    () => `new-${++count}`,
  );
  const next = applyCommand(doc, command);
  expect(
    JSON.stringify(
      next.spreads[0].layers.slice(0, doc.spreads[0].layers.length),
    ),
  ).toBe(before);
  const added = next.spreads[0].layers.slice(doc.spreads[0].layers.length);
  expect(added.map((l) => l.type)).toEqual(["image", "text", "text", "text"]);
  expect(added[1].text).toBe("山水");
  expect(applyCommand(next, command).spreads[0].layers).toHaveLength(
    next.spreads[0].layers.length,
  );
});
