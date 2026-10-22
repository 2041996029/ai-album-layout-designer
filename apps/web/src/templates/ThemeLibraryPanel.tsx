import { useEffect, useMemo, useRef, useState } from "react";
import { IndexedDbThemeLibrary } from "@album/storage";
import { isUserPhoto } from "@album/assets";
import type { ConvertedTheme, ImportedTheme } from "@album/template-import";
import type { LibraryContext } from "../editor/TemplatePanel";
import { importTheme } from "./import-controller";
import { ThemePreview } from "./ThemePreview";
const errorText = (error: unknown) => {
  const code = error instanceof Error ? error.message : String(error);
  const messages: Record<string, string> = {
    THEME_CAPACITY_MISMATCH:
      "所选跨页的照片槽总数与已选照片数量不匹配，请调整跨页或照片。",
    PAGE_ASPECT_MISMATCH: "模板与当前作品比例不同，不能直接等比适配。",
    LAYER_LOCKED: "当前跨页包含锁定图层，请先解锁或选择其他跨页。",
    STALE_LAYOUT: "作品已更新，请重新生成并应用。",
    TEMPLATE_BINDING_REQUIRED: "请为所有照片槽选片。",
    DUPLICATE_PHOTO_BINDING: "同一跨页不能重复选入同一张照片。",
    UNSUPPORTED_TEMPLATE_PAGE: "此页包含暂不支持的效果，请查看兼容性报告。",
    STORAGE_FULL: "浏览器空间不足，请清理不再使用的模板后重试。",
  };
  return messages[code] ?? code;
};
export function ThemeLibraryPanel(
  ctx: LibraryContext & { initialTheme?: ConvertedTheme },
) {
  const [importing, setImporting] = useState(false);
  const [library] = useState(() => new IndexedDbThemeLibrary()),
    [themes, setThemes] = useState<ImportedTheme[]>([]),
    [converted, setConverted] = useState<ConvertedTheme>(),
    [pageId, setPageId] = useState(""),
    [selectedPages, setSelectedPages] = useState<string[]>([]),
    [bindings, setBindings] = useState<Record<string, string>>({}),
    [selectedPhotos, setSelectedPhotos] = useState<string[]>([]),
    [urls, setUrls] = useState<Record<string, string>>({}),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(""),
    [error, setError] = useState(""),
    [showConverted, setShowConverted] = useState(false),
    [confirmBook, setConfirmBook] = useState(false);
  const controller = useRef<AbortController | undefined>(undefined),
    sequence = useRef(0);
  const assets = ctx.resources.assets.filter(
    (a) => isUserPhoto(a) && a.status === "ready" && a.license.usable,
  );
  const theme = converted?.theme,
    page = theme?.pages.find((p) => p.id === pageId);
  const refresh = () => library.list().then(setThemes);
  useEffect(() => {
    void refresh().catch((e) => setError(errorText(e)));
    return () => {
      controller.current?.abort();
    };
  }, [library]);
  useEffect(() => {
    const next: Record<string, string> = {};
    if (converted)
      for (const p of converted.theme.pages) {
        const bytes = converted.files.get(p.previewPath);
        if (bytes)
          next[p.id] = URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], {
              type: p.previewPath.endsWith(".svg")
                ? "image/svg+xml"
                : "image/png",
            }),
          );
      }
    setUrls(next);
    return () => Object.values(next).forEach(URL.revokeObjectURL);
  }, [converted]);
  const choose = (value: ConvertedTheme) => {
    setConverted(value);
    setPageId(value.theme.pages[0]?.id ?? "");
    setSelectedPages([]);
    setBindings({});
    setSelectedPhotos(assets.map((a) => a.id));
    setShowConverted(false);
    setConfirmBook(false);
  };
  useEffect(() => {
    if (ctx.initialTheme) choose(ctx.initialTheme);
  }, [ctx.initialTheme]);
  const load = async (id: string) => {
    const token = ++sequence.current;
    setError("");
    try {
      const value = await library.get(id);
      if (sequence.current === token) choose(value);
    } catch (e) {
      setError(errorText(e));
    }
  };
  const onImport = async (file: File) => {
    const token = ++sequence.current;
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    setImporting(true);
    setError("");
    try {
      const value = await importTheme(file, library, abort.signal, setProgress);
      if (token !== sequence.current || abort.signal.aborted) return;
      await refresh();
      choose(value);
      setProgress(
        `已导入「${value.theme.name}」，共 ${value.theme.pages.length} 个版式。`,
      );
    } catch (e) {
      if (!abort.signal.aborted) setError(errorText(e));
      else setProgress("已取消导入，作品未改变。");
    } finally {
      if (token === sequence.current) {
        setBusy(false);
        setImporting(false);
      }
    }
  };
  const apply = async (book: boolean) => {
    if (!converted || !page || !ctx.applyImportedTheme) return;
    setBusy(true);
    setError("");
    try {
      const ids = book ? selectedPages : [page.id];
      if (!ids.length) throw Error("请先选择要用于整本的跨页。");
      if (
        ids.some((id) =>
          theme!.pages
            .find((p) => p.id === id)!
            .issues.some((i) => i.severity === "blocker"),
        )
      )
        throw Error("UNSUPPORTED_TEMPLATE_PAGE");
      const ok = await ctx.applyImportedTheme(
        converted,
        ids,
        book ? selectedPhotos : bindings,
        book,
      );
      if (ok) {
        setProgress(
          book
            ? "已应用整本主题，可以一次撤销。"
            : "已应用当前跨页，可以一次撤销。",
        );
        setConfirmBook(false);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  const slots = useMemo(
    () =>
      selectedPages.reduce(
        (sum, id) =>
          sum + (theme?.pages.find((p) => p.id === id)?.photoSlots.length ?? 0),
        0,
      ),
    [selectedPages, theme],
  );
  return (
    <section className="theme-library" aria-label="我的主题模板">
      <div className="panel-heading">
        <h3>我的主题模板</h3>
        <small>本地私有</small>
      </div>
      <p className="panel-hint">
        导入魔镜设计 .mjtpl，保留整套版式、装饰与照片框。模板不会上传到服务器。
      </p>
      <label className="import-card">
        ＋ 导入 .mjtpl
        <input
          aria-label="导入 MJTPL 模板"
          type="file"
          accept=".mjtpl"
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void onImport(file);
          }}
        />
      </label>
      {importing && (
        <button onClick={() => controller.current?.abort()}>取消导入</button>
      )}
      {progress && <p aria-live="polite">{progress}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="theme-list">
        {themes.map((t) => (
          <div className="theme-list-item" key={t.id}>
            <button
              aria-pressed={theme?.id === t.id}
              onClick={() => void load(t.id)}
              disabled={busy}
            >
              <b>{t.name}</b>
              <small>
                {t.pages.length} 个跨页 ·{" "}
                {t.pages.reduce((n, p) => n + p.photoSlots.length, 0)} 个照片槽
              </small>
            </button>
            <button
              aria-label={`删除主题 ${t.name}`}
              disabled={busy}
              onClick={async () => {
                if (
                  !window.confirm(
                    "仅删除本地模板库中的主题，已应用到作品的素材会保留。",
                  )
                )
                  return;
                try {
                  await library.remove(t.id);
                  if (theme?.id === t.id) setConverted(undefined);
                  await refresh();
                } catch (e) {
                  setError(errorText(e));
                }
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {!themes.length && !theme && !busy && (
        <p className="panel-hint">
          还没有导入模板。导入后可按主题浏览并选择整套跨页。
        </p>
      )}
      {theme && (
        <>
          <h4>{theme.name}</h4>
          <div className="theme-page-grid">
            {theme.pages.map((p, index) => (
              <article key={p.id}>
                <button
                  className={pageId === p.id ? "is-selected" : ""}
                  onClick={() => {
                    setPageId(p.id);
                    setBindings({});
                    setShowConverted(false);
                    setError("");
                  }}
                >
                  <img src={urls[p.id]} alt={`${p.name}源预览`} />
                  <span>
                    {index + 1}. {p.name} · {p.photoSlots.length} 图
                  </span>
                </button>
                <label>
                  <input
                    type="checkbox"
                    aria-label={`加入整本 ${p.name}`}
                    checked={selectedPages.includes(p.id)}
                    onChange={(e) => {
                      setSelectedPages(
                        e.target.checked
                          ? [...selectedPages, p.id]
                          : selectedPages.filter((id) => id !== p.id),
                      );
                      setConfirmBook(false);
                    }}
                  />
                  加入整本
                  {p.issues.some((i) => i.severity === "blocker")
                    ? " · 暂不能应用"
                    : ""}
                </label>
              </article>
            ))}
          </div>
        </>
      )}
      {page && converted && (
        <div className="theme-page-details">
          <h4>
            {page.name} / {page.photoSlots.length} 张照片
          </h4>
          {Math.abs(
            (ctx.doc.pageSize.width * 2) / ctx.doc.pageSize.height -
              page.width / page.height,
          ) > 1e-6 && (
            <div>
              <p>
                此主题比例与当前作品不同。可新建匹配尺寸作品，当前作品将保存并保留。
              </p>
              <button
                disabled={busy}
                onClick={async () => {
                  if (
                    !ctx.createTemplateProject ||
                    !window.confirm(
                      "新建匹配尺寸作品，当前作品会保存保留，照片素材会沿用。",
                    )
                  )
                    return;
                  setBusy(true);
                  try {
                    await ctx.createTemplateProject({
                      width: page.width / 2,
                      height: page.height,
                    });
                  } catch (e) {
                    setError(errorText(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                新建匹配尺寸作品
              </button>
            </div>
          )}
          {!theme?.id.startsWith("original_") && (
            <button onClick={() => setShowConverted((v) => !v)}>
              {showConverted ? "查看源预览" : "查看转换图层预览"}
            </button>
          )}
          {showConverted ? (
            <ThemePreview converted={converted} page={page} />
          ) : (
            <img
              className="theme-large-preview"
              src={urls[page.id]}
              alt={`${page.name}源预览大图`}
            />
          )}
          <details>
            <summary>兼容性报告 · {page.issues.length} 项</summary>
            <p>
              “外观保留”的文字以原始图像显示，可在画布中选择并转为本地字体编辑。
            </p>
            {page.issues.map((i, index) => (
              <p key={index}>
                {i.severity === "blocker" ? "无法应用" : "提示"}：{i.message}
              </p>
            ))}
          </details>
          {page.photoSlots.map((slot, index) => (
            <label className="theme-binding" key={slot.slotId}>
              照片 {index + 1}
              <select
                aria-label={`导入模板照片 ${index + 1}`}
                value={bindings[slot.slotId] ?? ""}
                onChange={(e) =>
                  setBindings({ ...bindings, [slot.slotId]: e.target.value })
                }
              >
                <option value="">请选择用户照片</option>
                {assets.map((a) => (
                  <option value={a.id} key={a.id}>
                    {a.source.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <p className="panel-hint">
            应用会替换当前跨页的图层；源样片不会作为你的选片入册。可以一次撤销。
          </p>
          <button
            className="wide"
            disabled={busy || page.issues.some((i) => i.severity === "blocker")}
            onClick={() => void apply(false)}
          >
            替换当前跨页
          </button>
          <details className="theme-book">
            <summary>使用此主题排整本</summary>
            <p>
              已选择 {selectedPages.length} 个跨页，共 {slots}{" "}
              个照片槽。按勾选先后顺序成册。
            </p>
            <button
              onClick={() =>
                setSelectedPages(
                  theme!.pages
                    .filter(
                      (p) => !p.issues.some((i) => i.severity === "blocker"),
                    )
                    .map((p) => p.id),
                )
              }
            >
              选择全部兼容跨页
            </button>
            <button onClick={() => setSelectedPages([])}>清空跨页</button>
            <ol>
              {selectedPages.map((id) => (
                <li key={id}>{theme!.pages.find((p) => p.id === id)?.name}</li>
              ))}
            </ol>
            <p>
              选入照片 {selectedPhotos.length} / {slots}，按素材顺序排列。
            </p>
            <div className="theme-photo-selection">
              {assets.map((a) => (
                <label key={a.id}>
                  <input
                    type="checkbox"
                    checked={selectedPhotos.includes(a.id)}
                    onChange={(e) =>
                      setSelectedPhotos(
                        e.target.checked
                          ? assets
                              .filter(
                                (v) =>
                                  selectedPhotos.includes(v.id) ||
                                  v.id === a.id,
                              )
                              .map((v) => v.id)
                          : selectedPhotos.filter((id) => id !== a.id),
                      )
                    }
                  />
                  {a.source.name}
                </label>
              ))}
            </div>
            <p className="panel-hint">
              照片数量须与照片槽一致；不自动漏片或重复。已有锁定内容会保留，无法匹配时会提示。未选跨页之外的非空作品页不会被静默删除。
            </p>
            {!confirmBook ? (
              <button
                disabled={busy || !slots || slots !== selectedPhotos.length}
                onClick={() => setConfirmBook(true)}
              >
                预备整本排版
              </button>
            ) : (
              <>
                <p>
                  将按所选跨页替换整本内页，请先备份已有作品。确认后可一次撤销。
                </p>
                <button disabled={busy} onClick={() => void apply(true)}>
                  确认应用整本主题
                </button>
                <button onClick={() => setConfirmBook(false)}>返回</button>
              </>
            )}
          </details>
        </div>
      )}
    </section>
  );
}
