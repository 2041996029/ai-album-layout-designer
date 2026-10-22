import { useEffect, useState } from "react";
import {
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
                preserveAspectRatio="xMidYMid slice"
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
export function TemplatePanel(ctx: LibraryContext) {
  const [category, setCategory] = useState("all"),
    [template, setTemplate] = useState<TemplateVersion>(),
    [bindings, setBindings] = useState<Record<string, string>>({}),
    [error, setError] = useState(""),
    [confirm, setConfirm] = useState(false),
    [message, setMessage] = useState("");
  const assets = ctx.resources.assets.filter(
      (a) => a.status === "ready" && a.license.usable,
    ),
    spread = ctx.doc.spreads.find((s) => s.id === ctx.surfaceId);
  const [urls, setUrls] = useState<string[]>([]);
  const previewIds = assets
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
  function apply() {
    if (!template || !spread) return;
    setError("");
    try {
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
        setConfirm(false);
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
  return (
    <section aria-label="原创模板" className="template-library">
      <div className="panel-heading">
        <h3>风格模板</h3>
        <small>36 套新设计</small>
      </div>
      <p className="panel-hint">
        选择一种气质，让照片自然成册。每款包含可编辑照片与文字。
      </p>
      <label>
        模板分类{" "}
        <select
          aria-label="模板分类"
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            setTemplate(undefined);
            setConfirm(false);
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
          ? "使用已导入照片预览构图；应用时可为每个照片框重新选片。"
          : "导入照片后可查看实片预览；下方为版式示意。"}
      </p>
      <div className="template-grid">
        {[...templateVersions]
          .sort(
            (a, b) =>
              Number(b.id.startsWith("style_")) -
              Number(a.id.startsWith("style_")),
          )
          .filter((t) => category === "all" || t.category === category)
          .map((t) => (
            <button
              key={t.id}
              className={`template-card ${template?.id === t.id ? "is-selected" : ""}`}
              aria-pressed={template?.id === t.id}
              onClick={() => {
                setTemplate(t);
                setBindings({});
                setError("");
                setMessage("");
                setConfirm(false);
              }}
            >
              <Preview template={t} urls={urls} />
              <span className="template-card-title">{t.name}</span>
              <small>
                {t.slots.filter((s) => s.kind === "image").length} 张照片 ·{" "}
                {categories[t.category]}
                {t.id.startsWith("style_") ? "" : " · 旧版"}
              </small>
            </button>
          ))}
      </div>
      {!spread && <p>请选择内页跨页后应用模板。</p>}
      {template && (
        <div aria-label="模板预览">
          <h4>{template.name}</h4>
          <p>
            预览不修改作品；按当前项目尺寸等比适配。
            {template.slots.filter((s) => s.kind === "image").length}{" "}
            个照片槽，标题和日期可编辑。
          </p>
          <p>
            待选照片 {assets.length} 张；已绑定{" "}
            {new Set(Object.values(bindings).filter(Boolean)).size}{" "}
            张，其余照片保留在素材栏，未自动入册。
          </p>
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
                    setConfirm(false);
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
          <p>来源：项目原创几何；无附带第三方照片。字体按 OFL 授权。</p>
          {!confirm ? (
            <button disabled={!spread} onClick={() => setConfirm(true)}>
              应用到当前跨页
            </button>
          ) : (
            <div>
              <p>将替换当前跨页的全部图层，其他跨页不变。</p>
              <button disabled={!spread} onClick={apply}>
                确认替换当前跨页
              </button>
              <button onClick={() => setConfirm(false)}>返回预览</button>
            </div>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
      {message && <p>{message}</p>}
    </section>
  );
}
