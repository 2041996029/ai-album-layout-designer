import type { ResourcePort } from "@album/assets";
import { createScene, type SceneHandle } from "@album/render";
import type { ExportSnapshot, PreflightReport } from "./types";
import { authorizeExport } from "./preflight";
import { planSurfaces } from "./geometry";
import { encodePng } from "./encode-png";
import { encodeJpeg } from "./encode-jpeg";
import { encodePdf, MAX_ENCODED_BYTES, type EncodedPage } from "./encode-pdf";
import { artifact, type Artifact } from "./artifact-manifest";
export async function* runExport(
  snapshot: ExportSnapshot,
  report: PreflightReport,
  ack: string[],
  port: ResourcePort,
  signal: AbortSignal,
  onProgress: (done: number, total: number) => void = () => {},
): AsyncGenerator<Artifact> {
  authorizeExport(snapshot, report, ack);
  signal.throwIfAborted();
  const surfaces = planSurfaces(snapshot),
    pages: EncodedPage[] = [];
  let encodedBytes = 0,
    done = 0;
  for (const surface of surfaces) {
    signal.throwIfAborted();
    const canvas = document.createElement("canvas");
    let scene: SceneHandle | undefined;
    try {
      scene = await createScene(canvas, {
        doc: snapshot.doc,
        surface,
        manifest: snapshot.resources,
        port,
        signal,
        pixelScale: snapshot.options.dpi / 96,
      });
      await scene.render();
      signal.throwIfAborted();
      const jpeg = snapshot.options.format === "jpeg";
      const bytes = jpeg
        ? await encodeJpeg(
            canvas,
            snapshot.options.dpi,
            snapshot.options.jpegMatte,
          )
        : await encodePng(canvas, snapshot.options.dpi);
      signal.throwIfAborted();
      encodedBytes += bytes.length;
      if (encodedBytes > MAX_ENCODED_BYTES)
        throw new Error("DOWNLOAD_TOO_LARGE");
      if (snapshot.options.format === "pdf")
        pages.push({ surface, mime: "image/png", bytes });
      else
        yield await artifact(
          surface.fileStem + (jpeg ? ".jpg" : ".png"),
          jpeg ? "image/jpeg" : "image/png",
          bytes,
          surface,
        );
      onProgress(++done, surfaces.length);
    } finally {
      scene?.dispose();
      canvas.width = canvas.height = 0;
    }
  }
  if (snapshot.options.format === "pdf") {
    const bytes = await encodePdf(pages, snapshot, signal);
    signal.throwIfAborted();
    yield await artifact(
      "album-r" + snapshot.revision + ".pdf",
      "application/pdf",
      bytes,
    );
  }
}
