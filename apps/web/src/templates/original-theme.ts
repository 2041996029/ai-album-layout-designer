import {
  canonicalJson,
  sha256,
  templateVersions,
  instantiateTemplate,
  isKnownLayer,
  isImageLayer,
  isShapeLayer,
  isTextLayer,
} from "@album/document";
import type { ResourceManifest } from "@album/assets";
import type { ConvertedTheme, ImportedPage } from "@album/template-import";
const escape = (value: unknown): string =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
/** A safe source preview: native artwork plus neutral photo placeholders, never user assets. */
function preview(page: ImportedPage): Uint8Array {
  const elements = page.layers
    .map((layer) => {
      if (!isKnownLayer(layer)) return "";
      const { x, y, width: w, height: h } = layer;
      const transform = `transform="rotate(${layer.rotation} ${x + w / 2} ${y + h / 2})" opacity="${layer.opacity}"`;
      if (isImageLayer(layer))
        return `<g ${transform}><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#d1d4d0"/><text x="${x + w / 2}" y="${y + h / 2}" text-anchor="middle" font-size="24" fill="#53635b">示意</text></g>`;
      if (isShapeLayer(layer)) {
        const style = `${transform} fill="${escape(layer.fill)}" stroke="${escape(layer.stroke)}" stroke-width="${layer.strokeWidth}"`;
        if (layer.shapeKind === "ellipse")
          return `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" ${style}/>`;
        if (layer.shapeKind === "line")
          return `<line x1="${x}" y1="${y}" x2="${x + w}" y2="${y + h}" ${style}/>`;
        return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${layer.radius ?? 0}" ${style}/>`;
      }
      if (isTextLayer(layer)) {
        const align = layer.textAlign,
          tx = align === "right" ? x + w : align === "center" ? x + w / 2 : x;
        const anchor =
          align === "right" ? "end" : align === "center" ? "middle" : "start";
        return `<text ${transform} x="${tx}" y="${y + layer.fontSize}" fill="${escape(layer.fill)}" font-family="${layer.fontAssetId === "noto-serif-sc" ? "serif" : "sans-serif"}" font-size="${layer.fontSize}" font-weight="${layer.fontWeight}" letter-spacing="${layer.letterSpacing}" text-anchor="${anchor}">${layer.text
          .split("\n")
          .map(
            (line, i) =>
              `<tspan x="${tx}" dy="${i ? layer.fontSize * layer.lineHeight : 0}">${escape(line)}</tspan>`,
          )
          .join("")}</text>`;
      }
      return "";
    })
    .join("");
  return new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${page.width} ${page.height}" width="${page.width}" height="${page.height}"><title>${escape(page.name)} · 照片示意</title><rect width="100%" height="100%" fill="${escape(page.background)}"/>${elements}</svg>`,
  );
}
/** Ephemeral seed bundle. Project fonts already exist; never persist this as a private import. */
export async function originalThemeBundle(
  themeId: string,
  resources: ResourceManifest,
): Promise<ConvertedTheme> {
  const templates = templateVersions
    .filter((t) => t.themeId === themeId && t.id.startsWith("theme_"))
    .sort((a, b) => a.pageOrder! - b.pageOrder!);
  if (templates.length !== 8) throw Error("THEME_UNAVAILABLE");
  const usedFonts = new Set(
    templates.flatMap((t) =>
      t.slots.filter((s) => s.kind === "text").map((s) => s.fontAssetId!),
    ),
  );
  if ([...usedFonts].some((id) => !resources.fonts.some((f) => f.id === id)))
    throw Error("FONT_UNAVAILABLE");
  const sourceHash = await sha256(
    canonicalJson(
      templates.map(({ id, version, sha256 }) => ({ id, version, sha256 })),
    ),
  );
  const id = `original_${themeId}_${sourceHash.slice(0, 16)}`,
    files = new Map<string, Uint8Array>();
  const pages = templates.map((t) => {
    let sequence = 0;
    const photoSlots = t.slots.filter((s) => s.kind === "image");
    const bindings = Object.fromEntries(
      photoSlots.map((s) => [
        s.slotId,
        `${id}_placeholder_${t.pageOrder}_${s.slotId}`,
      ]),
    );
    const layers = instantiateTemplate(
      t,
      bindings,
      () => `${t.id}_layer_${++sequence}`,
    );
    const slotLayers = new Map(t.slots.map((s, i) => [s.slotId, layers[i]]));
    const page: ImportedPage = {
      id: t.id,
      name: t.name,
      width: t.pageSize.width * 2,
      height: t.pageSize.height,
      background: t.background,
      layers,
      photoSlots: photoSlots.map((s) => ({
        slotId: s.slotId,
        layerId: slotLayers.get(s.slotId)!.id,
        required: true,
      })),
      previewPath: `original-previews/${t.id}.svg`,
      issues: [],
    };
    for (const l of layers)
      if (isImageLayer(l)) {
        l.templateSlot = {
          version: 1,
          slotId: photoSlots.find((s) => slotLayers.get(s.slotId) === l)!
            .slotId,
        };
        l.layoutPhotoRole = "decoration";
      }
    files.set(page.previewPath, preview(page));
    return page;
  });
  return {
    theme: {
      version: 1,
      id,
      sourceHash,
      name: templates[0].collectionName!,
      pages,
      resources: {
        assets: [],
        fonts: structuredClone(
          resources.fonts.filter((f) => usedFonts.has(f.id)),
        ),
      },
      issues: [],
    },
    files,
  };
}
