import type { Rect, TextLayer } from "@album/document";
import { unsupportedGlyphs, type LoadedFont } from "@album/assets";
export interface TextInk {
  left: number;
  right: number;
  ascent: number;
  descent: number;
}
export type TextMeasure = ((
  text: string,
  font: LoadedFont,
  fontSize: number,
  letterSpacing: number,
) => number) & {
  ink?: (
    text: string,
    font: LoadedFont,
    fontSize: number,
    letterSpacing: number,
  ) => TextInk;
};
export interface TextMetricsReport {
  layerId: string;
  lines: string[];
  overflow: boolean;
  unsupportedCodePoints: number[];
  /** All bounds are local px96, before layer/group transforms. */
  logicalBounds: Rect;
  inkBounds: Rect;
  lineBoxes: Rect[];
  lineInkBounds: Rect[];
  baselines: number[];
  lineLetterSpacing: number[];
}
const segmenter = new Intl.Segmenter("zh", { granularity: "grapheme" });
export const graphemes = (text: string): string[] =>
  Array.from(segmenter.segment(text), (s) => s.segment);
const closing = /^[，。！？、）》】]/u,
  opening = /[（《【]$/u;
const union = (boxes: Rect[]): Rect => {
  if (!boxes.length) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...boxes.map((b) => b.x)),
    y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
};
export function layoutText(
  layer: TextLayer,
  font: LoadedFont,
  measure: TextMeasure,
): TextMetricsReport {
  const lines: string[] = [],
    paragraphFinal: boolean[] = [];
  let invalidBreak = false;
  // Keep impossible legal units visible to preflight independently of justified bounds.
  let oversizedFit = false;
  const step = layer.fontSize * layer.lineHeight;
  for (const paragraph of layer.text.replace(/\r\n?/g, "\n").split("\n")) {
    const chars = graphemes(paragraph);
    if (!chars.length) {
      lines.push("");
      paragraphFinal.push(true);
      continue;
    }
    let start = 0;
    while (start < chars.length) {
      let end = start;
      while (
        end < chars.length &&
        measure(
          chars.slice(start, end + 1).join(""),
          font,
          layer.fontSize,
          layer.letterSpacing,
        ) <=
          layer.width + 1e-7
      )
        end++;
      const legal = (index: number) =>
        !opening.test(chars[index - 1]) &&
        (index === chars.length || !closing.test(chars[index]));
      let split = end;
      while (split > start && !legal(split)) split--;
      if (split === start) {
        split = Math.max(start + 1, end);
        while (split < chars.length && !legal(split)) split++;
      }
      const line = chars.slice(start, split).join("");
      if (closing.test(line) || opening.test(line)) invalidBreak = true;
      if (
        measure(line, font, layer.fontSize, layer.letterSpacing) >
        layer.width + 1e-7
      )
        oversizedFit = true;
      lines.push(line);
      paragraphFinal.push(split === chars.length);
      start = split;
    }
  }
  const lineBoxes: Rect[] = [],
    lineInkBounds: Rect[] = [],
    baselines: number[] = [],
    lineLetterSpacing: number[] = [];
  for (const [index, line] of lines.entries()) {
    const count = graphemes(line).length;
    // Justification may expand gaps; it must never squeeze an oversized legal unit.
    const spacing =
      layer.textAlign === "justify" && !paragraphFinal[index] && count > 1
        ? Math.max(
            layer.letterSpacing,
            (layer.width -
              graphemes(line).reduce(
                (sum, g) => sum + measure(g, font, layer.fontSize, 0),
                0,
              )) /
              (count - 1),
          )
        : layer.letterSpacing;
    lineLetterSpacing.push(spacing);
    const width = measure(line, font, layer.fontSize, spacing);
    let x =
      layer.textAlign === "center"
        ? (layer.width - width) / 2
        : layer.textAlign === "right"
          ? layer.width - width
          : 0;
    const y = index * step,
      baseline = y + layer.fontSize;
    baselines.push(baseline);
    const ink = measure.ink?.(line, font, layer.fontSize, spacing) ?? {
      left: 0,
      right: width,
      ascent: line ? layer.fontSize : 0,
      descent: 0,
    };
    if (
      ink.left + ink.right <= layer.width + 1e-7 &&
      width <= layer.width + 1e-7
    ) {
      const minX = Math.max(0, ink.left),
        maxX = Math.min(layer.width - width, layer.width - ink.right);
      if (minX <= maxX) x = Math.max(minX, Math.min(maxX, x));
    }
    lineBoxes.push({ x, y, width, height: step });
    lineInkBounds.push({
      x: x - ink.left,
      y: baseline - ink.ascent,
      width: ink.left + ink.right,
      height: ink.ascent + ink.descent,
    });
  }
  const outside = (b: Rect) =>
    b.x < -1e-5 ||
    b.y < -1e-5 ||
    b.x + b.width > layer.width + 1e-5 ||
    b.y + b.height > layer.height + 1e-5;
  return {
    layerId: layer.id,
    lines,
    overflow:
      oversizedFit ||
      invalidBreak ||
      [...lineBoxes, ...lineInkBounds].some(outside),
    unsupportedCodePoints: unsupportedGlyphs(layer.text, font),
    logicalBounds: union(lineBoxes),
    inkBounds: union(lineInkBounds),
    lineBoxes,
    lineInkBounds,
    baselines,
    lineLetterSpacing,
  };
}
/** Native whole-line shaping when spacing is zero; otherwise identical grapheme advances in measurement and drawing. */
export function createTextMeasure(
  ctx: CanvasRenderingContext2D,
  weight: 400 | 700,
): TextMeasure {
  const setup = (font: LoadedFont, size: number) => {
    ctx.font = `${weight} ${size}px "${font.family}"`;
    ctx.textBaseline = "alphabetic";
    ctx.textAlign = "left";
    ctx.fontKerning = "normal";
  };
  const measure: TextMeasure = (text, font, size, spacing) => {
    setup(font, size);
    return spacing === 0
      ? ctx.measureText(text).width
      : graphemes(text).reduce((sum, g) => sum + ctx.measureText(g).width, 0) +
          Math.max(0, graphemes(text).length - 1) * spacing;
  };
  measure.ink = (text, font, size, spacing) => {
    setup(font, size);
    if (!text) return { left: 0, right: 0, ascent: 0, descent: 0 };
    if (spacing === 0) {
      const m = ctx.measureText(text);
      return {
        left: m.actualBoundingBoxLeft,
        right: m.actualBoundingBoxRight,
        ascent: m.actualBoundingBoxAscent,
        descent: m.actualBoundingBoxDescent,
      };
    }
    let offset = 0,
      left = Infinity,
      right = -Infinity,
      ascent = 0,
      descent = 0;
    for (const g of graphemes(text)) {
      const m = ctx.measureText(g);
      left = Math.min(left, offset - m.actualBoundingBoxLeft);
      right = Math.max(right, offset + m.actualBoundingBoxRight);
      ascent = Math.max(ascent, m.actualBoundingBoxAscent);
      descent = Math.max(descent, m.actualBoundingBoxDescent);
      offset += m.width + spacing;
    }
    return { left: -left, right, ascent, descent };
  };
  return measure;
}

/** Shrink within an existing text box using the same shaping as render/preflight. */
export function fitTextToFrame(
  layer: TextLayer,
  font: LoadedFont,
  measure: TextMeasure,
): TextLayer {
  if (!layoutText(layer, font, measure).overflow) return layer;
  const minimum = Math.min(layer.fontSize, 6);
  const candidate = (size: number) => ({
    ...layer,
    fontSize: size,
    letterSpacing: (layer.letterSpacing * size) / layer.fontSize,
  });
  if (layoutText(candidate(minimum), font, measure).overflow)
    throw Error(
      `「${layer.text.slice(0, 24)}」的文字框太小，请扩大文字框后重试。`,
    );
  let low = minimum,
    high = layer.fontSize;
  for (let i = 0; i < 14; i++) {
    const mid = (low + high) / 2;
    if (layoutText(candidate(mid), font, measure).overflow) high = mid;
    else low = mid;
  }
  return candidate(low);
}
