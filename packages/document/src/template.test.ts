import { it, expect } from "vitest";
import fixture from "../../../tests/fixtures/documents/minimal.json";
import {
  templateVersions,
  instantiateTemplate,
  applyTemplateCommand,
  validateTemplateBindings,
  canonicalJson,
  sha256,
  parseDocument,
  applyCommand,
} from "./index";
import { History } from "../../../apps/web/src/state/history";
it("preserves five original immutable template hashes with licensed geometry and local fonts", async () => {
  expect(templateVersions.slice(0, 5).map((t) => t.category)).toEqual([
    "wedding",
    "travel",
    "family",
    "portrait",
    "ink",
  ]);
  for (const template of templateVersions) {
    const { sha256: hash, ...payload } = template;
    expect(await sha256(canonicalJson(payload))).toBe(hash);
    expect(template.licenseRef).toBe("LicenseRef-Project-Original-Templates");
    expect(Object.isFrozen(template.slots[0])).toBe(true);
  }
});
it("rejects insufficient photos, extra slots, unregistered assets, and duplicate IDs without silently dropping photos", () => {
  const t = templateVersions[0];
  expect(() =>
    instantiateTemplate(t, { photo_1: "a" }, () => crypto.randomUUID()),
  ).toThrow("TEMPLATE_BINDING_REQUIRED");
  expect(() =>
    instantiateTemplate(t, { photo_1: "a", photo_2: "b", unused: "c" }, () =>
      crypto.randomUUID(),
    ),
  ).toThrow("UNKNOWN_TEMPLATE_BINDING");
  expect(() =>
    validateTemplateBindings(
      t,
      { photo_1: "a", photo_2: "b" },
      { assetIds: ["a"], fontIds: ["noto-sans-sc"] },
    ),
  ).toThrow("ASSET_MISSING");
  expect(() =>
    instantiateTemplate(t, { photo_1: "a", photo_2: "b" }, () => "same"),
  ).toThrow("DUPLICATE_LAYER_ID");
});
it("applies only to its target spread and restores layers and template reference in one undo", () => {
  const doc = parseDocument({
    ...fixture,
    spreads: [
      fixture.spreads[0],
      {
        ...structuredClone(fixture.spreads[0]),
        id: "untouched",
        extension: 42,
      },
    ],
  });
  const before = structuredClone(doc),
    history = new History(doc),
    t = templateVersions[0];
  let n = 0;
  const layers = instantiateTemplate(
    t,
    { photo_1: "asset_a", photo_2: "asset_b" },
    () => `tpl_${++n}`,
  );
  const next = history.execute(
    applyTemplateCommand("spread_1", layers, {
      id: t.id,
      version: t.version,
      sha256: t.sha256,
    }),
  );
  expect(next.spreads[1]).toEqual(before.spreads[1]);
  expect(next.spreads[0].layers).toHaveLength(4);
  expect(new Set(layers.map((l) => l.id)).size).toBe(4);
  expect(history.undo()).toEqual(before);
});
it("rejects a modified registered template rather than preserving a stale signature", () => {
  const t = structuredClone(templateVersions[0]);
  t.slots[0].frame.x = 999;
  expect(() =>
    instantiateTemplate(t, { photo_1: "a", photo_2: "b" }, () =>
      crypto.randomUUID(),
    ),
  ).toThrow("TEMPLATE_UNAVAILABLE");
});
