import {
  StaticCanvas,
  FabricText,
  FabricImage,
  Rect as FabricRect,
  Ellipse,
  Line,
  util,
  type FabricObject,
  type TMat2D,
} from "fabric";
import {
  isGroupLayer,
  isImageLayer,
  isKnownLayer,
  isShapeLayer,
  isTextLayer,
  type DocumentModel,
  type Layer,
  type Rect,
} from "@album/document";
import {
  loadFont,
  ResourceError,
  type LoadedFont,
  type ResourceManifest,
  type ResourcePort,
} from "@album/assets";
import {
  createTextMeasure,
  graphemes,
  layoutText,
  type TextMetricsReport,
} from "./text-layout";
import { renderImage } from "./image-pipeline";
export interface RenderSurface {
  id: string;
  sourceSpreadId?: string;
  cover?: "front" | "back";
  clip: Rect;
  bleedPx96: number;
  background: string;
  pixelWidth: number;
  pixelHeight: number;
}
export interface RenderInput {
  doc: DocumentModel;
  surface: RenderSurface;
  manifest: ResourceManifest;
  port: ResourcePort;
  signal: AbortSignal;
  pixelScale: number;
}
export interface SceneHandle {
  update(input: RenderInput): Promise<void>;
  render(): Promise<void>;
  dispose(): void;
  readonly textReports: readonly TextMetricsReport[];
}
export class RenderError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly textReports: readonly TextMetricsReport[] = [],
  ) {
    super(message);
    this.name = "RenderError";
  }
}
const identity: TMat2D = [1, 0, 0, 1, 0, 0];
const matrix = (x: number, y: number, angle: number, scale = 1): TMat2D =>
  util.composeMatrix({
    translateX: x,
    translateY: y,
    angle,
    scaleX: scale,
    scaleY: scale,
  });
const multiply = util.multiplyTransformMatrices;
/** Fabric owns scene transforms; the shared text report owns every line break and baseline. */
class FixedLineText extends FabricText {
  drawLine!: (ctx: CanvasRenderingContext2D) => void;
  override _render(ctx: CanvasRenderingContext2D) {
    this.drawLine(ctx);
  }
}
interface Generation {
  controller: AbortController;
  release: () => void;
  objects: FabricObject[];
  reports: TextMetricsReport[];
}
function surfaceLayers(input: RenderInput): Layer[] {
  const { surface, doc } = input;
  if (surface.cover && surface.sourceSpreadId)
    throw new RenderError(
      "INVALID_SURFACE",
      "A surface must reference one source.",
    );
  if (surface.cover) return doc.cover[surface.cover];
  const spread = doc.spreads.find((s) => s.id === surface.sourceSpreadId);
  if (!spread)
    throw new RenderError("INVALID_SURFACE", "Source spread is unavailable.");
  return spread.layers;
}
function validate(input: RenderInput) {
  input.signal.throwIfAborted();
  const s = input.surface;
  let retainedBytes = 0;
  const budget = (layers: Layer[], scale: number) => {
    for (const layer of layers) {
      if (layer.visible === false) continue;
      if (isGroupLayer(layer)) {
        budget(layer.children, scale * (layer.scale ?? 1));
      } else if (isImageLayer(layer)) {
        retainedBytes +=
          4 *
          Math.ceil(layer.width * scale * input.pixelScale) *
          Math.ceil(layer.height * scale * input.pixelScale);
      }
    }
  };
  budget(surfaceLayers(input), 1);
  if (!Number.isFinite(retainedBytes) || retainedBytes > 128 * 1024 ** 2)
    throw new RenderError(
      "CACHE_BUDGET",
      "Image frames exceed the 128MiB scene cache budget.",
    );

  if (
    !Number.isFinite(input.pixelScale) ||
    input.pixelScale <= 0 ||
    ![s.pixelWidth, s.pixelHeight].every(
      (n) => Number.isSafeInteger(n) && n > 0,
    ) ||
    s.pixelWidth * s.pixelHeight > 50_000_000
  )
    throw new RenderError(
      "SURFACE_TOO_LARGE",
      "Output dimensions must be positive and at most 50MP.",
    );
  if (
    ![s.clip.x, s.clip.y, s.clip.width, s.clip.height, s.bleedPx96].every(
      Number.isFinite,
    ) ||
    s.clip.width <= 0 ||
    s.clip.height <= 0 ||
    s.bleedPx96 < 0
  )
    throw new RenderError("INVALID_SURFACE", "Invalid clip or bleed.");
}
export async function createScene(
  element: HTMLCanvasElement,
  input: RenderInput,
): Promise<SceneHandle> {
  validate(input);
  const canvas = new StaticCanvas(element, {
    renderOnAddRemove: false,
    enableRetinaScaling: false,
    skipOffscreen: false,
  });
  let disposed = false,
    token = 0,
    pending: Generation | undefined,
    current: Generation | undefined;
  const cleanup = (g: Generation | undefined) => {
    g?.release();
  };
  const handle: SceneHandle = {
    get textReports() {
      return current?.reports ?? [];
    },
    async update(next) {
      if (disposed)
        throw new RenderError(
          "SCENE_DISPOSED",
          "Cannot update a disposed scene.",
        );
      validate(next);
      const layers = surfaceLayers(next);
      const generation = ++token;
      cleanup(pending);
      const controller = new AbortController(),
        signal = controller.signal;
      const releases: (() => void)[] = [];
      let released = false;
      const externalAbort = () => {
        controller.abort(next.signal.reason);
        if (current === g) {
          canvas.clear();
          canvas.renderAll();
          current = undefined;
          g.release();
        }
      };
      const g: Generation = {
        controller,
        objects: [],
        reports: [],
        release() {
          if (released) return;
          released = true;
          next.signal.removeEventListener("abort", externalAbort);
          controller.abort();
          for (const release of releases.reverse()) release();
          for (const object of g.objects) object.dispose();
        },
      };
      next.signal.addEventListener("abort", externalAbort, { once: true });
      pending = g;
      const fontCache = new Map<string, LoadedFont>();
      // Load each family once with the union of text on this surface, so overlapping subsets share ownership.
      const fontTexts = new Map<string, string>();
      const collect = (list: Layer[]) => {
        for (const layer of list) {
          if (!isKnownLayer(layer))
            throw new RenderError(
              "UNSUPPORTED_LAYER",
              `Unsupported layer ${layer.type}.`,
            );
          if (!layer.visible) continue;
          if (isGroupLayer(layer)) collect(layer.children);
          if (isTextLayer(layer)) {
            if (layer.fontWeight !== 400 && layer.fontWeight !== 700)
              throw new RenderError(
                "FONT_UNAVAILABLE",
                "Only actual 400 and 700 font weights are available.",
              );
            fontTexts.set(
              layer.fontAssetId,
              (fontTexts.get(layer.fontAssetId) ?? "") + layer.text,
            );
          }
        }
      };
      const add = (object: FabricObject, parent: TMat2D, opacity: number) => {
        object.set({ selectable: false, evented: false, objectCaching: false });
        object.opacity *= opacity;
        util.applyTransformToObject(
          object,
          multiply(parent, object.calcTransformMatrix()),
        );
        g.objects.push(object);
      };
      try {
        collect(layers);
        for (const [id, text] of fontTexts) {
          signal.throwIfAborted();
          const record = next.manifest.fonts.find((f) => f.id === id);
          if (!record)
            throw new RenderError(
              "FONT_UNAVAILABLE",
              `Pinned font ${id} is unavailable.`,
            );
          let font: LoadedFont;
          try {
            font = await loadFont(record, next.port, signal, text);
          } catch (error) {
            if (
              error instanceof ResourceError &&
              ["RESOURCE_MISSING", "FONT_WEIGHT_MISSING"].includes(error.code)
            )
              throw new RenderError("FONT_UNAVAILABLE", error.message);
            throw error;
          }
          releases.push(() => font.dispose());
          fontCache.set(id, font);
        }
        const measureCanvas = document.createElement("canvas"),
          context = measureCanvas.getContext("2d")!;
        const visit = async (
          list: Layer[],
          parent: TMat2D,
          opacity: number,
          scale: number,
        ): Promise<void> => {
          for (const layer of list) {
            signal.throwIfAborted();
            if (!isKnownLayer(layer))
              throw new RenderError(
                "UNSUPPORTED_LAYER",
                `Unsupported layer ${layer.type}.`,
              );
            if (!layer.visible) continue;
            if (isGroupLayer(layer)) {
              await visit(
                layer.children,
                multiply(
                  parent,
                  matrix(layer.x, layer.y, layer.rotation, layer.scale ?? 1),
                ),
                opacity * layer.opacity,
                scale * (layer.scale ?? 1),
              );
              continue;
            }
            const common = {
              left: layer.x,
              top: layer.y,
              angle: layer.rotation,
              opacity: layer.opacity,
              originX: "left" as const,
              originY: "top" as const,
              strokeWidth: 0,
            };
            if (isShapeLayer(layer)) {
              const options = {
                ...common,
                width: layer.width,
                height: layer.height,
                fill: layer.fill,
                stroke: layer.stroke,
                strokeWidth: layer.strokeWidth,
                // Child stroke widths are local units and follow the parent affine scale.
                strokeUniform: false,
              };
              const object =
                layer.shapeKind === "ellipse"
                  ? new Ellipse({
                      ...options,
                      rx: layer.width / 2,
                      ry: layer.height / 2,
                    })
                  : layer.shapeKind === "line"
                    ? new Line([0, 0, layer.width, layer.height], options)
                    : new FabricRect({
                        ...options,
                        rx: layer.radius ?? 0,
                        ry: layer.radius ?? 0,
                      });
              add(object, parent, opacity);
            } else if (isImageLayer(layer)) {
              const record = next.manifest.assets.find(
                (a) => a.id === layer.assetId,
              );
              if (!record)
                throw new RenderError(
                  "RESOURCE_MISSING",
                  `Image ${layer.assetId} is unavailable.`,
                );
              const image = await renderImage(
                layer,
                record,
                next.port,
                signal,
                next.pixelScale * scale,
              );
              releases.push(() => image.dispose());
              signal.throwIfAborted();
              add(
                new FabricImage(image.canvas, {
                  ...common,
                  scaleX: layer.width / image.canvas.width,
                  scaleY: layer.height / image.canvas.height,
                }),
                parent,
                opacity,
              );
            } else if (isTextLayer(layer)) {
              const font = fontCache.get(layer.fontAssetId)!;
              const measure = createTextMeasure(
                context,
                layer.fontWeight as 400 | 700,
              );
              const report = layoutText(layer, font, measure);
              g.reports.push(report);
              if (report.unsupportedCodePoints.length)
                throw new RenderError(
                  "UNSUPPORTED_GLYPHS",
                  `Font does not cover text in ${layer.id}.`,
                  g.reports,
                );
              const textParent = multiply(
                parent,
                matrix(layer.x, layer.y, layer.rotation),
              );
              for (const [index, text] of report.lines.entries()) {
                if (!text) continue;
                const box = report.lineBoxes[index];
                const object = new FixedLineText(text, {
                  left: box.x,
                  top: box.y,
                  fontFamily: font.family,
                  fontWeight: layer.fontWeight,
                  fontSize: layer.fontSize,
                  fill: layer.fill,
                  opacity: layer.opacity,
                  originX: "left",
                  originY: "top",
                  strokeWidth: 0,
                });
                object.set({ width: box.width, height: box.height });
                object.drawLine = (ctx) => {
                  ctx.font = `${layer.fontWeight} ${layer.fontSize}px "${font.family}"`;
                  ctx.textBaseline = "alphabetic";
                  ctx.textAlign = "left";
                  ctx.fontKerning = "normal";
                  ctx.fillStyle = layer.fill;
                  let x = -object.width / 2;
                  const y = -object.height / 2 + layer.fontSize;
                  if (report.lineLetterSpacing[index] === 0)
                    ctx.fillText(text, x, y);
                  else
                    for (const char of graphemes(text)) {
                      ctx.fillText(char, x, y);
                      x +=
                        ctx.measureText(char).width +
                        report.lineLetterSpacing[index];
                    }
                };
                add(object, textParent, opacity);
              }
            }
          }
        };
        await visit(layers, identity, 1, 1);
        signal.throwIfAborted();
        if (disposed || generation !== token)
          throw new DOMException("Superseded scene", "AbortError");
        const old = current;
        canvas.remove(...canvas.getObjects());
        canvas.setDimensions({
          width: next.surface.pixelWidth,
          height: next.surface.pixelHeight,
        });
        canvas.backgroundColor = next.surface.background;
        const s = next.surface,
          k = next.pixelScale;
        canvas.setViewportTransform([
          k,
          0,
          0,
          k,
          (s.bleedPx96 - s.clip.x) * k,
          (s.bleedPx96 - s.clip.y) * k,
        ]);
        canvas.add(...g.objects);
        current = g;
        pending = undefined;
        cleanup(old);
        canvas.renderAll();
      } catch (error) {
        if (pending === g) pending = undefined;
        cleanup(g);
        throw error;
      }
    },
    async render() {
      if (disposed)
        throw new RenderError(
          "SCENE_DISPOSED",
          "Cannot render a disposed scene.",
        );
      current?.controller.signal.throwIfAborted();
      canvas.renderAll();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      token++;
      cleanup(pending);
      pending = undefined;
      canvas.remove(...canvas.getObjects());
      cleanup(current);
      current = undefined;
      void canvas.dispose().catch(() => {});
    },
  };
  try {
    await handle.update(input);
    return handle;
  } catch (error) {
    handle.dispose();
    throw error;
  }
}
