import { photoPool, autoBindings } from "./library-photos";
import { isUserPhoto } from "@album/assets";
import { useEffect, useState } from "react";
import {
  walkLayers,
  templateVersions,
  instantiateTemplate,
  applyTemplateCommand,
  validateTemplateBindings,
  type TemplateVersion,
} from "@album/document";
import type { EditorProps } from "./Editor";
import { uid } from "./types";
export type LibraryContext = Parameters<
  NonNullable<EditorProps["renderLibrary"]>
>[0];
import { templateCategories as categories } from "./template-categories";
function Preview({
  template: t,
  urls,
}: {
  template: TemplateVersion;
  urls: string[];
}) {
  let index = 0;
  return (
    <svg
      aria-label={`${t.name}结构预览`}
      role="img"
      viewBox={`0 0 ${t.pageSize.width * 2} ${t.pageSize.height}`}
      className="template-preview"
      style={{ background: t.background }}
    >
      {t.slots.map((s) =>
        s.kind === "image" ? (
          <g key={s.slotId}>
            <rect
              {...s.frame}
              fill={["#d6d0c3", "#b2bcb1", "#c0b2a7", "#9daaaa"][index % 4]}
            />
            {urls.length ? (
              <image
                {...s.frame}
                href={urls[index++ % urls.length]}
                preserveAspectRatio="xMidYMid meet"
              />
            ) : (
              <g>
                <path
                  d={`M${s.frame.x} ${s.frame.y + s.frame.height} L${s.frame.x + s.frame.width * 0.65} ${s.frame.y + s.frame.height * 0.3} L${s.frame.x + s.frame.width} ${s.frame.y + s.frame.height}Z`}
                  fill="#ffffff"
                  opacity=".18"
                />
                <text
                  x={s.frame.x + 24}
                  y={s.frame.y + 40}
                  fontSize="20"
                  fill="#ffffff"
                >
                  {String(++index).padStart(2, "0")}
                </text>
              </g>
            )}
          </g>
        ) : s.kind === "shape" ? (
          s.shapeKind === "ellipse" ? (
            <ellipse
              key={s.slotId}
              cx={s.frame.x + s.frame.width / 2}
              cy={s.frame.y + s.frame.height / 2}
              rx={s.frame.width / 2}
              ry={s.frame.height / 2}
              fill={s.fill}
              stroke={s.stroke}
              strokeWidth={s.strokeWidth}
              opacity={s.opacity ?? 1}
            />
          ) : s.shapeKind === "line" ? (
            <line
              key={s.slotId}
              x1={s.frame.x}
              y1={s.frame.y}
              x2={s.frame.x + s.frame.width}
              y2={s.frame.y + s.frame.height}
              stroke={s.stroke ?? s.fill}
              strokeWidth={s.strokeWidth ?? 1}
              opacity={s.opacity ?? 1}
            />
          ) : (
            <rect
              key={s.slotId}
              {...s.frame}
              rx={s.radius ?? 0}
              fill={s.fill}
              stroke={s.stroke}
              strokeWidth={s.strokeWidth}
              opacity={s.opacity ?? 1}
            />
          )
        ) : (
          <text
            key={s.slotId}
            x={s.frame.x + (s.textAlign === "right" ? s.frame.width : 0)}
            y={s.frame.y + (s.fontSize ?? 24)}
            fontSize={s.fontSize}
            fontWeight={s.fontWeight}
            fill={s.fill ?? "#253d3b"}
            letterSpacing={s.letterSpacing ?? 0}
            textAnchor={s.textAlign === "right" ? "end" : "start"}
            fontFamily={
              s.fontAssetId === "noto-serif-sc"
                ? "Noto Serif SC, serif"
                : "Noto Sans SC, sans-serif"
            }
          >
            {s.defaultText}
          </text>
        ),
      )}
      <path
        d={`M${t.pageSize.width} 0V${t.pageSize.height}`}
        stroke="#777"
        opacity=".12"
        strokeWidth="2"
      />
    </svg>
  );
}
export function TemplatePanel(
  ctx: LibraryContext & {
    onUseCollection?: (themeId: string) => void;
    pending?: boolean;
  },
) {
  const [query, setQuery] = useState("");
  const [series, setSeries] = useState("themes");
  const [category, setCategory] = useState("all"),
    [template, setTemplate] = useState<TemplateVersion>(),
    [bindings, setBindings] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const assets = ctx.resources.assets.filter(
      (a) => isUserPhoto(a) && a.status === "ready" && a.license.usable,
    ),
    spread = ctx.doc.spreads.find((s) => s.id === ctx.surfaceId);
  const pool = photoPool(
    assets,
    [
      ...ctx.doc.cover.front,
      ...ctx.doc.cover.back,
      ...ctx.doc.spreads.flatMap((s) => s.layers),
    ],
    ctx.selectedIds,
    ctx.selectedPhotoIds,
  );
  const themeGroups = [
    ...new Set(
      templateVersions.filter((t) => t.themeId).map((t) => t.themeId!),
    ),
  ].map((id) => templateVersions.filter((t) => t.themeId === id));
  const [urls, setUrls] = useState<string[]>([]);
  const previewIds = pool
    .slice(0, 4)
    .map((a) => a.id)
    .join("|");
  useEffect(() => {
    let active = true;
    const owned: string[] = [];
    setUrls([]);
    void Promise.all(
      previewIds
        ? previewIds.split("|").map(async (id) => {
            try {
              const bytes = await ctx.port.read(id, "preview");
              const url = URL.createObjectURL(
                new Blob([new Uint8Array(bytes)], { type: "image/png" }),
              );
              owned.push(url);
              return url;
            } catch {
              return "";
            }
          })
        : [],
    ).then((values) => {
      if (active) setUrls(values.filter(Boolean));
      else owned.forEach(URL.revokeObjectURL);
    });
    return () => {
      active = false;
      owned.forEach(URL.revokeObjectURL);
    };
  }, [previewIds, ctx.port]);
  function apply(chosen = template, assigned = bindings) {
    const template = chosen,
      bindings = assigned;
    if (!template || !spread) return;
    setError("");
    try {
      if ([...walkLayers(spread.layers)].some((l) => l.locked))
        throw new Error("当前跨页有锁定内容，请先解锁或选择其他跨页。");
      const scale = ctx.doc.pageSize.width / template.pageSize.width;
      if (
        Math.abs(scale - ctx.doc.pageSize.height / template.pageSize.height) >
        1e-8
      )
        throw new Error("模板与当前项目的长宽比不同，无法等比适配。");
      validateTemplateBindings(template, bindings, {
        assetIds: assets.map((a) => a.id),
        fontIds: ctx.resources.fonts
          .filter((f) => f.status === "ready" && f.license.usable)
          .map((f) => f.id),
      });
      const layers = instantiateTemplate(template, bindings, () =>
        uid("template"),
      ).map((layer) => {
        const next = {
          ...layer,
          x: Number(layer.x) * scale,
          y: Number(layer.y) * scale,
          width: Number(layer.width) * scale,
          height: Number(layer.height) * scale,
        };
        return layer.type === "text"
          ? {
              ...next,
              fontSize: Number(layer.fontSize) * scale,
              letterSpacing: Number(layer.letterSpacing) * scale,
            }
          : layer.type === "shape"
            ? {
                ...next,
                strokeWidth: Number(layer.strokeWidth) * scale,
                ...(layer.radius === undefined
                  ? {}
                  : { radius: Number(layer.radius) * scale }),
              }
            : next;
      });
      if (
        ctx.execute(
          applyTemplateCommand(
            ctx.surfaceId,
            layers,
            {
              id: template.id,
              version: template.version,
              sha256: template.sha256,
            },
            template.background,
          ),
        )
      ) {
        setMessage("已应用到当前跨页；可一次撤销。原片保持在照片素材中。");
      }
    } catch (e) {
      const code = (e as Error).message;
      setError(
        (
          {
            TEMPLATE_BINDING_REQUIRED: "请为每个照片槽选择照片。",
            ASSET_MISSING: "绑定照片不可用，请重新选择。",
            FONT_UNAVAILABLE: "模板字体尚未就绪。",
          } as Record<string, string>
        )[code] ?? code,
      );
    }
  }
  function choose(t: TemplateVersion) {
    const next = autoBindings(
      t.slots.filter((s) => s.kind === "image").map((s) => s.slotId),
      pool,
    );
    setTemplate(t);
    setBindings(next);
    setError("");
    setMessage("");
    if (
      Object.keys(next).length <
      t.slots.filter((s) => s.kind === "image").length
    ) {
      setError("照片不足，请先导入更多照片，或选择图数较少的版式。");
      return;
    }
    apply(t, next);
  }
  const family = (t: TemplateVersion) =>
    t.themeId ??
    (t.id.startsWith("style_") ? t.id.replace(/_\d+$/u, "") : t.id);
  const basicGroups = [
    ...new Set(templateVersions.filter((t) => !t.themeId).map(family)),
  ].map((id) => templateVersions.filter((t) => !t.themeId && family(t) === id));
  const basic = basicGroups.map(
    (group) =>
      [...group].sort((a, b) => {
        const ac = a.slots.filter((s) => s.kind === "image").length,
          bc = b.slots.filter((s) => s.kind === "image").length;
        return (
          (ac <= pool.length ? Math.abs(pool.length - ac) : 1000 + ac) -
          (bc <= pool.length ? Math.abs(pool.length - bc) : 1000 + bc)
        );
      })[0],
  );
  const visible =
    series === "basic"
      ? basic
      : [
          ...themeGroups.map((group) => group[0]),
          ...(series === "all" ? basic : []),
        ];
  const sourcePageId =
    (spread?.importedTemplate as { pageId?: string } | undefined)?.pageId ??
    spread?.templateRef?.id;
  const appliedTemplate = templateVersions.find((t) => t.id === sourcePageId);
  const appliedFamily = appliedTemplate ? family(appliedTemplate) : undefined;
  const matches = visible.filter(
    (t) =>
      (category === "all" || t.category === category) &&
      `${t.collectionName ?? t.name} ${categories[t.category]}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return (
    <section aria-label="原创模板" className="template-library">
      <div className="panel-heading">
        <h3>风格模板</h3>
        <small>12 主题 · 96 跨页</small>
      </div>
      <p className="panel-hint">
        选择风格，系统自动选版、填片。每套包含不同图数的可编辑版式。
      </p>
      <label className="library-search">
        <span>搜索风格</span>
        <input
          type="search"
          aria-label="搜索模板"
          placeholder="搜索日系、JK、旗袍…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <label>
        模板系列
        <select
          aria-label="模板系列"
          value={series}
          onChange={(e) => {
            setSeries(e.target.value);
            setTemplate(undefined);
          }}
        >
          <option value="all">全部模板</option>
          <option value="themes">主题套装 · 96 跨页</option>
          <option value="basic">基础模板 · 自动匹配图数</option>
        </select>
      </label>
      <label>
        模板分类{" "}
        <select
          aria-label="模板分类"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setTemplate(undefined);
          }}
        >
          <option value="all">全部</option>
          {Object.entries(categories).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <p className="panel-hint">
        {urls.length
          ? "点击主题，自动匹配版式并填入照片；可随时撤销。"
          : "导入照片后可查看实片预览；下方为版式示意。"}
      </p>
      {template && (
        <button className="wide" onClick={() => setTemplate(undefined)}>
          ← 返回全部主题
        </button>
      )}
      <div className="template-grid" hidden={Boolean(template)}>
        {matches.map((t) => (
          <button
            key={t.id}
            disabled={ctx.pending}
            className={`template-card ${family(t) === appliedFamily ? "is-selected" : ""}`}
            aria-pressed={family(t) === appliedFamily}
            onClick={() => {
              if (t.collectionName && ctx.onUseCollection) {
                void ctx.onUseCollection(t.themeId!);
                return;
              }
              const group = t.themeId
                ? templateVersions.filter((v) => v.themeId === t.themeId)
                : templateVersions.filter((v) => family(v) === family(t));
              const fitting = group.filter(
                (v) =>
                  v.slots.filter((s) => s.kind === "image").length <=
                  pool.length,
              );
              const target =
                [...fitting].sort(
                  (a, b) =>
                    Math.abs(
                      a.slots.filter((s) => s.kind === "image").length -
                        pool.length,
                    ) -
                    Math.abs(
                      b.slots.filter((s) => s.kind === "image").length -
                        pool.length,
                    ),
                )[0] ?? t;
              choose(target);
            }}
          >
            <Preview template={t} urls={urls} />
            <span className="template-card-title">
              {t.collectionName ??
                t.name.replace(/\/\s*[1-4]图.*$/u, "").trim()}
            </span>
            <small>
              {family(t) === appliedFamily ? "✓ 当前跨页使用 · " : ""}
              {t.collectionName
                ? "8 种跨页版式 · 自动成册 · "
                : `${t.slots.filter((s) => s.kind === "image").length} 张照片 · `}
              {categories[t.category]}
              {t.id.startsWith("style_") || t.themeId ? "" : " · 旧版"}
            </small>
          </button>
        ))}
      </div>
      {!matches.length && !template && (
        <div className="library-empty">
          <b>没有匹配的模板</b>
          <p>试试其他风格或清空筛选。</p>
          <button
            onClick={() => {
              setQuery("");
              setCategory("all");
            }}
          >
            清空模板筛选
          </button>
        </div>
      )}
      {!spread && <p>请选择内页跨页后应用模板。</p>}
      {template && (
        <div aria-label="模板预览">
          <h4>{template.collectionName ?? template.name}</h4>
          {(template.themeId || template.id.startsWith("style_")) && (
            <div className="theme-variants" aria-label="主题内版式">
              {templateVersions
                .filter((t) => family(t) === family(template))
                .map((t) => (
                  <button
                    key={t.id}
                    aria-pressed={template.id === t.id}
                    onClick={() => choose(t)}
                  >
                    <Preview template={t} urls={urls} />
                    <span>
                      {t.slots.filter((s) => s.kind === "image").length} 图 ·{" "}
                      {t.name.split(" / ")[1] ?? t.pageOrder}
                    </span>
                  </button>
                ))}
            </div>
          )}
          {template.themeId && ctx.onUseCollection && (
            <button
              className="wide"
              onClick={() => ctx.onUseCollection!(template.themeId!)}
            >
              使用整套主题（8 跨页）
            </button>
          )}
          <p className="panel-hint">
            系统从 {pool.length} 张照片中自动填入 {Object.keys(bindings).length}{" "}
            张，其余照片保留在素材栏。点击内部版式即可切换，支持一次撤销。
          </p>
          <details>
            <summary>调整照片</summary>
            {template.slots
              .filter((s) => s.kind === "image")
              .map((s) => (
                <label
                  key={s.slotId}
                  style={{ display: "block", marginBottom: 8 }}
                >
                  {s.slotId}{" "}
                  <select
                    aria-label={`模板照片 ${s.slotId}`}
                    value={bindings[s.slotId] ?? ""}
                    onChange={(e) => {
                      setBindings({ ...bindings, [s.slotId]: e.target.value });
                    }}
                  >
                    <option value="">请选择照片</option>
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.source.name}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            <button disabled={!spread} onClick={() => apply()}>
              应用调整
            </button>
          </details>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p>{message}</p>}
    </section>
  );
}
