import { test, expect } from "vitest";
import { buildMjtpl } from "../../../tests/fixtures/mjtpl/build";
import { parseMjtpl, convertMjtpl, argb } from "./index";
test("maps cm, ARGB, transforms, independent slots and alpha resources", async () => {
  const { bytes } = await buildMjtpl(),
    signal = new AbortController().signal,
    result = await convertMjtpl(await parseMjtpl(bytes, signal), signal),
    page = result.theme.pages[0],
    layer = page.layers[0];
  expect(page.width).toBeCloseTo(2305.511811, 6);
  expect(page.height).toBeCloseTo(1152.755906, 6);
  expect(layer.rotation).toBe(15);
  expect(layer.opacity).toBe(0.5);
  expect(layer.layoutPhotoRole).toBe("decoration");
  expect(page.photoSlots).toHaveLength(1);
  expect(layer.alphaMask).toBeDefined();
  expect(result.theme.issues).toEqual([]);
  expect(result.files.has(`${layer.assetId}:original`)).toBe(true);
  expect(argb("#80402010")).toEqual({ color: "#402010", opacity: 128 / 255 });
});
test("unsupported text remains an explicit raster and affine transforms block", async () => {
  const f = await buildMjtpl(),
    signal = new AbortController().signal,
    parsed = await parseMjtpl(f.bytes, signal);
  parsed.scenes[0].nodes[0].type = "text";
  parsed.scenes[0].nodes[0].text = "你好";
  parsed.scenes[0].nodes[0].transform.scaleX = 2;
  const result = await convertMjtpl(parsed, signal);
  expect(result.theme.pages[0].layers).toHaveLength(1);
  expect(result.theme.issues.map((x) => x.code)).toContain(
    "TEXT_APPEARANCE_PRESERVED",
  );
  expect(result.theme.issues.some((x) => x.severity === "blocker")).toBe(true);
});
import { readFile } from "node:fs/promises";
import { sha256 } from "@album/document";
test("retains only an actual embedded 400 face with glyph coverage, and rejects 500 text weight", async () => {
  const fixture = await buildMjtpl(),
    signal = new AbortController().signal,
    parsed = await parseMjtpl(fixture.bytes, signal),
    fontBytes = new Uint8Array(
      await readFile(
        "node_modules/@fontsource/noto-sans-sc/files/noto-sans-sc-latin-400-normal.woff",
      ),
    ),
    hash = await sha256(fontBytes),
    source = {
      assetKey: "font",
      kind: "font",
      path: "fonts/source.woff",
      sha256: hash,
      sizeBytes: fontBytes.length,
    };
  parsed.manifest.assets.push(source);
  (parsed.files as Map<string, Uint8Array>).set(source.path, fontBytes);
  const node = parsed.scenes[0].nodes[0];
  node.type = "text";
  node.text = "Hello";
  node.textStyle = {
    fontContentHash: hash,
    fontWeight: 400,
    fontSize: 20,
    color: "#80402010",
  };
  let result = await convertMjtpl(parsed, signal);
  expect(result.theme.pages[0].layers[0].type).toBe("text");
  expect(result.theme.pages[0].layers[0].opacity).toBeCloseTo(
    (0.5 * 128) / 255,
  );
  expect(result.theme.resources.fonts).toHaveLength(1);
  expect(
    result.files.has(`${result.theme.resources.fonts[0].faces[0].id}:font`),
  ).toBe(true);
  node.transform.width = 0.005;
  result = await convertMjtpl(parsed, signal);
  expect(result.theme.pages[0].layers[0].type).toBe("image");
  expect(
    result.theme.issues.some((i) => i.code === "TEXT_LAYOUT_PRESERVED"),
  ).toBe(true);
  node.transform.width = 1;
  node.textStyle.fontWeight = 500;
  result = await convertMjtpl(parsed, signal);
  expect(result.theme.resources.fonts).toHaveLength(0);
  expect(result.theme.pages[0].layers[0].type).toBe("image");
  expect(
    result.theme.issues.some((i) => i.code === "TEXT_APPEARANCE_PRESERVED"),
  ).toBe(true);
  node.assetRef = undefined;
  result = await convertMjtpl(parsed, signal);
  expect(
    result.theme.issues.some(
      (i) => i.code === "TEXT_NO_RASTER" && i.severity === "blocker",
    ),
  ).toBe(true);
});
