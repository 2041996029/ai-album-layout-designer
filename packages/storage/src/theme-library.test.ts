import { expect, it } from "vitest";
import type { AssetRecord, ResourceManifest } from "@album/assets";
import { assertManifest } from "./indexeddb-store";
function manifest(photos: number, decorations: number): ResourceManifest {
  const make = (i: number, usage?: string) =>
    ({
      id: `a_${i}`,
      version: 1,
      status: "ready",
      sha256: "a".repeat(64),
      license: { id: "private", usable: true },
      source: { name: "asset" },
      width: 1,
      height: 1,
      mimeType: "image/png",
      ...(usage ? { usage } : {}),
      variants: Object.fromEntries(
        ["original", "normalized", "preview"].map((k) => [
          k,
          {
            sha256: "a".repeat(64),
            byteLength: 1,
            width: 1,
            height: 1,
            mimeType: "image/png",
          },
        ]),
      ),
    }) as AssetRecord;
  return {
    assets: [
      ...Array.from({ length: photos }, (_, i) => make(i)),
      ...Array.from({ length: decorations }, (_, i) =>
        make(i + photos, "decoration"),
      ),
    ],
    fonts: [],
  };
}
it("allows 500 legacy photos plus 2000 template resources, but enforces each quota", () => {
  expect(() => assertManifest(manifest(500, 2000))).not.toThrow();
  expect(() => assertManifest(manifest(501, 0))).toThrow();
  expect(() => assertManifest(manifest(0, 2001))).toThrow();
});
it("validates optional usage and counts explicit photo usage against photo quota", () => {
  const m = manifest(501, 0);
  for (const a of m.assets) Object.assign(a, { usage: "photo" });
  expect(() => assertManifest(m)).toThrow();
  const bad = manifest(1, 0);
  Object.assign(bad.assets[0], { usage: "unknown" });
  expect(() => assertManifest(bad)).toThrow();
  for (const usage of ["mask", "text-raster", "decoration", "photo"]) {
    Object.assign(bad.assets[0], { usage });
    expect(() => assertManifest(bad)).not.toThrow();
  }
});
