import type { DocumentModel } from "@album/document";
import type { ExportSnapshot, SurfaceSpec, ExportOptions } from "./types";
import { validateOptions } from "./snapshot";
import type { ImageLayer } from "@album/document";
import { imagePlacement } from "@album/render";
export function effectivePpi(
  image: ImageLayer,
  asset: { width: number; height: number },
  scale: number,
): number {
  if (!Number.isFinite(scale) || scale <= 0)
    throw new Error("INVALID_GROUP_SCALE");
  const p = imagePlacement(image, asset.width, asset.height);
  return (
    Math.round(
      Math.min(
        p.source.width / ((p.destination.width * scale) / 96),
        p.source.height / ((p.destination.height * scale) / 96),
      ) * 100,
    ) / 100
  );
}
export function allSurfaceIds(
  doc: DocumentModel,
  view: ExportOptions["view"],
  includeCover: boolean,
): string[] {
  return [
    ...(includeCover ? ["cover:front"] : []),
    ...doc.spreads.flatMap((s) =>
      view === "spread" ? [s.id] : [s.id + ":left", s.id + ":right"],
    ),
    ...(includeCover ? ["cover:back"] : []),
  ];
}
export function planSurfaces(snapshot: ExportSnapshot): SurfaceSpec[] {
  const { doc, options } = snapshot;
  validateOptions(options);
  const ids = allSurfaceIds(doc, options.view, options.includeCover);
  if (options.pageIds.some((id) => !ids.includes(id)))
    throw new Error("INVALID_PAGE_SELECTION");
  const w = doc.pageSize.width,
    h = doc.pageSize.height,
    scale = options.dpi / 96,
    bleed = (options.bleedMm * 96) / 25.4;
  const surfaces = ids.map((id, index) => {
    const cover =
      id === "cover:front" ? "front" : id === "cover:back" ? "back" : undefined;
    const spread = cover
      ? undefined
      : doc.spreads.find(
          (s) => id === s.id || id === s.id + ":left" || id === s.id + ":right",
        );
    const clip = {
      x:
        !cover && options.view === "singlePage" && id.endsWith(":right")
          ? w
          : 0,
      y: 0,
      width: cover || options.view === "singlePage" ? w : 2 * w,
      height: h,
    };
    const trimWidthMm = (clip.width * 25.4) / 96,
      trimHeightMm = (clip.height * 25.4) / 96;
    const filename =
      cover ??
      (options.view === "spread"
        ? "spread-" + String(doc.spreads.indexOf(spread!) + 1).padStart(2, "0")
        : "page-" +
          String(
            doc.spreads.indexOf(spread!) * 2 + (id.endsWith(":right") ? 2 : 1),
          ).padStart(2, "0"));
    const surface: SurfaceSpec = {
      id,
      ...(cover ? { cover } : { sourceSpreadId: spread!.id }),
      clip,
      bleedPx96: bleed,
      background: spread?.background ?? "#ffffff",
      pixelWidth: Math.round((clip.width + 2 * bleed) * scale),
      pixelHeight: Math.round((clip.height + 2 * bleed) * scale),
      fileStem: String(index + 1).padStart(4, "0") + "-" + filename,
      trimWidthMm,
      trimHeightMm,
      bleedMm: options.bleedMm,
      trimBoxMm: {
        x: options.bleedMm,
        y: options.bleedMm,
        width: trimWidthMm,
        height: trimHeightMm,
      },
    };
    if (
      !Number.isSafeInteger(surface.pixelWidth) ||
      !Number.isSafeInteger(surface.pixelHeight) ||
      surface.pixelWidth < 1 ||
      surface.pixelHeight < 1
    )
      throw new Error("INVALID_OUTPUT_DIMENSIONS");
    return surface;
  });
  return surfaces.filter((s) => options.pageIds.includes(s.id));
}
