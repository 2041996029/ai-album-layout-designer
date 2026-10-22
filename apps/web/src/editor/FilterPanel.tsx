import { useState } from "react";
import {
  isImageLayer,
  isGroupLayer,
  type ImageLayer,
  type FilterRef,
} from "@album/document";
import { recipes } from "@album/render";
import type { LibraryContext } from "./TemplatePanel";
export function FilterPanel(ctx: LibraryContext) {
  const [category, setCategory] = useState("全部"),
    [strength, setStrength] = useState(65);
  const selected = new Set(ctx.selectedIds),
    images = new Map<string, ImageLayer>();
  const collect = (
    layers: import("@album/document").Layer[],
    inheritedSelected = false,
    ancestorLocked = false,
  ) => {
    for (const layer of layers) {
      const locked = ancestorLocked || layer.locked === true,
        chosen = inheritedSelected || selected.has(layer.id);
      if (isImageLayer(layer) && chosen && !locked) images.set(layer.id, layer);
      if (isGroupLayer(layer)) collect(layer.children, chosen, locked);
    }
  };
  collect([
    ...ctx.doc.cover.front,
    ...ctx.doc.cover.back,
    ...ctx.doc.spreads.flatMap((s) => s.layers),
  ]);
  function update(factory: (image: ImageLayer) => FilterRef | null) {
    if (!images.size) return;
    ctx.execute({
      type: "batch",
      commands: [...images.values()].map((image) => ({
        type: "update-layer",
        layerId: image.id,
        patch: { filter: factory(image) },
      })),
    });
  }
  return (
    <section aria-label="照片滤镜" style={{ padding: 16 }}>
      <h3>照片滤镜</h3>
      <p>选中 {images.size} 个可编辑照片图层，文字和形状不受影响。</p>
      <button disabled={!images.size} onClick={() => update(() => null)}>
        原图（移除滤镜）
      </button>
      <label style={{ display: "block", margin: "12px 0" }}>
        滤镜分类{" "}
        <select
          aria-label="滤镜分类"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          {["全部", ...new Set(recipes.map((r) => r.category ?? "其他"))].map(
            (c) => (
              <option key={c}>{c}</option>
            ),
          )}
        </select>
      </label>
      <label>
        滤镜强度 {strength}%{" "}
        <input
          aria-label="滤镜强度"
          type="range"
          min="0"
          max="100"
          value={strength}
          onChange={(e) => setStrength(Number(e.target.value))}
          onPointerUp={() =>
            update((image) =>
              image.filter
                ? { ...image.filter, strength: strength / 100 }
                : null,
            )
          }
          onKeyUp={(e) => {
            if (
              [
                "ArrowLeft",
                "ArrowRight",
                "Home",
                "End",
                "PageUp",
                "PageDown",
              ].includes(e.key)
            )
              update((image) =>
                image.filter
                  ? { ...image.filter, strength: strength / 100 }
                  : null,
              );
          }}
        />
      </label>
      <p style={{ fontSize: 12 }}>33 种预设 · 视觉风格待最终确认</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
        {recipes
          .filter((r) => category === "全部" || r.category === category)
          .map((r) => (
            <button
              key={r.id}
              disabled={!images.size}
              title={`${r.name} · 默认强度 ${Math.round(r.defaultStrength * 100)}%`}
              onClick={() => {
                setStrength(Math.round(r.defaultStrength * 100));
                update(() => ({
                  presetId: r.id,
                  recipeVersion: r.recipeVersion,
                  strength: r.defaultStrength,
                  seed: r.seed,
                }));
              }}
            >
              {r.id} {r.name}
            </button>
          ))}
      </div>
    </section>
  );
}
