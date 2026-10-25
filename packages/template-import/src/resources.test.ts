import { test, expect } from "vitest";
import { buildMjtpl } from "../../../tests/fixtures/mjtpl/build";
import { imageInfo, imageRecord } from "./resources";
test("sniffs PNG bytes independently from extension and MIME and preserves alpha", async () => {
  const f = await buildMjtpl(),
    source = f.manifest.assets[0],
    bytes = f.files[source.path];
  expect(imageInfo(bytes)).toEqual({
    width: 1,
    height: 1,
    mimeType: "image/png",
    alpha: true,
  });
  expect(imageRecord(source, bytes).usage).toBe("decoration");
  expect(imageRecord(source, bytes).variants.original.sha256).toBe(
    source.sha256,
  );
  expect(() => imageInfo(new Uint8Array(20))).toThrow();
});
