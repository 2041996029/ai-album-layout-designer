import { filterPreviews } from "./filter-previews";
import { useEffect, useRef, useState } from "react";
import {
  isImageLayer,
  isGroupLayer,
  type ImageLayer,
  type FilterRef,
} from "@album/document";
import { recipes } from "@album/render";
import type { LibraryContext } from "./TemplatePanel";
export function FilterPanel(ctx: LibraryContext & { active?: boolean }) {
  const [category, setCategory] = useState("全部"),
    [strength, setStrength] = useState(65),
    [scope, setScope] = useState("auto");
  const [query, setQuery] = useState(""),
    [previews, setPreviews] = useState<Record<string, string>>({}),
    [notice, setNotice] = useState("");
  const previewSource = useRef<string | undefined>(undefined);
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
  const values = [...images.values()];
  const selectedFilters = values.map((image) => image.filter);
  const common =
    values.length &&
    selectedFilters.every((f) => f?.presetId === selectedFilters[0]?.presetId)
      ? selectedFilters[0]?.presetId
      : undefined;
  const strengths = [
    ...new Set(selectedFilters.filter(Boolean).map((f) => f!.strength)),
  ];
  const filterKey = values
    .map(
      (image) =>
        `${image.id}:${image.filter?.presetId ?? "original"}:${image.filter?.strength ?? ""}`,
    )
    .join("|");
  useEffect(() => {
    if (strengths.length === 1) setStrength(Math.round(strengths[0] * 100));
  }, [filterKey]);
  const previewId =
    values[0]?.assetId ??
    ctx.resources.assets.find(
      (a) =>
        (a.usage === "photo" || !a.usage) &&
        a.status === "ready" &&
        a.license.usable,
    )?.id;
  useEffect(() => {
    if (ctx.active === false) return;
    if (!previewId) {
      setPreviews({});
      previewSource.current = undefined;
      return;
    }
    if (previewSource.current === previewId) return;
    let active = true;
    setPreviews({});
    void filterPreviews(ctx.port, previewId)
      .then((value) => {
        if (active) {
          setPreviews(value);
          previewSource.current = previewId;
        }
      })
      .catch(() => {
        if (active) setPreviews({});
      });
    return () => {
      active = false;
    };
  }, [previewId, ctx.port, ctx.active]);
  function update(factory: (image: ImageLayer) => FilterRef | null) {
    if (!images.size) return;
    const result = ctx.execute({
      type: "batch",
      commands: [...images.values()].map((image) => ({
        type: "update-layer",
        layerId: image.id,
        patch: { filter: factory(image) },
      })),
    });
    if (result !== false) setNotice(`已应用 · ${images.size} 张 · 可撤销`);
  }
  return (
    <section aria-label="照片滤镜" className="filter-library">
      <div className="panel-heading">
        <h3>照片滤镜</h3>
        <small>33 种风格</small>
      </div>
      <label className="library-search">
        <span>搜索滤镜</span>
        <input
          type="search"
          aria-label="搜索滤镜"
          placeholder="搜索名称或编号"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <p className="filter-target" title="锁定照片与装饰不受影响，可一次撤销。">
        {wholeAlbum ? "整本相册" : "选中照片"} · {images.size} 张可编辑照片
      </p>
      {!images.size && (
        <p className="library-empty">
          先把照片加入相册，再选择滤镜。锁定照片请先解锁。
        </p>
      )}
      <label>
        应用范围{" "}
        <select
          aria-label="滤镜应用范围"
          value={scope}
          onChange={(e) => setScope(e.target.value)}
        >
          <option value="auto">自动（选中优先）</option>
          <option value="album">整本相册</option>
        </select>
      </label>
      <div className="filter-quick-controls">
        <label>
          分类{" "}
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
        </label>{" "}
        <button
          className="filter-original"
          aria-label="原图（移除滤镜）"
          aria-pressed={!!values.length && selectedFilters.every((f) => !f)}
          disabled={!images.size}
          onClick={() => update(() => null)}
        >
          原图
        </button>
      </div>
      <div className="filter-strength-control">
        <label>
          <span>强度 {strengths.length > 1 ? "混合" : `${strength}%`}</span>
          <input
            aria-label="滤镜强度"
            type="range"
            disabled={!selectedFilters.some(Boolean)}
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
      </div>
      <p className="panel-hint">
        {previewId ? "实片预览 · 点击即应用" : "导入照片后显示实片预览"}
        {values.length > 1 && !common && selectedFilters.some(Boolean)
          ? " · 当前为混合滤镜"
          : ""}
      </p>
      {notice && (
        <p className="filter-notice" aria-live="polite">
          {notice}
        </p>
      )}
      <div className="filter-grid">
        {recipes
          .filter(
            (r) =>
              (category === "全部" || r.category === category) &&
              `${r.id} ${r.name}`
                .toLowerCase()
                .includes(query.trim().toLowerCase()),
          )
          .map((r) => (
            <button
              key={r.id}
              className="filter-card"
              aria-pressed={common === r.id}
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
              {previews[r.id] && (
                <img src={previews[r.id]} alt="" loading="lazy" />
              )}
              <span>
                {r.id} {r.name}
              </span>
              {common === r.id && <small>✓ 已应用</small>}
            </button>
          ))}
      </div>
      {!recipes.some(
        (r) =>
          (category === "全部" || r.category === category) &&
          `${r.id} ${r.name}`
            .toLowerCase()
            .includes(query.trim().toLowerCase()),
      ) && (
        <div className="library-empty">
          没有匹配的滤镜
          <button
            onClick={() => {
              setQuery("");
              setCategory("全部");
            }}
          >
            清空滤镜筛选
          </button>
        </div>
      )}
    </section>
  );
}
