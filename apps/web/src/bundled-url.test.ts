import { it, expect } from "vitest";
import { bundledAssetUrl } from "./bundled-url";
it("keeps font manifests and faces under a project subdirectory while supporting root development", () => {
  expect(
    bundledAssetUrl(
      "/fonts/manifest.json",
      "./",
      "https://example.github.io/album/",
    ),
  ).toBe("https://example.github.io/album/fonts/manifest.json");
  expect(
    bundledAssetUrl(
      "/fonts/f.woff2",
      "./",
      "https://example.github.io/album/index.html",
    ),
  ).toBe("https://example.github.io/album/fonts/f.woff2");
  expect(
    bundledAssetUrl(
      "/fonts/f.woff2",
      "/",
      "http://localhost:4175/apps/web/index.html",
    ),
  ).toBe("http://localhost:4175/fonts/f.woff2");
});
