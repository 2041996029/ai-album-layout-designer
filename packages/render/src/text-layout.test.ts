import { describe, it, expect } from "vitest";
import type { TextLayer } from "@album/document";
import type { LoadedFont } from "@album/assets";
import { layoutText, graphemes } from "./text-layout";
const font: LoadedFont = {
  family: "test",
  faces: [],
  codePoints: new Set(
    Array.from("我们一起看世界，。！？、）》】（《【ABC é👨‍👩‍👧‍👦🙂", (c) =>
      c.codePointAt(0)!,
    ),
  ),
  dispose() {},
};
const layer = (text: string, extra: Partial<TextLayer> = {}): TextLayer => ({
  id: "text",
  type: "text",
  x: 0,
  y: 0,
  width: 40,
  height: 300,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  text,
  fontAssetId: "test",
  fontSize: 10,
  fontWeight: 400,
  lineHeight: 1.4,
  letterSpacing: 0,
  fill: "#000",
  ...extra,
});
const measure = (s: string, _f: LoadedFont, size: number, spacing: number) =>
  graphemes(s).length * size + Math.max(0, graphemes(s).length - 1) * spacing;
describe("shared grapheme and Chinese line layout", () => {
  it("wraps continuous CJK and mixed text without losing characters", () => {
    for (const text of ["我们一起看世界", "我们ABC一起"]) {
      const r = layoutText(layer(text), font, measure);
      expect(r.lines.join("")).toBe(text);
      expect(r.lines.every((l) => measure(l, font, 10, 0) <= 40)).toBe(true);
      expect(r.overflow).toBe(false);
    }
  });
  it("preserves explicit CRLF, blank lines and grapheme clusters", () => {
    const text = "Aé🙂👨‍👩‍👧‍👦";
    const r = layoutText(layer(text + "\r\n\nB", { width: 10 }), font, measure);
    expect(r.lines).toEqual(["A", "é", "🙂", "👨‍👩‍👧‍👦", "", "B"]);
  });
  it("keeps closing marks off starts and opening marks off ends", () => {
    const text = "我们（一起）看世界，。！？、ABC《世界》【我们】";
    const r = layoutText(layer(text), font, measure);
    expect(r.lines.join("")).toBe(text);
    expect(
      r.lines.every(
        (s) => !/^[，。！？、）》】]/u.test(s) && !/[（《【]$/u.test(s),
      ),
    ).toBe(true);
    expect(r.overflow).toBe(true);
  });
  it("reports impossible punctuation and too wide single graphemes", () => {
    expect(
      layoutText(layer("（我）", { width: 10 }), font, measure).overflow,
    ).toBe(true);
    expect(layoutText(layer("我", { width: 5 }), font, measure).overflow).toBe(
      true,
    );
  });
  it("uses lineHeight as a multiplier and includes every logical line box", () => {
    const r = layoutText(
      layer("我\n我\n我", {
        fontSize: 40,
        lineHeight: 1.4,
        height: 100,
        width: 100,
      }),
      font,
      measure,
    );
    expect(r.overflow).toBe(true);
    expect(r.logicalBounds.height).toBeCloseTo(168);
  });
  it("reports unsupported scalar values once and applies letter spacing", () => {
    expect(
      layoutText(layer("🦄🦄"), font, measure).unsupportedCodePoints,
    ).toEqual([0x1f984]);
    expect(
      layoutText(layer("ABC", { width: 25, letterSpacing: 2 }), font, measure)
        .lines,
    ).toEqual(["AB", "C"]);
  });
});

it("justifies wrapped lines using the same grapheme spacing as scene rendering", () => {
  const r = layoutText(
    layer("我们一起看世界", { width: 35, textAlign: "justify" }),
    font,
    measure,
  );
  expect(r.lines).toEqual(["我们一", "起看世", "界"]);
  expect(r.lineLetterSpacing).toEqual([2.5, 2.5, 0]);
  expect(r.lineBoxes.map((b) => b.width)).toEqual([35, 35, 10]);
});
it("includes actual measured overhang and descenders in overflow", () => {
  const precise = Object.assign(measure, {
    ink: () => ({ left: 2, right: 42, ascent: 11, descent: 4 }),
  });
  const r = layoutText(layer("ABC", { width: 40, height: 14 }), font, precise);
  expect(r.overflow).toBe(true);
  expect(r.inkBounds).toEqual({ x: -2, y: -1, width: 44, height: 15 });
});

it("keeps oversized legal punctuation units uncompressed on justified wrapped lines", () => {
  for (const letterSpacing of [0, 2]) {
    const r = layoutText(
      layer("（我）我", {
        width: 30,
        fontSize: 20,
        textAlign: "justify",
        letterSpacing,
      }),
      font,
      (...args) => measure(...args),
    );
    expect(r.lines).toEqual(["（我）", "我"]);
    expect(r.lineLetterSpacing).toEqual([letterSpacing, letterSpacing]);
    expect(r.lineBoxes[0].width).toBe(60 + 2 * letterSpacing);
    expect(r.overflow).toBe(true);
  }
});

it("keeps a fitting overhanging glyph inside its box instead of falsely blocking export", () => {
  const precise = Object.assign(
    (...args: Parameters<typeof measure>) => measure(...args),
    { ink: () => ({ left: 1, right: 29, ascent: 9, descent: 1 }) },
  );
  const r = layoutText(layer("ABC", { width: 80, height: 20 }), font, precise);
  expect(r.overflow).toBe(false);
  expect(r.inkBounds.x).toBeGreaterThanOrEqual(0);
});
