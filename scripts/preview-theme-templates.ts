/** Contact-sheet audit using actual template slots; placeholders contain no photographs. */
import { chromium } from "@playwright/test";
import themes from "../packages/document/templates/themes-v1.json";
const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const W = themes[0].pageSize.width;
const svg = (t: (typeof themes)[number]) =>
  `<svg viewBox="0 0 ${W * 2} ${W}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="${t.background}"/>${t.slots
    .map((s: any) => {
      const { x, y, width: w, height: h } = s.frame;
      if (s.kind === "image")
        return `<g><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#b6b9b3"/><path d="M${x} ${y + h} L${x + w * 0.46} ${y + h * 0.38} L${x + w} ${y + h}Z" fill="#8f9c95"/><circle cx="${x + w * 0.72}" cy="${y + h * 0.24}" r="${Math.min(w, h) * 0.13}" fill="#e0d7bc"/><text x="${x + w / 2}" y="${y + h * 0.58}" text-anchor="middle" font-size="23" fill="#263b35">示意 ${escape(s.slotId)}</text></g>`;
      if (s.kind === "shape") {
        const a = `fill="${s.fill}" stroke="${s.stroke ?? "transparent"}" stroke-width="${s.strokeWidth ?? 0}"`;
        return s.shapeKind === "ellipse"
          ? `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${a}/>`
          : `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${s.radius ?? 0}" ${a}/>`;
      }
      const anchor =
        s.textAlign === "right"
          ? "end"
          : s.textAlign === "center"
            ? "middle"
            : "start";
      const tx =
        s.textAlign === "right"
          ? x + w
          : s.textAlign === "center"
            ? x + w / 2
            : x;
      return `<text x="${tx}" y="${y + s.fontSize}" font-family="${s.fontAssetId === "noto-serif-sc" ? "serif" : "sans-serif"}" font-size="${s.fontSize}" letter-spacing="${s.letterSpacing ?? 0}" fill="${s.fill}" text-anchor="${anchor}">${s.defaultText
        .split("\n")
        .map(
          (line: string, i: number) =>
            `<tspan x="${tx}" dy="${i ? s.fontSize * 1.3 : 0}">${escape(line)}</tspan>`,
        )
        .join("")}</text>`;
    })
    .join(
      "",
    )}<path d="M${W} 0V${W}" stroke="#777" stroke-opacity=".18" stroke-width="2"/></svg>`;
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.CHROMIUM_PATH ?? "/usr/bin/chromium",
  args: ["--no-sandbox"],
});
const page = await browser.newPage({
  viewport: { width: 2320, height: 1000 },
  deviceScaleFactor: 1,
});
const groups = [...new Set(themes.map((t) => t.category))];
const html = `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:30px;background:#e8e7e3;font-family:Arial,sans-serif}h1{margin:0 0 8px;font-size:30px}p{margin:0 0 20px;font-size:16px}section{margin:0 0 22px}h2{font-size:21px;margin:0 0 9px}.row{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.card{background:white;border:1px solid #cbc9c2;padding:9px}.label{font-size:14px;margin-bottom:6px}.card svg{display:block;width:100%;height:auto}</style><h1>96 原创相册跨页 · 12 套主题</h1><p>每套 8 页：开篇 · 双图 ×2 · 三图 ×2 · 四图 ×2 · 结尾。所有照片区域均为几何示意，无用户照片。</p>${groups
  .map(
    (g) =>
      `<section><h2>${escape(themes.find((t) => t.category === g)!.collectionName)}</h2><div class="row">${themes
        .filter((t) => t.category === g)
        .map(
          (t) =>
            `<div class="card"><div class="label">${t.pageOrder} / ${escape(t.pageRole)} · ${t.slots.filter((s) => s.kind === "image").length} 图</div>${svg(t)}</div>`,
        )
        .join("")}</div></section>`,
  )
  .join("")}`;
await page.setContent(html);
await page.screenshot({
  path: "/workspace/original-96-overview.png",
  fullPage: true,
});
const detail = themes.filter((t) => t.category === "qipao");
await page.setContent(
  `<style>body{margin:0;padding:24px;background:#e8e7e3;font-family:serif}.grid{display:grid;grid-template-columns:repeat(2,1fr);gap:22px}.card{background:white;padding:14px}svg{width:100%;display:block}h2{margin:0 0 8px;font-size:23px}</style><h1>旗袍 · 海棠旧梦 / 8 页细节（照片均为示意）</h1><div class="grid">${detail.map((t) => `<div class="card"><h2>${escape(t.name)}</h2>${svg(t)}</div>`).join("")}</div>`,
);
await page.screenshot({
  path: "/workspace/original-qipao-8.png",
  fullPage: true,
});
await browser.close();
console.log(
  "/workspace/original-96-overview.png\n/workspace/original-qipao-8.png",
);
