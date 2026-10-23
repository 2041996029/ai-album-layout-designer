import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import {
  filterTile,
  recipes,
  filterManifest,
} from "../packages/render/src/filters/index";
const width = 240,
  height = 120,
  bytes = new Uint8ClampedArray(width * height * 4);
const swatches = [
  [248, 224, 200],
  [176, 126, 92],
  [70, 120, 70],
  [35, 95, 165],
  [230, 185, 65],
  [195, 70, 80],
  [25, 25, 25],
  [225, 225, 225],
];
for (let y = 0; y < height; y++)
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    const rgb =
      y < 60
        ? swatches[Math.floor(x / 30)]
        : [
            (x / 239) * 255,
            ((x / 239) * 0.6 + (y / 119) * 0.4) * 255,
            (1 - x / 239) * 255,
          ];
    bytes.set([...rgb, 255], i);
  }
const tile = {
  bytes,
  width,
  height,
  offsetX: 0,
  offsetY: 0,
  fullWidth: width,
  fullHeight: height,
};
const panels = [
  { id: "ORIGINAL", bytes: Array.from(bytes) },
  ...recipes.map((r) => ({
    id: r.id,
    bytes: Array.from(filterTile(tile, r, r.defaultStrength, r.seed)),
  })),
];
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH,
});
try {
  const page = await browser.newPage();
  const png = await page.evaluate(
    ({ panels, width, height }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 1548;
      canvas.height = 1020;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#f5f3ed";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#243b35";
      ctx.font = "bold 22px sans-serif";
      ctx.fillText("33 CPU FILTERS / ORIGINAL TEST CHART", 20, 30);
      ctx.font = "13px sans-serif";
      ctx.fillText(
        "cpu-srgb-v1 · strength 0.65 · seed 1729 · visual review pending",
        20,
        53,
      );
      panels.forEach((p, i) => {
        const x = 18 + (i % 6) * 255,
          y = 76 + Math.floor(i / 6) * 156;
        ctx.putImageData(
          new ImageData(new Uint8ClampedArray(p.bytes), width, height),
          x,
          y,
        );
        ctx.fillStyle = "#243b35";
        ctx.font = "14px sans-serif";
        ctx.fillText(p.id, x, y + 139);
      });
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { panels, width, height },
  );
  const dir = new URL("../docs/implementation/c1/filters/", import.meta.url);
  await mkdir(dir, { recursive: true });
  await writeFile(
    new URL("contact-sheet.png", dir),
    Buffer.from(png, "base64"),
  );
  await writeFile(
    new URL("contact-sheet.json", dir),
    JSON.stringify(
      {
        status: "visual_review_pending",
        source:
          "Original synthetic color patches and gradients; no third-party photo",
        kernelVersion: filterManifest.kernelVersion,
        sourceCsvSha256: filterManifest.sourceCsvSha256,
        browser: browser.version(),
        strength: 0.65,
        seed: 1729,
        panels: panels.map((p) => p.id),
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await browser.close();
}
