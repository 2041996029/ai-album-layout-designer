import { expect, it } from "vitest";
import {
  templateVersions,
  instantiateTemplate,
  applyTemplateCommand,
} from "./template";
import { canonicalJson, sha256 } from "./canonical";
import { parseDocument } from "./validate";
import { History } from "../../../apps/web/src/state/history";
import fixture from "../../../tests/fixtures/documents/acceptance.json";

it("registers 96 original signed spreads with eight varied page roles per collection", async () => {
  const themes = templateVersions.filter((t) => t.id.startsWith("theme_"));
  expect(themes).toHaveLength(96);
  const categories = [...new Set(themes.map((t) => t.category))];
  expect(categories).toHaveLength(12);
  expect(
    new Set(
      themes.map((t) =>
        canonicalJson(
          t.slots.filter((s) => s.kind === "image").map((s) => s.frame),
        ),
      ),
    ).size,
  ).toBe(96);
  for (const category of categories) {
    const collection = themes.filter((t) => t.category === category);
    expect(collection.map((t) => t.pageOrder)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8,
    ]);
    expect(
      collection.map((t) => t.slots.filter((s) => s.kind === "image").length),
    ).toEqual([1, 2, 2, 3, 3, 4, 4, 1]);
    expect(
      new Set(
        collection.map((t) =>
          canonicalJson(
            t.slots.filter((s) => s.kind === "image").map((s) => s.frame),
          ),
        ),
      ).size,
    ).toBe(8);
  }
  for (const t of themes) {
    const { sha256: hash, ...payload } = t;
    expect(await sha256(canonicalJson(payload))).toBe(hash);
    expect(t.themeId).toBe(t.category);
    expect(t.slots.some((s) => s.kind === "shape")).toBe(true);
    expect(
      t.slots.filter((s) => s.kind === "text").length,
    ).toBeGreaterThanOrEqual(3);
    for (const slot of t.slots) {
      expect(slot.frame.x).toBeGreaterThanOrEqual(0);
      expect(slot.frame.y).toBeGreaterThanOrEqual(0);
      expect(slot.frame.x + slot.frame.width).toBeLessThanOrEqual(
        t.pageSize.width * 2 + 0.001,
      );
      expect(slot.frame.y + slot.frame.height).toBeLessThanOrEqual(
        t.pageSize.height + 0.001,
      );
      if (slot.kind === "image") {
        const right = slot.frame.x + slot.frame.width;
        expect(
          right <= t.pageSize.width * 0.96 ||
            slot.frame.x >= t.pageSize.width * 1.04,
        ).toBe(true);
      }
    }
    const bindings = Object.fromEntries(
      t.slots
        .filter((s) => s.kind === "image")
        .map((s) => [s.slotId, "asset_a"]),
    );
    let n = 0;
    const layers = instantiateTemplate(t, bindings, () => `theme_${++n}`);
    expect(layers.filter((l) => l.type === "shape").length).toBeGreaterThan(0);
    expect(layers.every((l) => l.locked === false)).toBe(true);
    const doc = parseDocument(fixture),
      history = new History(doc);
    parseDocument(
      history.execute(
        applyTemplateCommand(
          doc.spreads[0].id,
          layers,
          { id: t.id, version: t.version, sha256: t.sha256 },
          t.background,
        ),
      ),
    );
    expect(history.undo()).toEqual(doc);
  }
});
