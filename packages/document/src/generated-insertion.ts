import type { DocumentModel, ImageLayer, TextLayer } from "./model";
import { walkLayers } from "./model";
import type { DocumentCommand } from "./commands";
import type { GenerationProvenance } from "./generated-provenance";
export function createGeneratedInsertionCommand(
  doc: DocumentModel,
  input: {
    assetId: string;
    spreadId: string;
    provenance: GenerationProvenance;
    title: string | null;
    dateText: string | null;
    commandId?: string;
    fontAssetId?: string;
  },
  idFactory: () => string,
): DocumentCommand {
  const surface = doc.spreads.find((s) => s.id === input.spreadId);
  if (!surface) throw Error("SURFACE_NOT_FOUND");
  const commandId =
    input.commandId ??
    "generated:" + input.provenance.jobId + ":" + input.spreadId;
  if (surface.layers.some((l) => l.generationCommandId === commandId))
    return { type: "batch", commands: [] };
  const w = doc.pageSize.width * 2,
    h = doc.pageSize.height,
    margin = Math.max(20, w * 0.05),
    imageId = idFactory(),
    base = {
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      generationCommandId: commandId,
    };
  const image: ImageLayer = {
    ...base,
    id: imageId,
    type: "image",
    x: margin,
    y: margin,
    width: w - margin * 2,
    height: h - margin * 2 - 100,
    assetId: input.assetId,
    role: "generated",
    fitMode: "contain",
    crop: { x: 0, y: 0, width: 1, height: 1 },
    generationProvenance: input.provenance,
  };
  const font =
    input.fontAssetId ??
    ([...walkLayers(surface.layers)].find((l) => l.type === "text")
      ?.fontAssetId as string) ??
    "noto-sans-sc";
  const text = (value: string, y: number): TextLayer => ({
    ...base,
    id: idFactory(),
    type: "text",
    x: margin,
    y,
    width: w - margin * 2,
    height: 28,
    text: value,
    fontAssetId: font,
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    fill: "#253D34",
  });
  const layers = [
    image,
    ...(input.title ? [text(input.title, h - margin - 85)] : []),
    ...(input.dateText ? [text(input.dateText, h - margin - 55)] : []),
    {
      ...text("AI GENERATED", h - margin - 26),
      fontSize: 12,
      aiLabelFor: imageId,
      locked: true,
    },
  ];
  return {
    type: "batch",
    commands: layers.map((layer) => ({
      type: "insert-layer" as const,
      surfaceId: surface.id,
      layer,
    })),
  };
}
