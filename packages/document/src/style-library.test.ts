import { isKnownLayer } from "./model";
import { expect, it } from "vitest";
import {
  templateVersions,
  instantiateTemplate,
  applyTemplateCommand,
} from "./template";
import { canonicalJson, sha256 } from "./canonical";
import { History } from "../../../apps/web/src/state/history";
import { parseDocument } from "./validate";
import fixture from "../../../tests/fixtures/documents/acceptance.json";
const categories = [
  "japanese",
  "jk",
  "qipao",
  "chinese",
  "wedding",
  "couple",
  "family",
  "travel",
  "korean",
  "hongkong",
  "french",
  "monochrome",
];
it("offers two, three and four-photo editable spreads for each common photo style", async () => {
  for (const category of categories) {
    const styles = templateVersions.filter(
      (t) => t.category === category && t.id.startsWith("style_"),
    );
    expect(styles).toHaveLength(3);
    expect(
      styles
        .map((t) => t.slots.filter((s) => s.kind === "image").length)
        .sort(),
    ).toEqual([2, 3, 4]);
    for (const t of styles) {
      const { sha256: hash, ...payload } = t;
      expect(await sha256(canonicalJson(payload))).toBe(hash);
      let n = 0;
      const bindings = Object.fromEntries(
        t.slots
          .filter((s) => s.kind === "image")
          .map((s) => [s.slotId, "asset_a"]),
      );
      const layers = instantiateTemplate(t, bindings, () => `new_${++n}`);
      for (const l of layers.filter(isKnownLayer)) {
        expect(l.x).toBeGreaterThanOrEqual(0);
        expect(l.y).toBeGreaterThanOrEqual(0);
        expect(l.x + l.width).toBeLessThanOrEqual(t.pageSize.width * 2);
        expect(l.y + l.height).toBeLessThanOrEqual(t.pageSize.height);
      }
      expect(
        layers
          .filter((l) => l.type === "text")
          .every((l) => l.fill && l.fontSize),
      ).toBe(true);
    }
  }
});
it("applies style background and typography as one undoable edit", () => {
  const t = templateVersions.find((t) => t.id === "style_hongkong_2")!;
  expect(t).toBeDefined();
  let n = 0;
  const layers = instantiateTemplate(
    t,
    { photo_1: "asset_a", photo_2: "asset_b" },
    () => `style_${++n}`,
  );
  expect(layers.find((l) => l.type === "text")).toMatchObject({
    fill: "#eedbc0",
    letterSpacing: 5,
  });
  const d = parseDocument(fixture),
    h = new History(d);
  const after = h.execute(
    applyTemplateCommand(
      d.spreads[0].id,
      layers,
      { id: t.id, version: t.version, sha256: t.sha256 },
      t.background,
    ),
  );
  expect(after.spreads[0].background).toBe(t.background);
  expect(h.undo()).toEqual(d);
});
