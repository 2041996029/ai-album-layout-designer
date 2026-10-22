import { it, expect } from "vitest";
import fixture from "../../../tests/fixtures/documents/minimal.json";
import {
  applyCommand,
  type DocumentModel,
  templateVersions,
  isImageLayer,
} from "@album/document";
import { prepareLayout } from "./prepare";
import { generateCandidates } from "./candidates";
import { createLayoutCommand, validateDocumentAssignment } from "./apply";
import { History } from "../../../apps/web/src/state/history";
import type { LayoutInput } from "./types";
async function ready() {
  const d = structuredClone(fixture) as DocumentModel,
    t = templateVersions.find((t) => t.id === "tpl_travel")!;
  const input: LayoutInput = {
    projectId: d.projectId,
    baseRevision: d.revision,
    photos: Array.from({ length: 3 }, (_, i) => ({
      assetId: `p${i}`,
      width: 1000,
      height: 800,
    })),
    constraints: {
      spreadCount: 1,
      minPhotosPerSpread: 1,
      maxPhotosPerSpread: 4,
      selectionPolicy: "all",
      duplicatePolicy: "forbid",
      orderPolicy: "user",
    },
    templateRef: { id: t.id, version: t.version, sha256: t.sha256 },
    algorithmVersion: "local-layout-v1",
    seed: 1,
  };
  const p = await prepareLayout(input);
  return { d, input, c: generateCandidates(p, d, t, [])[0] };
}
it("applies the whole book and manifest in one undoable command", async () => {
  const { d, input, c } = await ready(),
    h = new History(d);
  h.execute(createLayoutCommand(input, c, d));
  expect(validateDocumentAssignment(h.current)).toEqual([]);
  expect(h.current.assignmentManifest).toBeDefined();
  h.undo();
  expect(h.current).toEqual(d);
  h.redo();
  expect(validateDocumentAssignment(h.current)).toEqual([]);
});
it("rejects revision changes and edits made after candidate generation", async () => {
  const { d, input, c } = await ready();
  expect(() =>
    createLayoutCommand(input, c, { ...d, revision: d.revision + 1 }),
  ).toThrow("STALE");
  const edited = structuredClone(d);
  edited.spreads[0].background = "#abcdef";
  expect(() => createLayoutCommand(input, c, edited)).toThrow("STALE");
});
it("rejects replay and untrusted candidates", async () => {
  const { d, input, c } = await ready();
  const cmd = createLayoutCommand(input, c, d),
    next = applyCommand(d, cmd);
  expect(() => applyCommand(next, cmd)).toThrow("STALE");
  expect(() => createLayoutCommand(input, structuredClone(c), d)).toThrow(
    "UNTRUSTED",
  );
});
it("detects removal of a selected photo after application", async () => {
  const { d, input, c } = await ready();
  const next = applyCommand(d, createLayoutCommand(input, c, d));
  next.spreads[0].layers.splice(
    next.spreads[0].layers.findIndex(isImageLayer),
    1,
  );
  expect(validateDocumentAssignment(next)).toContain("LAYOUT_INTEGRITY_FAILED");
});
it("blocks unknown manifest versions but allows documents with no layout context", async () => {
  const { d } = await ready();
  expect(validateDocumentAssignment(d)).toEqual([]);
  d.assignmentManifest = { version: 2 };
  expect(validateDocumentAssignment(d)).toContain(
    "UNSUPPORTED_LAYOUT_MANIFEST",
  );
});
it("preserves valid layout provenance after project-package import", async () => {
  const { d, input, c } = await ready();
  const next = applyCommand(d, createLayoutCommand(input, c, d));
  const imported = {
    ...next,
    projectId: "imported",
    sourceProjectId: next.projectId,
    layoutSourceProjectId: next.projectId,
    revision: 1,
  };
  expect(validateDocumentAssignment(imported)).toEqual([]);
});
it("allows image stacking-order changes without changing photo membership", async () => {
  const { d, input, c } = await ready();
  const next = applyCommand(d, createLayoutCommand(input, c, d));
  const image = next.spreads[0].layers.find(isImageLayer)!;
  const reordered = applyCommand(next, {
    type: "reorder-layer",
    layerId: image.id,
    index: next.spreads[0].layers.length - 1,
  });
  expect(validateDocumentAssignment(reordered)).toEqual([]);
});
it("rejects a cloned and altered whole-book command at execution", async () => {
  const { d, input, c } = await ready();
  const cmd = structuredClone(createLayoutCommand(input, c, d));
  if (cmd.type !== "apply-layout") throw new Error("unexpected command");
  cmd.spreads[0].layers.splice(
    cmd.spreads[0].layers.findIndex(isImageLayer),
    1,
  );
  expect(() => applyCommand(d, cmd)).toThrow("UNVERIFIED_LAYOUT_COMMAND");
});
