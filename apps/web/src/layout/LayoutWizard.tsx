import { useEffect, useRef, useState } from "react";
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
}: {
  doc: DocumentModel;
  resources: ResourceManifest;
  port: ResourcePort;
  revisionToken: number;
  onClose: () => void;
  onApply: (command: DocumentCommand) => boolean;
}) {
  const [baseline] = useState(() => ({
    doc: structuredClone(doc),
    token: revisionToken,
  }));
  const [ids, setIds] = useState(() =>
    resources.assets
      .filter((a) => a.status === "ready" && a.license.usable)
      .map((a) => a.id),
  );
  const [selected, setSelected] = useState(() => new Set(ids)),
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
    setError("");
  };
  const generate = async () => {
    invalidate();
    const token = sequence.current,
      abort = new AbortController();
    controller.current = abort;
    setBusy(true);
    const t = templateVersions.find((t) => t.id === templateId)!;
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
      templateRef: { id: t.id, version: t.version, sha256: t.sha256 },
      algorithmVersion: "local-layout-v1",
      seed: 1,
    };
    try {
      const result = await computeLayouts(next, baseline.doc, t, abort.signal);
      if (sequence.current !== token || abort.signal.aborted) return;
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
      initialFocus='select[aria-label="场景模板"]'
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
              场景模板
              <select
                aria-label="场景模板"
                value={templateId}
                onChange={(e) => setTemplate(e.target.value)}
              >
                {templateVersions.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="layout-numbers">
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
              <p>计算在独立线程运行，取消不会更改项目。</p>
              <button onClick={invalidate}>取消计算</button>
            </div>
          ) : candidates.length ? (
            <CandidateComparison
              candidates={candidates}
              selected={chosen}
              onSelect={setChosen}
              doc={baseline.doc}
              resources={resources}
              port={port}
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
          onClick={() => {
            try {
              if (onApply(createLayoutCommand(input!, candidates[chosen], doc)))
                onClose();
            } catch (e) {
              setError(e instanceof Error ? e.message : "应用失败");
            }
          }}
        >
          应用选中方案
        </button>
      </footer>
    </Modal>
  );
}
