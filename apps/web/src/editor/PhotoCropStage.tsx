import { useRef } from "react";
import type { ImageLayer } from "@album/document";
import type { AssetRecord, ResourcePort } from "@album/assets";
import { AssetPreview } from "./AssetPanel";
import { initialPhotoCrop, movePhotoCrop } from "./photo-crop";
export function PhotoCropStage({
  layer,
  asset,
  port,
  onChange,
}: {
  layer: ImageLayer;
  asset: AssetRecord;
  port: ResourcePort;
  onChange: (layer: ImageLayer) => void;
}) {
  const drag = useRef<
    | {
        x: number;
        y: number;
        crop: ImageLayer["crop"];
        width: number;
        height: number;
      }
    | undefined
  >(undefined);
  const base = initialPhotoCrop(
    { ...layer, fitMode: "contain", crop: { x: 0, y: 0, width: 1, height: 1 } },
    asset,
  ).crop;
  const zoom =
    layer.fitMode === "contain"
      ? 1
      : Math.max(
          base.width / layer.crop.width,
          base.height / layer.crop.height,
        );
  const resize = (value: number) => {
    const width = base.width / value,
      height = base.height / value;
    onChange({
      ...layer,
      fitMode: "cover",
      crop: {
        x: Math.max(
          0,
          Math.min(1 - width, layer.crop.x + layer.crop.width / 2 - width / 2),
        ),
        y: Math.max(
          0,
          Math.min(
            1 - height,
            layer.crop.y + layer.crop.height / 2 - height / 2,
          ),
        ),
        width,
        height,
      },
    });
  };
  return (
    <>
      <p>拖动画框内的照片调整位置，画框不会移动；用缩放控制取景范围。</p>
      <div
        data-testid="photo-crop-stage"
        role="img"
        aria-label="拖动照片调整裁剪位置"
        style={{
          width: `min(100%,${(320 * layer.width) / layer.height}px)`,
          aspectRatio: `${layer.width}/${layer.height}`,
          maxWidth: "100%",
          margin: "12px auto",
          overflow: "hidden",
          position: "relative",
          background: "#eee",
          touchAction: "none",
          cursor: "grab",
          outline: "2px solid #567e68",
        }}
        onPointerDown={(e) => {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          const r = e.currentTarget.getBoundingClientRect();
          const prepared =
            layer.fitMode === "contain"
              ? initialPhotoCrop(layer, asset)
              : layer;
          if (prepared !== layer) onChange(prepared);
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            crop: prepared.crop,
            width: r.width,
            height: r.height,
          };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          onChange({
            ...layer,
            fitMode: "cover",
            crop: movePhotoCrop(
              d.crop,
              e.clientX - d.x,
              e.clientY - d.y,
              d.width,
              d.height,
            ),
          });
        }}
        onPointerUp={() => {
          drag.current = undefined;
        }}
        onPointerCancel={() => {
          drag.current = undefined;
        }}
      >
        <div
          style={
            layer.fitMode === "contain"
              ? { position: "absolute", inset: 0, pointerEvents: "none" }
              : {
                  position: "absolute",
                  left: `${(-layer.crop.x / layer.crop.width) * 100}%`,
                  top: `${(-layer.crop.y / layer.crop.height) * 100}%`,
                  width: `${100 / layer.crop.width}%`,
                  height: `${100 / layer.crop.height}%`,
                  pointerEvents: "none",
                }
          }
          className={`crop-photo-preview ${layer.fitMode === "contain" ? "is-contain" : ""}`}
        >
          <AssetPreview asset={asset} port={port} />
        </div>
      </div>
      <label>
        照片缩放
        <input
          aria-label="照片缩放"
          type="range"
          min={1}
          max={5}
          step={0.01}
          value={Math.min(5, zoom)}
          onChange={(e) => resize(Number(e.target.value))}
        />
        {zoom.toFixed(2)} ×
      </label>
    </>
  );
}
