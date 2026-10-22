import { useState } from "react";
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
const categories: Record<string, string> = {
  wedding: "婚礼",
  travel: "旅行",
  family: "亲子",
  portrait: "写真",
  ink: "国风",
};
function Preview({ template: t }: { template: TemplateVersion }) {
  return (
    <svg
      aria-label={`${t.name}结构预览`}
      role="img"
      viewBox={`0 0 ${t.pageSize.width * 2} ${t.pageSize.height}`}
      style={{
        width: "100%",
        background: t.background,
        border: "1px solid #d8d3c9",
        margin: "8px 0",
      }}
    >
      {t.slots.map((s) => (
        <rect
          key={s.slotId}
          {...s.frame}
          fill={s.kind === "image" ? "#b7d3ce" : "#708c83"}
          rx="10"
        />
      ))}
      <path
        d={`M${t.pageSize.width} 0V${t.pageSize.height}`}
        stroke="#b0b7af"
        strokeWidth="5"
        strokeDasharray="15 12"
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
          applyTemplateCommand(ctx.surfaceId, layers, {
            id: template.id,
            version: template.version,
            sha256: template.sha256,
          }),
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
    <section aria-label="原创模板" style={{ padding: 16 }}>
      <h3>原创模板</h3>
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
      <div>
        {templateVersions
          .filter((t) => category === "all" || t.category === category)
          .map((t) => (
            <button
              key={t.id}
              style={{
                display: "block",
                width: "100%",
                margin: "8px 0",
                textAlign: "left",
              }}
              onClick={() => {
                setTemplate(t);
                setBindings({});
                setError("");
                setMessage("");
                setConfirm(false);
              }}
            >
              {t.name}
              <Preview template={t} />
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
