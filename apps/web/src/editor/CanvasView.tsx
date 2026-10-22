import { useEffect, useRef, useState, useLayoutEffect } from "react";
import { createScene, type SceneHandle } from "@album/render";
import {
  isKnownLayer,
  isGroupLayer,
  type DocumentModel,
  type Layer,
  type KnownLayer,
  type DocumentCommand,
} from "@album/document";
import type { ResourceManifest, ResourcePort } from "@album/assets";
import { rotation, frameBounds } from "./types";
interface Props {
  doc: DocumentModel;
  surfaceId: string;
  layers: Layer[];
  resources: ResourceManifest;
  port: ResourcePort;
  selected: string[];
  onSelect: (ids: string[]) => void;
  execute: (command: DocumentCommand) => boolean;
  onEdit: (layer: KnownLayer) => void;
  zoom: number;
}
type Matrix = [number, number, number, number, number, number];
const identity: Matrix = [1, 0, 0, 1, 0, 0];
function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}
function transform(layer: KnownLayer): Matrix {
  const angle = (layer.rotation * Math.PI) / 180;
  return [
    Math.cos(angle),
    Math.sin(angle),
    -Math.sin(angle),
    Math.cos(angle),
    layer.x,
    layer.y,
  ];
}
function entries(
  layers: Layer[],
  parent = identity,
  parentId?: string,
): { layer: KnownLayer; matrix: Matrix; parent: Matrix; target: string }[] {
  return layers.flatMap((layer) => {
    if (!isKnownLayer(layer) || layer.visible === false) return [];
    const matrix = multiply(parent, transform(layer));
    const entry = { layer, matrix, parent, target: parentId ?? layer.id };
    return isGroupLayer(layer)
      ? [
          entry,
          ...entries(
            layer.children,
            multiply(matrix, [layer.scale ?? 1, 0, 0, layer.scale ?? 1, 0, 0]),
            parentId ?? layer.id,
          ),
        ]
      : [entry];
  });
}
export function CanvasView({
  doc,
  surfaceId,
  layers,
  resources,
  port,
  selected,
  onSelect,
  execute,
  onEdit,
  zoom,
}: Props) {
  const canvas = useRef<HTMLDivElement>(null),
    host = useRef<HTMLDivElement>(null),
    scene = useRef<SceneHandle | undefined>(undefined);
  const svg = useRef<SVGSVGElement>(null),
    listenerCount = useRef(0);
  const [activeListeners, setActiveListeners] = useState(0);
  const generation = useRef(0);
  const [available, setAvailable] = useState({ width: 600, height: 400 }),
    [status, setStatus] = useState("loading"),
    [error, setError] = useState("");
  const [preview, setPreview] = useState<{ dx: number; dy: number } | null>(
      null,
    ),
    [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const drag = useRef<
    | {
        kind: "move" | "resize" | "rotate";
        startX: number;
        startY: number;
        items: KnownLayer[];
        parent: Matrix;
        scale: number;
        alt: boolean;
        dx: number;
        dy: number;
        originX: number;
        originY: number;
        startAngle: number;
        turn: number;
      }
    | undefined
  >(undefined);
  const width = doc.pageSize.width * (surfaceId.startsWith("cover:") ? 1 : 2),
    height = doc.pageSize.height;
  const pixelScale =
    Math.min(1, available.width / width, available.height / height) * zoom;
  const all = entries(layers),
    selection = all.filter((e) => selected.includes(e.layer.id));
  useEffect(() => {
    const target = svg.current!;
    const clear = (event: PointerEvent) => {
      if (event.target === target) onSelect([]);
    };
    target.addEventListener("pointerdown", clear);
    listenerCount.current++;
    setActiveListeners(listenerCount.current);
    return () => {
      target.removeEventListener("pointerdown", clear);
      listenerCount.current--;
    };
  }, [onSelect]);
  useLayoutEffect(() => {
    if (!host.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setAvailable({
        width: Math.max(200, entry.contentRect.width - 72),
        height: Math.max(120, entry.contentRect.height - 116),
      }),
    );
    observer.observe(host.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const token = ++generation.current,
      controller = new AbortController();
    setStatus("loading");
    setError("");
    const target = document.createElement("canvas");
    target.setAttribute("aria-label", "相册共享渲染画布");
    canvas.current!.replaceChildren(target);
    let owned: SceneHandle | undefined;
    const background =
      doc.spreads.find((s) => s.id === surfaceId)?.background ?? "#ffffff";
    const surface = {
      id: surfaceId,
      ...(surfaceId.startsWith("cover:")
        ? {
            cover:
              surfaceId === "cover:front"
                ? ("front" as const)
                : ("back" as const),
          }
        : { sourceSpreadId: surfaceId }),
      clip: { x: 0, y: 0, width, height },
      bleedPx96: 0,
      background,
      pixelWidth: Math.max(1, Math.round(width * pixelScale)),
      pixelHeight: Math.max(1, Math.round(height * pixelScale)),
    };
    void createScene(target, {
      doc,
      surface,
      manifest: resources,
      port,
      signal: controller.signal,
      pixelScale,
    })
      .then((handle) => {
        if (generation.current !== token) {
          handle.dispose();
          return;
        }
        owned = handle;
        scene.current = handle;
        setStatus("ready");
      })
      .catch((e) => {
        if (!controller.signal.aborted && generation.current === token) {
          setStatus("error");
          setError(
            `${e.code ?? "RENDER_ERROR"}：${e.message ?? String(e)}。请检查素材、字体或不支持的图层。`,
          );
        }
      });
    return () => {
      generation.current++;
      controller.abort();
      owned?.dispose();
      if (scene.current === owned) scene.current = undefined;
      target.remove();
    };
  }, [doc, surfaceId, resources, port, pixelScale, width, height]);
  const begin = (
    event: React.PointerEvent<SVGElement>,
    id: string,
    kind: "move" | "resize" | "rotate" = "move",
  ) => {
    event.stopPropagation();
    const entry = all.find((e) => e.layer.id === id);
    if (!entry || entry.layer.locked) return;
    const ids = event.shiftKey
      ? selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id]
      : selected.includes(id)
        ? selected
        : [id];
    onSelect(ids);
    const chosen = all.filter(
      (e) => ids.includes(e.layer.id) && !e.layer.locked,
    );
    if (!chosen.length) return;
    if (
      chosen.some((e) =>
        e.parent.some((v, i) => Math.abs(v - chosen[0].parent[i]) > 0.001),
      )
    )
      return;
    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.ownerSVGElement!.getBoundingClientRect();
    const originX = rect.left + entry.matrix[4] * pixelScale,
      originY = rect.top + entry.matrix[5] * pixelScale;
    drag.current = {
      kind,
      startX: event.clientX,
      startY: event.clientY,
      items: chosen.map((e) => structuredClone(e.layer)),
      parent: chosen[0].parent,
      scale: pixelScale,
      alt: event.altKey,
      dx: 0,
      dy: 0,
      originX,
      originY,
      startAngle: Math.atan2(event.clientY - originY, event.clientX - originX),
      turn: 0,
    };
  };
  const move = (event: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (!d) return;
    const sx = (event.clientX - d.startX) / d.scale,
      sy = (event.clientY - d.startY) / d.scale;
    const [a, b, c, v] = d.parent,
      det = a * v - b * c;
    let dx = (v * sx - c * sy) / det,
      dy = (-b * sx + a * sy) / det;
    const guide: { x?: number; y?: number } = {};
    if (
      d.kind === "move" &&
      !event.altKey &&
      d.parent.every((v, i) => v === identity[i])
    ) {
      const item = frameBounds(d.items[0]),
        w = item.width,
        h = item.height;
      const others = layers
        .filter(isKnownLayer)
        .filter((l) => !d.items.some((s) => s.id === l.id));
      const xs = [
          0,
          width / 2,
          width,
          ...others.flatMap((l) => {
            const b = frameBounds(l);
            return [b.x, b.x + b.width / 2, b.x + b.width];
          }),
        ],
        ys = [
          0,
          height / 2,
          height,
          ...others.flatMap((l) => {
            const b = frameBounds(l);
            return [b.y, b.y + b.height / 2, b.y + b.height];
          }),
        ];
      const snap = (
        origin: number,
        delta: number,
        size: number,
        targets: number[],
      ) => {
        let best = 6 / d.scale,
          adjustment = 0,
          line: number | undefined;
        for (const anchor of [
          origin + delta,
          origin + delta + size / 2,
          origin + delta + size,
        ])
          for (const target of targets) {
            const distance = Math.abs(anchor - target);
            if (distance < best) {
              best = distance;
              adjustment = target - anchor;
              line = target;
            }
          }
        return { delta: delta + adjustment, line };
      };
      const x = snap(item.x, dx, w, xs),
        y = snap(item.y, dy, h, ys);
      dx = x.delta;
      dy = y.delta;
      guide.x = x.line;
      guide.y = y.line;
    }
    d.turn =
      ((Math.atan2(event.clientY - d.originY, event.clientX - d.originX) -
        d.startAngle) *
        180) /
      Math.PI;
    d.dx = dx;
    d.dy = dy;
    setPreview({ dx, dy });
    setGuides(guide);
  };
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = undefined;
    setPreview(null);
    setGuides({});
    if (Math.abs(d.dx) + Math.abs(d.dy) < 0.01) return;
    execute({
      type: "batch",
      commands: d.items.map((layer) => {
        let patch: Record<string, unknown>;
        if (d.kind === "move") patch = { x: layer.x + d.dx, y: layer.y + d.dy };
        else if (d.kind === "rotate")
          patch = { rotation: rotation(layer.rotation + d.turn) };
        else {
          const angle = (layer.rotation * Math.PI) / 180,
            localX = d.dx * Math.cos(angle) + d.dy * Math.sin(angle),
            localY = -d.dx * Math.sin(angle) + d.dy * Math.cos(angle);
          if (isGroupLayer(layer))
            patch = {
              scale: Math.max(0.05, (layer.scale ?? 1) + localX / layer.width),
            };
          else
            patch = {
              width: Math.max(1, layer.width + localX),
              height: Math.max(1, layer.height + localY),
            };
        }
        return { type: "update-layer", layerId: layer.id, patch };
      }),
    });
  };
  return (
    <div className="canvas-host" ref={host}>
      <div className="canvas-caption">
        <span>
          {surfaceId.startsWith("cover:") ? "封面设计" : "内页跨页"} <b>·</b>{" "}
          {Math.round(width)} × {height} px
        </span>
        <span>Alt 暂停吸附 · Shift 多选</span>
      </div>
      <div className="canvas-scroll">
        <div
          className="artboard"
          style={{
            width: Math.round(width * pixelScale),
            height: Math.round(height * pixelScale),
          }}
          data-testid="scene-state"
          data-render-status={status}
          data-active-listeners={activeListeners}
        >
          <div className="render-layer" ref={canvas} />
          <svg
            ref={svg}
            className="interaction"
            width="100%"
            height="100%"
            viewBox={`0 0 ${width} ${height}`}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={() => {
              drag.current = undefined;
              setPreview(null);
              setGuides({});
            }}
          >
            {!surfaceId.startsWith("cover:") && (
              <line
                className="fold"
                x1={width / 2}
                x2={width / 2}
                y1="0"
                y2={height}
              />
            )}
            {all
              .filter((e) => !isGroupLayer(e.layer) && e.layer.visible)
              .map((e) => (
                <rect
                  key={e.layer.id}
                  data-testid="layer-hit"
                  aria-label={`画布图层 ${e.layer.id}`}
                  transform={`matrix(${e.matrix.join(" ")})`}
                  x="0"
                  y="0"
                  width={e.layer.width}
                  height={e.layer.height}
                  fill="transparent"
                  style={{ cursor: e.layer.locked ? "not-allowed" : "move" }}
                  onPointerDown={(event) => begin(event, e.target)}
                  onDoubleClick={() => {
                    const target = all.find(
                      (x) => x.layer.id === e.target,
                    )?.layer;
                    if (target && !target.locked) onEdit(target);
                  }}
                />
              ))}
            {selection.map(({ layer, matrix }) => {
              const scale = isGroupLayer(layer) ? (layer.scale ?? 1) : 1;
              const delta =
                preview && drag.current?.kind === "move"
                  ? `translate(${preview.dx} ${preview.dy}) `
                  : "";
              return (
                <g
                  key={layer.id}
                  transform={`${delta}matrix(${matrix.join(" ")})`}
                  className="selection"
                >
                  <rect
                    width={layer.width * scale}
                    height={layer.height * scale}
                    fill="none"
                    strokeWidth={1.5 / pixelScale}
                  />
                  {!layer.locked && (
                    <>
                      <rect
                        data-testid="resize-handle"
                        x={layer.width * scale - 5 / pixelScale}
                        y={layer.height * scale - 5 / pixelScale}
                        width={10 / pixelScale}
                        height={10 / pixelScale}
                        className="handle"
                        onPointerDown={(event) =>
                          begin(event, layer.id, "resize")
                        }
                      />
                      <circle
                        aria-label="旋转手柄"
                        cx={(layer.width * scale) / 2}
                        cy={-20 / pixelScale}
                        r={5 / pixelScale}
                        className="handle"
                        onPointerDown={(event) =>
                          begin(event, layer.id, "rotate")
                        }
                      />
                    </>
                  )}
                </g>
              );
            })}
            {guides.x !== undefined && (
              <line
                className="snap-guide"
                x1={guides.x}
                x2={guides.x}
                y1="0"
                y2={height}
              />
            )}
            {guides.y !== undefined && (
              <line
                className="snap-guide"
                x1="0"
                x2={width}
                y1={guides.y}
                y2={guides.y}
              />
            )}
          </svg>
          {!layers.length && (
            <div className="empty-canvas">
              <span>＋</span>
              <h2>让回忆在这里展开</h2>
              <p>
                从左侧导入照片并拖入画布
                <br />
                也可以添加文字与形状，自由创作
              </p>
            </div>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="render-error">
          {error}
        </p>
      )}
      <div className="canvas-footer">
        <span>
          {selected.length
            ? `已选择 ${selected.length} 个图层`
            : "点击图层开始编辑"}{" "}
          · 拖动移动 / 右下角缩放
        </span>
        <span>
          {status === "loading"
            ? "正在渲染…"
            : status === "ready"
              ? "共享渲染已更新"
              : "请修复资源后重试"}
        </span>
      </div>
    </div>
  );
}
