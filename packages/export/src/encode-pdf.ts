import { PDFDocument } from "pdf-lib";
import type { ExportSnapshot, SurfaceSpec } from "./types";
export interface EncodedPage {
  surface: SurfaceSpec;
  mime: "image/png" | "image/jpeg";
  bytes: Uint8Array;
}
export const MAX_ENCODED_BYTES = 256 * 1024 ** 2;
export async function encodePdf(
  pages: EncodedPage[],
  snapshot: ExportSnapshot,
  signal?: AbortSignal,
): Promise<Uint8Array> {
  if (
    !pages.length ||
    pages.reduce((n, p) => n + p.bytes.length, 0) > MAX_ENCODED_BYTES
  )
    throw new Error("DOWNLOAD_TOO_LARGE");
  const pdf = await PDFDocument.create();
  pdf.setProducer("Album C1 raster sRGB");
  pdf.setTitle(
    typeof snapshot.doc.title === "string"
      ? snapshot.doc.title
      : "Album r" + snapshot.revision,
  );
  pdf.setCreationDate(new Date(snapshot.createdAt));
  pdf.setModificationDate(new Date(snapshot.createdAt));
  for (const { surface: s, mime, bytes } of pages) {
    signal?.throwIfAborted();
    const pt = 72 / 25.4,
      w = (s.trimWidthMm + 2 * s.bleedMm) * pt,
      h = (s.trimHeightMm + 2 * s.bleedMm) * pt,
      page = pdf.addPage([w, h]);
    page.setMediaBox(0, 0, w, h);
    page.setBleedBox(0, 0, w, h);
    page.setTrimBox(
      s.bleedMm * pt,
      s.bleedMm * pt,
      s.trimWidthMm * pt,
      s.trimHeightMm * pt,
    );
    const image =
      mime === "image/png"
        ? await pdf.embedPng(bytes)
        : await pdf.embedJpg(bytes);
    page.drawImage(image, { x: 0, y: 0, width: w, height: h });
    await image.embed();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    signal?.throwIfAborted();
  }
  const bytes = await pdf.save();
  if (bytes.length > MAX_ENCODED_BYTES) throw new Error("DOWNLOAD_TOO_LARGE");
  return bytes;
}
