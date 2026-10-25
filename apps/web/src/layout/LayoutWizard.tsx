import { originalThemeBundle } from "../templates/original-theme";
import { planThemeBook } from "../templates/auto-book";
import { IndexedDbThemeLibrary } from "@album/storage";
import type { ConvertedTheme, ImportedTheme } from "@album/template-import";
import { generateThemeCandidates } from "@album/layout";
import { isUserPhoto } from "@album/assets";
import { templateCategories } from "../editor/template-categories";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  canonicalJson,
  templateVersions,
  type DocumentModel,
  type DocumentCommand,
} from "@album/document";
import {
  createLayoutCommand,
  type LayoutInput,
  type LayoutCandidate,
} from "@album/layout";
import type { ResourceManifest, ResourcePort } from "@album/assets";
import { Modal } from "../components/Modal";
import { AssetPreview } from "../editor/AssetPanel";
import { CandidateComparison } from "./CandidateComparison";
import { computeLayouts } from "./layout-controller";
export function LayoutWizard({
  doc,
  resources,
  port,
  revisionToken,
  onClose,
  onApply,
  selectedPhotoIds,
}: {
  doc: DocumentModel;
  resources: ResourceManifest;
  port: ResourcePort;
  revisionToken: number;
  onClose: () => void;
  onApply: (
    command: DocumentCommand,
    theme?: ConvertedTheme,
  ) => boolean | Promise<boolean>;
  selectedPhotoIds?: string[];
}) {
  const [baseline] = useState(() => ({
    doc: structuredClone(doc),
    token: revisionToken,
  }));
  const [ids, setIds] = useState(() =>
    resources.assets
      .filter((a) => isUserPhoto(a) && a.status === "ready" && a.license.usable)
      .map((a) => a.id),
  );
  const [selected, setSelected] = useState(
      () =>
        new Set(
          selectedPhotoIds !== undefined
            ? ids.filter((id) => selectedPhotoIds.includes(id))
            : ids,
        ),
    ),
    [repeat, setRepeat] = useState<string[]>([]),
    [required, setRequired] = useState<string[]>([]);
  const [count, setCount] = useState(doc.spreads.length),
    [min, setMin] = useState(2),
    [max, setMax] = useState(4),
    [templateId, setTemplate] = useState("tpl_travel");
  const [selectionPolicy, setSelectionPolicy] = useState<
      "all" | "allowSelection"
    >("all"),
    [repeatEnabled, setRepeatEnabled] = useState(false),
    [orderPolicy, setOrder] = useState<"user" | "captureTime">("user");
  const [locks, setLocks] = useState<string[]>([]),
    [targets, setTargets] = useState(() => doc.spreads.map((s) => s.id));
  const [candidates, setCandidates] = useState<LayoutCandidate[]>([]),
    [chosen, setChosen] = useState(0),
    [input, setInput] = useState<LayoutInput>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [activeTheme, setActiveTheme] = useState<ConvertedTheme>();
  const previewResources = useMemo(
    () => ({
      assets: [
        ...resources.assets,
        ...(activeTheme?.theme.resources.assets ?? []).filter(
          (a) => !resources.assets.some((v) => v.id === a.id),
        ),
      ],
      fonts: [
        ...resources.fonts,
        ...(activeTheme?.theme.resources.fonts ?? []).filter(
          (a) => !resources.fonts.some((v) => v.id === a.id),
        ),
      ],
    }),
    [activeTheme, resources],
  );
  const previewPort = useMemo<ResourcePort>(
    () => ({
      read: async (id, variant) =>
        activeTheme?.files.get(`${id}:${variant}`) ?? port.read(id, variant),
    }),
    [activeTheme, port],
  );
  const [privateThemes, setPrivateThemes] = useState<ImportedTheme[]>([]);
  useEffect(() => {
    let live = true;
    void new IndexedDbThemeLibrary()
      .list()
      .then((items) => {
        if (live) setPrivateThemes(items);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const controller = useRef<AbortController | undefined>(undefined),
    sequence = useRef(0);
  const stale =
    canonicalJson(doc) !== canonicalJson(baseline.doc) ||
    revisionToken !== baseline.token;
  useEffect(() => () => controller.current?.abort(), []);
  const invalidate = () => {
    sequence.current++;
    controller.current?.abort();
    setBusy(false);
    setCandidates([]);
    setActiveTheme(undefined);
    setError("");
  };
  const generate = async (chosenTemplate = templateId) => {
    invalidate();
    const token = sequence.current,
      abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    const t = templateVersions.find((t) => t.id === chosenTemplate);
    const photos = ids
      .filter((id) => selected.has(id))
      .map((id) => {
        const a = resources.assets.find((a) => a.id === id)!;
        return { assetId: id, width: a.width, height: a.height };
      });
    const next: LayoutInput = {
      projectId: baseline.doc.projectId,
      baseRevision: baseline.doc.revision,
      photos,
      constraints: {
        spreadCount: count,
        minPhotosPerSpread: min,
        maxPhotosPerSpread: max,
        selectionPolicy,
        duplicatePolicy: repeatEnabled ? "allowExplicit" : "forbid",
        orderPolicy,
        requiredAssetIds: required.filter((id) => selected.has(id)),
        explicitRepeatAssetIds: repeatEnabled
          ? repeat.filter((id) => selected.has(id))
          : [],
        lockedSpreadIds: locks,
        ...(targets.length !== baseline.doc.spreads.length
          ? { targetSpreadIds: targets }
          : {}),
      },
      templateRef: t
        ? { id: t.id, version: t.version, sha256: t.sha256 }
        : { id: chosenTemplate, version: 1, sha256: "0".repeat(64) },
      algorithmVersion: "local-layout-v1",
      seed: 1,
    };
    try {
      let result: LayoutCandidate[];
      let bundleForPreview: ConvertedTheme | undefined;
      if (t?.collectionName || chosenTemplate.startsWith("private:")) {
        const bundle = t?.collectionName
          ? await originalThemeBundle(t.themeId!, resources)
          : await new IndexedDbThemeLibrary().get(chosenTemplate.slice(8));
        bundleForPreview = bundle;
        const pages = planThemeBook(bundle.theme.pages, photos.length);
        const counts = pages.map(
          (id) =>
            bundle.theme.pages.find((p) => p.id === id)!.photoSlots.length,
        );
        next.templateRef = {
          id: bundle.theme.id,
          version: 1,
          sha256: bundle.theme.sourceHash,
        };
        next.templatePageIds = pages;
        next.constraints = {
          ...next.constraints,
          spreadCount: pages.length,
          minPhotosPerSpread: Math.min(...counts),
          maxPhotosPerSpread: Math.max(...counts),
          lockedSpreadIds: locks,
        };
        delete next.constraints.targetSpreadIds;
        result = await generateThemeCandidates(
          next,
          baseline.doc,
          bundle.theme,
          pages,
          { replaceBook: true },
        );
      } else
        result = await computeLayouts(next, baseline.doc, t!, abort.signal);
      if (sequence.current !== token || abort.signal.aborted) return;
      setActiveTheme(bundleForPreview);
      setInput(next);
      setCandidates(result);
      setChosen(0);
      if (!result.length)
        setError(
          "没有满足全部约束的方案。请检查锁定内容或调整照片数量、页数和容量。",
        );
    } catch (e) {
      if (!abort.signal.aborted && sequence.current === token)
        setError(e instanceof Error ? e.message : "排版失败，请重试。");
    } finally {
      if (sequence.current === token) setBusy(false);
    }
  };
  const toggle = (list: string[], id: string) =>
    list.includes(id) ? list.filter((v) => v !== id) : [...list, id];
  return (
    <Modal
      label="整本智能排版"
      className="layout-modal"
      onDismiss={() => {
        controller.current?.abort();
        onClose();
      }}
      initialFocus='select[aria-label="选择模板"]'
    >
      <header className="layout-heading">
        <div>
          <small>LOCAL LAYOUT · C2</small>
          <h2>让照片，成为一本故事</h2>
          <p>本地规则排版 · 不上传照片 · 不消耗 AI 点数</p>
        </div>
        <button onClick={onClose} aria-label="关闭">
          ×
        </button>
      </header>
      {stale && (
        <p role="alert">项目已有更新，当前方案已失效。请关闭后重新排版。</p>
      )}
      <div className="layout-body">
        <section className="layout-settings">
          <h3>01 / 排版规则</h3>
          <fieldset disabled={busy || stale} onChange={invalidate}>
            <label>
              选择模板
              <select
                aria-label="选择模板"
                value={templateId}
                onChange={(e) => {
                  e.stopPropagation();
                  setTemplate(e.target.value);
                  void generate(e.target.value);
                }}
              >
                {Object.entries(templateCategories).map(([category, label]) => (
                  <optgroup key={category} label={label}>
                    {templateVersions
                      .filter(
                        (t) =>
                          t.category === category &&
                          (t.collectionName
                            ? t.pageOrder === 1
                            : t.id.startsWith("style_")
                              ? templateVersions.find(
                                  (v) =>
                                    v.id.replace(/_\d+$/u, "") ===
                                    t.id.replace(/_\d+$/u, ""),
                                )?.id === t.id
                              : !t.themeId ||
                                templateVersions.find(
                                  (v) => v.themeId === t.themeId,
                                )?.id === t.id),
                      )
                      .map((t) => (
                        <option value={t.id} key={t.id}>
                          {t.collectionName ??
                            t.name.replace(/\/\s*[1-4]图.*$/u, "").trim()}
                        </option>
                      ))}
                  </optgroup>
                ))}
                {privateThemes.length > 0 && (
                  <optgroup label="我的模板">
                    {privateThemes.map((t) => (
                      <option key={t.id} value={`private:${t.id}`}>
                        {t.name}
                      </option>
                    ))}
                  </optgroup>
                )}
              </select>
            </label>
            <p>
              选择主题后，系统自动分配全部选中照片与跨页；图数变体由系统选择。
            </p>
            <div
              className="layout-numbers"
              hidden={Boolean(
                templateVersions.find((t) => t.id === templateId)
                  ?.collectionName || templateId.startsWith("private:"),
              )}
            >
              <label>
                跨页数量
                <input
                  aria-label="跨页数量"
                  type="number"
                  min="1"
                  max="50"
                  value={count}
                  onChange={(e) => setCount(e.target.valueAsNumber)}
                />
              </label>
              <label>
                每跨页最少照片
                <input
                  aria-label="每跨页最少照片"
                  type="number"
                  min="0"
                  max="100"
                  value={min}
                  onChange={(e) => setMin(e.target.valueAsNumber)}
                />
              </label>
              <label>
                每跨页最多照片
                <input
                  aria-label="每跨页最多照片"
                  type="number"
                  min="1"
                  max="100"
                  value={max}
                  onChange={(e) => setMax(e.target.valueAsNumber)}
                />
              </label>
            </div>
            <label>
              照片顺序
              <select
                value={orderPolicy}
                onChange={(e) => setOrder(e.target.value as typeof orderPolicy)}
              >
                <option value="user">按下方用户顺序</option>
                <option value="captureTime">按拍摄时间</option>
              </select>
            </label>
            {orderPolicy === "captureTime" && (
              <p>当前导入未保存拍摄时间，将保持用户顺序；不会推断时间。</p>
            )}
            <label>
              选片策略
              <select
                value={selectionPolicy}
                onChange={(e) =>
                  setSelectionPolicy(e.target.value as typeof selectionPolicy)
                }
              >
                <option value="all">全部选中照片必须使用</option>
                <option value="allowSelection">允许留下可选照片</option>
              </select>
            </label>
            <label className="layout-check">
              <input
                type="checkbox"
                checked={repeatEnabled}
                onChange={(e) => setRepeatEnabled(e.target.checked)}
              />
              允许明确勾选的照片重复
            </label>
            <details>
              <summary>局部重排与锁定</summary>
              <p>已有图层锁定自动保留。调整总页数时请使用整本范围。</p>
              <button
                type="button"
                onClick={() => {
                  setTargets(baseline.doc.spreads.map((s) => s.id));
                  invalidate();
                }}
              >
                全选重排跨页
              </button>
              <button
                type="button"
                onClick={() => {
                  setTargets([]);
                  invalidate();
                }}
              >
                清空重排跨页
              </button>
              {baseline.doc.spreads.map((s, i) => (
                <div className="layout-scope" key={s.id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={targets.includes(s.id)}
                      onChange={() => setTargets(toggle(targets, s.id))}
                    />
                    重排跨页 {i + 1}
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={locks.includes(s.id)}
                      onChange={() => setLocks(toggle(locks, s.id))}
                    />
                    锁定整页
                  </label>
                </div>
              ))}
            </details>
          </fieldset>
          <h3>
            02 / 照片与顺序 <small>{selected.size} 张选中</small>
          </h3>
          <button
            disabled={busy}
            onClick={() => {
              invalidate();
              setSelected(new Set(ids));
            }}
          >
            全选照片
          </button>
          <button
            disabled={busy}
            onClick={() => {
              invalidate();
              setSelected(new Set());
            }}
          >
            清空选片
          </button>
          <button
            disabled={busy}
            onClick={() => {
              invalidate();
              setSelected(new Set(ids.filter((id) => !selected.has(id))));
            }}
          >
            反选照片
          </button>
          <div className="layout-photo-list">
            {ids.map((id, index) => {
              const asset = resources.assets.find((a) => a.id === id)!;
              return (
                <div className="layout-photo-row" key={id}>
                  <label>
                    <input
                      type="checkbox"
                      checked={selected.has(id)}
                      disabled={busy}
                      onChange={() => {
                        invalidate();
                        setSelected(new Set(toggle([...selected], id)));
                      }}
                    />
                    <AssetPreview asset={asset} port={port} />
                    <span>
                      {index + 1}. {asset.source.name}
                    </span>
                  </label>
                  <button
                    aria-label={`上移照片 ${index + 1}`}
                    disabled={busy || index === 0}
                    onClick={() => {
                      invalidate();
                      const next = [...ids];
                      [next[index - 1], next[index]] = [
                        next[index],
                        next[index - 1],
                      ];
                      setIds(next);
                    }}
                  >
                    ↑
                  </button>
                  <label>
                    <input
                      type="checkbox"
                      checked={required.includes(id)}
                      disabled={busy || !selected.has(id)}
                      onChange={() => {
                        invalidate();
                        setRequired(toggle(required, id));
                      }}
                    />
                    必选
                  </label>
                  {repeatEnabled && (
                    <label>
                      <input
                        type="checkbox"
                        checked={repeat.includes(id)}
                        disabled={busy || !selected.has(id)}
                        onChange={() => {
                          invalidate();
                          setRepeat(toggle(repeat, id));
                        }}
                      />
                      可重复
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        <section className="layout-result">
          {error && <p role="alert">{error}</p>}
          {busy ? (
            <div className="layout-placeholder">
              <h3>正在整理照片与页面…</h3>
              <p>系统正在生成预览，应用前不会更改作品。</p>
              <button onClick={invalidate}>取消计算</button>
            </div>
          ) : candidates.length ? (
            <CandidateComparison
              candidates={candidates}
              selected={chosen}
              onSelect={setChosen}
              doc={baseline.doc}
              resources={previewResources}
              port={previewPort}
            />
          ) : (
            <div className="layout-placeholder">
              <span>▧</span>
              <h3>每一张，都有它的位置</h3>
              <p>
                选好照片与页数，生成后预览整本相册。
                <br />
                方案经检查后才可应用，仍可继续编辑每个图层。
              </p>
            </div>
          )}
        </section>
      </div>
      <footer className="layout-footer">
        <p>应用会替换重排范围内的未锁定内容，可整次撤销。</p>
        <button
          disabled={busy || stale || !selected.size}
          onClick={() => void generate()}
        >
          生成排版方案
        </button>
        <button
          className="primary"
          disabled={busy || stale || !candidates.length}
          onClick={async () => {
            setBusy(true);
            try {
              if (
                await onApply(
                  createLayoutCommand(input!, candidates[chosen], doc),
                  activeTheme,
                )
              )
                onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "应用失败");
            } finally {
              setBusy(false);
            }
          }}
        >
          应用选中方案
        </button>
      </footer>
    </Modal>
  );
}
