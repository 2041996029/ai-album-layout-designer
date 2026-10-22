import { useState, useEffect } from "react";
import { isGroupLayer, type KnownLayer } from "@album/document";
import type { FontRecord } from "@album/assets";
import { rotation, type Patch, label } from "./types";
function Field({
  name,
  value,
  onCommit,
  min,
  max,
  step = "any",
}: {
  name: string;
  value: number;
  onCommit: (n: number) => void;
  min?: number;
  max?: number;
  step?: number | "any";
}) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(Math.round(value * 1000) / 1000)), [value]);
  return (
    <label className="field">
      <span>{name}</span>
      <input
        aria-label={name}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft);
          if (draft.trim() && Number.isFinite(n)) onCommit(n);
          else setDraft(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function PropertiesPanel({
  layer,
  fonts,
  patch,
  onCrop,
}: {
  layer: KnownLayer | undefined;
  fonts: readonly FontRecord[];
  patch: Patch;
  onCrop: () => void;
}) {
  if (!layer)
    return (
      <section className="properties-panel">
        <div className="panel-heading">
          <h2>属性</h2>
        </div>
        <div className="property-empty">
          <span>↖</span>
          <h3>选择一个图层</h3>
          <p>
            调整位置、尺寸和样式
            <br />
            Shift 点击可多选
          </p>
        </div>
      </section>
    );
  const num = (
    name: string,
    key: string,
    value: number,
    min?: number,
    max?: number,
  ) => (
    <Field
      key={`${layer.id}-${key}`}
      name={name}
      value={value}
      min={min}
      max={max}
      onCommit={(n) => patch({ [key]: key === "rotation" ? rotation(n) : n })}
    />
  );
  return (
    <section className="properties-panel">
      <div className="panel-heading">
        <h2>{label(layer)}属性</h2>
        <small>{layer.locked ? "已锁定" : "可编辑"}</small>
      </div>
      <fieldset disabled={layer.locked}>
        <div className="field-grid">
          {num("X 坐标", "x", layer.x)}
          {num("Y 坐标", "y", layer.y)}
          {num("宽度", "width", layer.width, 1)}
          {num("高度", "height", layer.height, 1)}
          {num("旋转角度", "rotation", layer.rotation)}
          {num("透明度", "opacity", layer.opacity, 0, 1)}
        </div>
        {isGroupLayer(layer) &&
          num("组合缩放", "scale", layer.scale ?? 1, 0.01)}
        {layer.type === "image" && (
          <>
            <div className="section-label">照片填充</div>
            <label className="field">
              <span>适配方式</span>
              <select
                aria-label="适配方式"
                value={layer.fitMode ?? "cover"}
                onChange={(e) => patch({ fitMode: e.target.value })}
              >
                <option value="cover">铺满画框 Cover</option>
                <option value="contain">完整显示 Contain</option>
              </select>
            </label>
            <button className="wide" onClick={onCrop}>
              裁剪照片
            </button>
            <p className="panel-hint">
              双击画框也可裁剪。更换照片保留画框位置与旋转。
            </p>
          </>
        )}
        {layer.type === "text" && (
          <>
            <div className="section-label">文字样式</div>
            <label className="field">
              <span>文字内容</span>
              <textarea
                key={`${layer.id}-${layer.text}`}
                aria-label="文字内容"
                defaultValue={layer.text}
                onBlur={(e) => {
                  if (e.target.value !== layer.text)
                    patch({ text: e.target.value });
                }}
              />
            </label>
            <label className="field">
              <span>字体</span>
              <select
                aria-label="字体"
                value={layer.fontAssetId}
                onChange={(e) => patch({ fontAssetId: e.target.value })}
              >
                {fonts.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.family === "Noto Sans SC" ? "思源黑体" : "思源宋体"}
                  </option>
                ))}
              </select>
            </label>
            <div className="field-grid">
              {num("字号", "fontSize", layer.fontSize, 1)}
              <label className="field">
                <span>字重</span>
                <select
                  aria-label="字重"
                  value={layer.fontWeight}
                  onChange={(e) =>
                    patch({ fontWeight: Number(e.target.value) })
                  }
                >
                  <option value={400}>常规 400</option>
                  <option value={700}>粗体 700</option>
                </select>
              </label>
              {num("字距", "letterSpacing", layer.letterSpacing)}
              {num("行距", "lineHeight", layer.lineHeight, 0.1)}
            </div>
            <label className="field">
              <span>文字对齐</span>
              <select
                aria-label="文字对齐"
                value={layer.textAlign ?? "left"}
                onChange={(e) => patch({ textAlign: e.target.value })}
              >
                {["left", "center", "right"].map((v, i) => (
                  <option key={v} value={v}>
                    {["左对齐", "居中", "右对齐", "两端对齐"][i]}
                  </option>
                ))}
              </select>
            </label>
            <label className="color-field">
              文字颜色
              <input
                aria-label="文字颜色"
                type="color"
                value={layer.fill}
                onChange={(e) => patch({ fill: e.target.value })}
              />
            </label>
          </>
        )}
        {layer.type === "shape" && (
          <>
            <div className="section-label">形状样式</div>
            <label className="color-field">
              填充颜色
              <input
                type="color"
                aria-label="填充颜色"
                value={layer.fill}
                onChange={(e) => patch({ fill: e.target.value })}
              />
            </label>
            <label className="color-field">
              描边颜色
              <input
                type="color"
                aria-label="描边颜色"
                value={
                  layer.stroke === "transparent" ? "#000000" : layer.stroke
                }
                onChange={(e) => patch({ stroke: e.target.value })}
              />
            </label>
            {num("描边宽度", "strokeWidth", layer.strokeWidth, 0)}
            {layer.shapeKind === "rectangle" &&
              num("圆角", "radius", layer.radius ?? 0, 0)}
          </>
        )}
      </fieldset>
    </section>
  );
}
