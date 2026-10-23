import {
  isTextLayer,
  isGroupLayer,
  type Layer,
  type DocumentModel,
  type DocumentCommand,
  type TextLayer,
} from "@album/document";
import {
  loadFont,
  type ResourceManifest,
  type ResourcePort,
} from "@album/assets";
import { fitTextToFrame, createTextMeasure } from "@album/render";
export async function fitAlbumText(
  doc: DocumentModel,
  resources: ResourceManifest,
  port: ResourcePort,
): Promise<DocumentCommand> {
  const texts: TextLayer[] = [];
  const visit = (layers: Layer[]) => {
    for (const l of layers) {
      if (l.locked) continue;
      if (isTextLayer(l)) texts.push(l);
      else if (isGroupLayer(l)) visit(l.children);
    }
  };
  visit(doc.cover.front);
  visit(doc.cover.back);
  doc.spreads.forEach((s) => visit(s.layers));
  const commands: DocumentCommand[] = [];
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  try {
    for (const record of resources.fonts) {
      const matching = texts.filter((t) => t.fontAssetId === record.id);
      if (!matching.length) continue;
      const font = await loadFont(
        record,
        port,
        new AbortController().signal,
        matching.map((t) => t.text).join("\n"),
      );
      try {
        for (const text of matching) {
          const fit = fitTextToFrame(
            text,
            font,
            createTextMeasure(
              canvas.getContext("2d")!,
              text.fontWeight as 400 | 700,
            ),
          );
          if (fit !== text)
            commands.push({
              type: "update-layer",
              layerId: text.id,
              patch: {
                fontSize: fit.fontSize,
                letterSpacing: fit.letterSpacing,
              },
            });
        }
      } finally {
        font.dispose();
      }
    }
  } finally {
    canvas.width = canvas.height = 0;
  }
  return { type: "batch", commands };
}
