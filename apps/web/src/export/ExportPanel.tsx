import { Modal } from "../components/Modal";
import { templateRefs } from "@album/document";
import { useEffect, useRef, useState } from "react";
import { Zip, ZipPassThrough, strToU8 } from "fflate";
import type {
  IndexedDbRevisionStore,
  SaveResult,
  SavedRevision,
} from "@album/storage";
import {
  allSurfaceIds,
  freezeSnapshot,
  preflight,
  runExport,
  artifactManifest,
  MAX_ENCODED_BYTES,
  type ExportOptions,
  type ExportSnapshot,
  type PreflightReport,
  type Artifact,
} from "@album/export";
import { PreflightPanel } from "./PreflightPanel";
function download(bytes: Uint8Array, name: string, mime: string) {
  const url = URL.createObjectURL(
    new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function archive(files: Artifact[], manifest: unknown): Uint8Array {
  const parts: Uint8Array[] = [],
    zip = new Zip((error, chunk) => {
      if (error) throw error;
      parts.push(chunk);
    });
  let total = 0;
  for (const file of [
    ...files,
    {
      filename: "manifest.json",
      bytes: strToU8(JSON.stringify(manifest, null, 2)),
    },
  ]) {
    total += file.bytes.length;
    if (total > MAX_ENCODED_BYTES) throw new Error("DOWNLOAD_TOO_LARGE");
    const entry = new ZipPassThrough(file.filename);
    zip.add(entry);
    entry.push(file.bytes, true);
  }
  zip.end();
  const length = parts.reduce((n, p) => n + p.length, 0);
  if (length > MAX_ENCODED_BYTES) throw new Error("DOWNLOAD_TOO_LARGE");
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    bytes.set(p, offset);
    offset += p.length;
  }
  return bytes;
}
export function ExportPanel({
  store,
  save,
  onRepairText,
}: {
  store: IndexedDbRevisionStore;
  save: () => Promise<SaveResult>;
  onRepairText?: () => Promise<SaveResult>;
}) {
  const [open, setOpen] = useState(false),
    [saved, setSaved] = useState<SavedRevision>(),
    [snapshot, setSnapshot] = useState<ExportSnapshot>(),
    [report, setReport] = useState<PreflightReport>(),
    [ack, setAck] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [progress, setProgress] = useState(""),
    [files, setFiles] = useState<Artifact[]>([]);
  const [options, setOptions] = useState<ExportOptions>({
      format: "png",
      dpi: 300,
      view: "spread",
      pageIds: [],
      includeCover: false,
      bleedMm: 3,
      jpegMatte: "#ffffff",
    }),
    controller = useRef<AbortController | null>(null);
  const launch = useRef<HTMLButtonElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const invalidate = (next: ExportOptions) => {
    controller.current?.abort();
    setOptions(next);
    setSnapshot(undefined);
    setReport(undefined);
    setAck([]);
    setFiles([]);
    setError("");
    setProgress("");
  };
  const pageLabel = (id: string) => {
    if (id === "cover:front") return "封面";
    if (id === "cover:back") return "封底";
    const index = saved!.doc.spreads.findIndex(
      (s) => id === s.id || id === s.id + ":left" || id === s.id + ":right",
    );
    return options.view === "spread"
      ? `跨页 ${index + 1} · 第 ${index * 2 + 1}–${index * 2 + 2} 页`
      : `第 ${index * 2 + (id.endsWith(":right") ? 2 : 1)} 页`;
  };
  async function begin() {
    setError("");
    setBusy(true);
    try {
      const result = await save();
      if (!result.ok)
        throw new Error(result.code + "：请先备份并解决保存问题。");
      setSaved(result.value);
      setOptions((o) => ({
        ...o,
        bleedMm: result.value.doc.printProfile.bleedMm,
        pageIds: allSurfaceIds(result.value.doc, o.view, o.includeCover),
      }));
      setOpen(true);
      setFiles([]);
      setReport(undefined);
      setSnapshot(undefined);
      setProgress("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function check(value = saved) {
    if (!value) return;
    controller.current?.abort();
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setFiles([]);
    setReport(undefined);
    setSnapshot(undefined);
    setError("");
    setProgress("正在检查照片、字体与输出规格…");
    setAck([]);
    try {
      const snap = await freezeSnapshot(
        value,
        options,
        new Date().toISOString(),
      );
      const next = await preflight(snap, store, c.signal, { templateRefs });
      c.signal.throwIfAborted();
      setSnapshot(snap);
      setReport(next);
      setProgress(
        next.blockers.length
          ? "请先解决阻断问题"
          : next.warnings.length
            ? "请逐项检查并确认预警"
            : "检查通过，可以开始导出",
      );
    } catch (e) {
      if (!c.signal.aborted) {
        setError(String(e));
        setProgress("");
      } else setProgress("检查已取消，可重新检查");
    } finally {
      setBusy(false);
    }
  }
  async function render() {
    if (!snapshot || !report) return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setFiles([]);
    setError("");
    setProgress("准备渲染");
    let pinned = false;
    try {
      await store.pinResources(snapshot.snapshotHash, snapshot.resources);
      pinned = true;
      const result: Artifact[] = [];
      for await (const file of runExport(
        snapshot,
        report,
        ack,
        store,
        c.signal,
        (done, total) => setProgress(`${done} / ${total} 面`),
      ))
        result.push(file);
      c.signal.throwIfAborted();
      setFiles(result);
      setProgress("导出完成，可下载");
    } catch (e) {
      setFiles([]);
      setProgress(c.signal.aborted ? "已取消，没有生成完整下载" : "");
      if (!c.signal.aborted) setError(String(e));
    } finally {
      try {
        if (pinned) await store.releaseResources(snapshot.snapshotHash);
      } catch (e) {
        setError("资源清理失败，请重新打开项目：" + String(e));
      } finally {
        setBusy(false);
      }
    }
  }
  return (
    <>
      <button
        ref={launch}
        className="primary"
        disabled={busy}
        onClick={() => void begin()}
      >
        导出作品
      </button>
      {error && !open && (
        <p className="export-launch-error" role="alert">
          {error}
        </p>
      )}
      {open && (
        <Modal
          returnFocus={launch}
          className="export-dialog"
          label="导出作品"
          initialFocus="[aria-label='导出格式']"
          onDismiss={() => {
            if (busy) controller.current?.abort();
            else setOpen(false);
          }}
        >
          <header>
            <h2>导出作品</h2>
            <button disabled={busy} onClick={() => setOpen(false)}>
              关闭
            </button>
          </header>
          <p>本地渲染 · 已保存版本 {saved?.doc.revision} · 请保持此页面打开</p>
          <fieldset disabled={busy}>
            <label>
              格式{" "}
              <select
                aria-label="导出格式"
                value={options.format}
                onChange={(e) =>
                  invalidate({
                    ...options,
                    format: e.target.value as ExportOptions["format"],
                  })
                }
              >
                <option value="png">PNG（保留透明）</option>
                <option value="jpeg">JPEG</option>
                <option value="pdf">普通 PDF（栅格 sRGB）</option>
              </select>
            </label>
            <label>
              DPI{" "}
              <select
                aria-label="导出DPI"
                value={options.dpi}
                onChange={(e) =>
                  invalidate({
                    ...options,
                    dpi: Number(e.target.value) as ExportOptions["dpi"],
                  })
                }
              >
                {[72, 150, 300].map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            </label>
            <label>
              视图{" "}
              <select
                value={options.view}
                onChange={(e) => {
                  const view = e.target.value as ExportOptions["view"];
                  invalidate({
                    ...options,
                    view,
                    pageIds: allSurfaceIds(
                      saved!.doc,
                      view,
                      options.includeCover,
                    ),
                  });
                }}
              >
                <option value="spread">跨页</option>
                <option value="singlePage">单页</option>
              </select>
            </label>
            <label>
              出血 mm{" "}
              <input
                type="number"
                min="0"
                max="20"
                step="0.5"
                value={options.bleedMm}
                onChange={(e) =>
                  invalidate({ ...options, bleedMm: Number(e.target.value) })
                }
              />
            </label>
            <label>
              JPEG 底色{" "}
              <input
                type="color"
                value={options.jpegMatte}
                onChange={(e) =>
                  invalidate({ ...options, jpegMatte: e.target.value })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={options.includeCover}
                onChange={(e) =>
                  invalidate({
                    ...options,
                    includeCover: e.target.checked,
                    pageIds: allSurfaceIds(
                      saved!.doc,
                      options.view,
                      e.target.checked,
                    ),
                  })
                }
              />
              包含封面正背面
            </label>
            <button
              onClick={() =>
                invalidate({
                  ...options,
                  pageIds: allSurfaceIds(
                    saved!.doc,
                    options.view,
                    options.includeCover,
                  ),
                })
              }
            >
              全选导出页面
            </button>
            <button onClick={() => invalidate({ ...options, pageIds: [] })}>
              清空导出页面
            </button>
            <div className="export-pages">
              {saved &&
                allSurfaceIds(
                  saved.doc,
                  options.view,
                  options.includeCover,
                ).map((id) => (
                  <label key={id}>
                    <input
                      type="checkbox"
                      checked={options.pageIds.includes(id)}
                      onChange={(e) =>
                        invalidate({
                          ...options,
                          pageIds: e.target.checked
                            ? [...options.pageIds, id]
                            : options.pageIds.filter((p) => p !== id),
                        })
                      }
                    />
                    {pageLabel(id)}
                  </label>
                ))}
            </div>
            <button
              disabled={!options.pageIds.length}
              onClick={() => void check()}
            >
              检查导出条件
            </button>
          </fieldset>
          {report?.blockers.some((i) => i.code === "TEXT_OVERFLOW") &&
            onRepairText && (
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const result = await onRepairText();
                    if (!result.ok)
                      throw Error("文字适配后保存失败，请保留本地草稿");
                    setSaved(result.value);
                    await check(result.value);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                自动适配溢出文字并重新检查
              </button>
            )}
          {report && (
            <PreflightPanel
              report={report}
              acknowledged={ack}
              onChange={setAck}
            />
          )}
          {error && <p role="alert">{error}</p>}
          <p
            className={`export-status ${files.length ? "is-success" : ""}`}
            role="status"
          >
            {progress}
          </p>
          {busy && (
            <p className="modal-hint">
              正在处理，请保持页面打开。Esc 可取消当前任务。
            </p>
          )}
          {busy ? (
            <button onClick={() => controller.current?.abort()}>取消</button>
          ) : (
            report && (
              <button
                className="primary"
                disabled={
                  !!report.blockers.length ||
                  report.warnings.some((w) => !ack.includes(w.id))
                }
                onClick={() => void render()}
              >
                开始导出
              </button>
            )
          )}
          {!!files.length && snapshot && (
            <div>
              <button
                onClick={() => {
                  try {
                    download(
                      archive(files, artifactManifest(snapshot, files)),
                      `album-r${snapshot.revision}.zip`,
                      "application/zip",
                    );
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                下载文件与清单 ZIP
              </button>
              {files.map((f) => (
                <button
                  key={f.filename}
                  onClick={() => download(f.bytes, f.filename, f.mime)}
                >
                  下载 {f.filename}
                </button>
              ))}
            </div>
          )}
          <p>
            普通 PDF 不包含 CMYK 或 PDF/X 印刷认证。单次下载上限 256
            MiB，超出请分批选择页面。
          </p>
        </Modal>
      )}
    </>
  );
}
