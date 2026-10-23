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
    [strength, setStrength] = useState(65),
    [scope, setScope] = useState("auto");
  const selected = new Set(ctx.selectedIds),
    images = new Map<string, ImageLayer>();
  let hasPhotoSelection = false;
  const collect = (
    layers: import("@album/document").Layer[],
    inheritedSelected = false,
    ancestorLocked = false,
  ) => {
    for (const layer of layers) {
      const locked = ancestorLocked || layer.locked === true,
        chosen = inheritedSelected || selected.has(layer.id);
      if (
        chosen &&
        isImageLayer(layer) &&
        layer.layoutPhotoRole !== "decoration"
      )
        hasPhotoSelection = true;
      if (
        isImageLayer(layer) &&
        layer.layoutPhotoRole !== "decoration" &&
        chosen &&
        !locked
      )
        images.set(layer.id, layer);
      if (isGroupLayer(layer)) collect(layer.children, chosen, locked);
    }
  };
  const allLayers = [
    ...ctx.doc.cover.front,
    ...ctx.doc.cover.back,
    ...ctx.doc.spreads.flatMap((s) => s.layers),
  ];
  collect(allLayers);
  const wholeAlbum = scope === "album" || !hasPhotoSelection;
  if (wholeAlbum) {
    images.clear();
    collect(allLayers, true);
  }
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
      <p className="panel-hint">
        {wholeAlbum ? "整本相册" : "选中照片"} · {images.size}{" "}
        张可编辑照片。锁定照片与装饰不受影响，可一次撤销。
      </p>
      <label>
        应用范围{" "}
        <select
          aria-label="滤镜应用范围"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="auto">自动：选中照片，否则整本</option>
          <option value="album">整本相册</option>
        </select>
      </label>
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
      <p style={{ fontSize: 12 }}>33 种风格 · 点击即应用</p>
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
