import { describe, it, expect } from "vitest";
import fixture from "../../../tests/fixtures/documents/minimal.json";
import {
  parseDocument,
  validateDocument,
  canonicalDocument,
  hashDocument,
  DocumentValidationError,
} from "./index";

const fresh = (): any => structuredClone(fixture);
const shape = (id = "layer_1"): any => ({
  id,
  type: "shape",
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1,
  visible: true,
  locked: false,
  shapeKind: "rectangle",
  fill: "#ffffff",
  stroke: "#000000",
  strokeWidth: 0,
});
const rejects = (doc: unknown, code: string) => {
  try {
    parseDocument(doc);
    throw new Error("accepted invalid input");
  } catch (e) {
    expect(e).toBeInstanceOf(DocumentValidationError);
    expect((e as any).issues.map((i: any) => i.code)).toContain(code);
  }
};
describe("document v1 boundary", () => {
  it("round trips same-version unknown layers and extension fields without mutating input", () => {
    const doc = fresh();
    doc.spreads[0].layers.push({
      id: "future_1",
      type: "futureShader",
      shader: { value: 7 },
    });
    doc.advancedBlend = { mode: "multiply" };
    const before = structuredClone(doc);
    const result = parseDocument(doc);
    expect(JSON.parse(canonicalDocument(result))).toEqual(before);
    expect(validateDocument(result)).toContainEqual(
      expect.objectContaining({
        code: "UNSUPPORTED_LAYER",
        severity: "blocker",
      }),
    );
    expect(doc).toEqual(before);
  });
  it("hashes object keys canonically while preserving array order", async () => {
    const a = fresh();
    a.spreads[0].layers = [shape("a"), shape("b")];
    const b: any = Object.fromEntries(
      Object.entries(structuredClone(a)).reverse(),
    );
    expect(await hashDocument(parseDocument(a))).toBe(
      await hashDocument(parseDocument(b)),
    );
    b.spreads[0].layers.reverse();
    expect(await hashDocument(parseDocument(a))).not.toBe(
      await hashDocument(parseDocument(b)),
    );
  });
  it("sorts integer-like and supplementary Unicode object keys by code point", () => {
    const d = fresh();
    d.extra = { "2": 2, "10": 10, "𐀀": 1, "\ue000": 2 };
    const text = canonicalDocument(parseDocument(d));
    expect(text.indexOf('"10"')).toBeLessThan(text.indexOf('"2"'));
    expect(text.indexOf('"\ue000"')).toBeLessThan(text.indexOf('"𐀀"'));
  });
  it("rounds geometry to six decimal places but preserves extension numbers", () => {
    const doc = fresh();
    doc.spreads[0].layers = [
      { ...shape(), x: 1.123456789, extension: { value: 1.123456789 } },
    ];
    const saved = JSON.parse(canonicalDocument(parseDocument(doc)));
    expect(saved.spreads[0].layers[0].x).toBe(1.123457);
    expect(saved.spreads[0].layers[0].extension.value).toBe(1.123456789);
  });
  it.each([
    [
      { x: 0.0000005, y: 0.0000005, width: 0.9999995, height: 0.9999995 },
      { x: 0.000001, y: 0.000001, width: 0.999999, height: 0.999999 },
    ],
    [
      { x: 0.0000015, y: 0.9999985, width: 0.9999985, height: 0.0000015 },
      { x: 0.000002, y: 0.999999, width: 0.999998, height: 0.000001 },
    ],
    [
      { x: 0.00000049, y: 0.00000051, width: 0.99999951, height: 0.99999949 },
      { x: 0, y: 0.000001, width: 1, height: 0.999999 },
    ],
    [
      { x: 0.999999, y: 0.999999, width: 0.000001, height: 0.000001 },
      { x: 0.999999, y: 0.999999, width: 0.000001, height: 0.000001 },
    ],
  ])(
    "round trips normalized edge crops at six-decimal boundaries: %j",
    (crop, expected) => {
      const doc = fresh();
      doc.spreads[0].layers = [
        { ...shape(), type: "image", assetId: "asset_1", crop },
      ];
      const parsed = parseDocument(doc);
      const canonical = canonicalDocument(parsed);
      const saved = JSON.parse(canonical);
      expect(validateDocument(saved)).toEqual([]);
      expect(saved.spreads[0].layers[0].crop).toEqual(expected);
      expect(parseDocument(saved)).toEqual(saved);
      expect(canonicalDocument(parseDocument(saved))).toBe(canonical);
      expect(parsed.spreads[0].layers[0].crop).toEqual(crop);
    },
  );
  it.each(["foo", "01", "-1", "1.0", "4294967295"])(
    "rejects sparse arrays balanced by the extra key %s",
    (key) => {
      const doc = fresh();
      const array: any[] = new Array(2);
      array[1] = "retained";
      Object.defineProperty(array, key, {
        value: "must not disappear",
        enumerable: true,
      });
      doc.extra = array;
      rejects(doc, "NON_JSON_VALUE");
    },
  );
  it.each([NaN, Infinity, -Infinity])(
    "rejects non-finite JSON number %s before cloning",
    (value) => {
      const d = fresh();
      d.extra = value;
      rejects(d, "NON_JSON_VALUE");
    },
  );
  it.each([0, -1])("rejects non-positive layer width %s", (width) => {
    const d = fresh();
    d.spreads[0].layers = [{ ...shape(), width }];
    rejects(d, "INVALID_DOCUMENT");
  });
  it("rejects a duplicate layer ID across cover and spreads", () => {
    const d = fresh();
    d.cover.front = [shape()];
    d.spreads[0].layers = [shape()];
    rejects(d, "DUPLICATE_ID");
  });
  it("rejects duplicate spread IDs", () => {
    const d = fresh();
    d.spreads.push(structuredClone(d.spreads[0]));
    rejects(d, "DUPLICATE_ID");
  });
  it("allows five group levels and rejects six", () => {
    const d = fresh();
    let layer = shape();
    for (let i = 5; i >= 1; i--)
      layer = { ...shape("group_" + i), type: "group", children: [layer] };
    d.spreads[0].layers = [layer];
    expect(() => parseDocument(d)).not.toThrow();
    d.spreads[0].layers = [
      { ...shape("group_0"), type: "group", children: [layer] },
    ];
    rejects(d, "GROUP_DEPTH");
  });
  it("rejects circular objects", () => {
    const d = fresh();
    d.cycle = d;
    rejects(d, "NON_JSON_VALUE");
  });
  it("rejects future schema explicitly", () =>
    rejects({ ...fresh(), schemaVersion: 99 }, "UNSUPPORTED_SCHEMA"));
  it("rejects unsafe object keys and exotic objects", () => {
    const d = fresh();
    d.extra = JSON.parse('{"__proto__":{"polluted":true}}');
    rejects(d, "UNSAFE_KEY");
    d.extra = new Date();
    rejects(d, "NON_JSON_VALUE");
  });
  it("rejects image crop overflow", () => {
    const d = fresh();
    d.spreads[0].layers = [
      {
        ...shape(),
        type: "image",
        assetId: "asset_1",
        crop: { x: 0.8, y: 0, width: 0.3, height: 1 },
      },
    ];
    rejects(d, "INVALID_CROP");
  });
  it("counts recursive layers against the 100-layer limit", () => {
    const d = fresh();
    d.spreads[0].layers = [
      {
        ...shape("g"),
        type: "group",
        children: Array.from({ length: 100 }, (_, i) => shape("s" + i)),
      },
    ];
    rejects(d, "LAYER_LIMIT");
  });
  it("does not treat malformed known layer types as opaque", () => {
    const d = fresh();
    d.spreads[0].layers = [{ id: "bad", type: "text" }];
    rejects(d, "INVALID_DOCUMENT");
  });
});
