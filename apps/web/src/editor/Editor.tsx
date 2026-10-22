import { LayoutWizard } from "../layout/LayoutWizard";
import { Modal } from "../components/Modal";
import { useState, useEffect, useRef, type ReactNode } from "react";
import {
  allLayers,
  isKnownLayer,
  isGroupLayer,
  isImageLayer,
  surfaceLayers,
  walkLayers,
  type DocumentModel,
  type DocumentCommand,
  type KnownLayer,
  type ImageLayer,
  type Layer,
} from "@album/document";
import {
  importImage,
  type ResourceManifest,
  type ResourcePort,
  type ResourceWriter,
  type AssetRecord,
} from "@album/assets";
import type { RevisionStore, SaveResult } from "@album/storage";
import { History } from "../state/history";
import { Autosave } from "../state/autosave";
import { CanvasView } from "./CanvasView";
import { AssetPanel, AssetPreview } from "./AssetPanel";
import { PropertiesPanel } from "./PropertiesPanel";
import { LayerPanel } from "./LayerPanel";
import { SpreadStrip } from "./SpreadStrip";
import {
  base,
  uid,
  siblings,
  cloneLayer,
  frameBounds,
  type Execute,
} from "./types";
export interface EditorProps {
  initial: DocumentModel;
  store: RevisionStore & ResourceWriter;
  resources: ResourceManifest;
  port: ResourcePort;
  onExport?: (save: () => Promise<SaveResult>) => void;
  onRecover?: (file: File) => Promise<void>;
  onProjectExport?: (
    doc: DocumentModel,
    resources: ResourceManifest,
  ) => Promise<void>;
  renderLibrary?: (context: {
    doc: DocumentModel;
    surfaceId: string;
    selectedIds: string[];
    execute: Execute;
    resources: ResourceManifest;
    port: ResourcePort;
  }) => ReactNode;
  renderExport?: (context: { save: () => Promise<SaveResult> }) => ReactNode;
}
const errorText = (error: unknown) => {
  const code = error instanceof Error ? error.message : String(error);
  const texts: Record<string, string> = {
    LAYER_LOCKED: "图层已锁定，请先解锁",
    SELECT_SAME_PARENT: "请选择同一组合内的图层",
    INVALID_SELECTION: "请至少选择两个图层",
    SURFACE_NOT_FOUND: "页面不存在",
    UNSUPPORTED_LAYER: "未知图层保留在项目中，请升级编辑器或删除后重试",
  };
  return texts[code] ?? `操作未完成：${code}`;
};
export function Editor(p: EditorProps) {
  const [history] = useState(() => new History(p.initial)),
    [doc, setDoc] = useState(() => history.current),
    [manifest, setManifest] = useState(p.resources),
    [surfaceId, setSurface] = useState(p.initial.spreads[0].id),
    [selected, setSelected] = useState<string[]>([]),
    [message, setMessage] = useState(""),
    [progress, setProgress] = useState(""),
    [zoom, setZoom] = useState(1),
    [leftOpen, setLeftOpen] = useState(false),
    [crop, setCrop] = useState<ImageLayer>(),
    [textEdit, setTextEdit] = useState<KnownLayer>(),
    [tab, setTab] = useState("photos");
  const [layoutOpen, setLayoutOpen] = useState(false);
  const resourceRef = useRef(manifest);
  resourceRef.current = manifest;
  const [autosave] = useState(
    () =>
      new Autosave(
        p.store,
        () => history.current,
        () => resourceRef.current,
      ),
  );
  const [saveStatus, setSaveStatus] = useState(autosave.status);
  const failed = useRef<File[]>([]),
    [hasRetry, setHasRetry] = useState(false);
  const cropDrag = useRef<
    | {
        x: number;
        y: number;
        clientX: number;
        clientY: number;
        width: number;
        height: number;
      }
    | undefined
  >(undefined);
  const importController = useRef<AbortController | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const unsubscribe = autosave.subscribe(() =>
      setSaveStatus(autosave.status),
    );
    return () => {
      unsubscribe();
    };
  }, [autosave]);
  // A StrictMode effect replay must not dispose the stable state-owned autosaver. The
  // microtask is cancelled by the replay's setup; true unmount still releases timers.
  const life = useRef(0);
  useEffect(() => {
    const token = ++life.current;
    return () => {
      queueMicrotask(() => {
        if (life.current === token) {
          autosave.dispose();
          importController.current?.abort();
        }
      });
    };
  }, [autosave]);
  useEffect(() => {
    const leave = (e: BeforeUnloadEvent) => {
      if (autosave.status !== "saved") {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [autosave]);
  const layers = surfaceLayers(doc, surfaceId),
    selectedLayers = allLayers(doc)
      .filter(isKnownLayer)
      .filter((l) => selected.includes(l.id)),
    single = selectedLayers.length === 1 ? selectedLayers[0] : undefined;
  const execute: Execute = (command) => {
    if (command.type === "batch" && !command.commands.length) return false;
    try {
      const next = history.execute(command);
      setDoc(next);
      autosave.markDirty();
      setMessage("");
      return true;
    } catch (e) {
      setMessage(errorText(e));
      return false;
    }
  };
  const patch = (value: Record<string, unknown>, ids = selected) => {
    if (!ids.length) return;
    execute({
      type: "batch",
      commands: ids.map((layerId) => ({
        type: "update-layer",
        layerId,
        patch: value,
      })),
    });
  };
  const changePage = (id: string) => {
    setSurface(id);
    setSelected([]);
    setCrop(undefined);
    setTextEdit(undefined);
  };
  const undo = () => {
    const next = history.undo();
    setDoc(next);
    changePage(
      surfaceId.startsWith("cover:") ||
        next.spreads.some((s) => s.id === surfaceId)
        ? surfaceId
        : next.spreads[0].id,
    );
    autosave.markDirty();
    setSelected([]);
  };
  const redo = () => {
    const next = history.redo();
    setDoc(next);
    changePage(
      surfaceId.startsWith("cover:") ||
        next.spreads.some((s) => s.id === surfaceId)
        ? surfaceId
        : next.spreads[0].id,
    );
    autosave.markDirty();
    setSelected([]);
  };
  const deleteSelected = () => {
    if (
      execute({
        type: "batch",
        commands: selected.map((layerId) => ({
          type: "delete-layer",
          layerId,
        })),
      })
    )
      setSelected([]);
  };
  const duplicate = () => {
    const copies = selectedLayers.map((layer) => {
      const copy = cloneLayer(layer);
      if (isKnownLayer(copy)) {
        copy.x += 24;
        copy.y += 24;
      }
      return copy;
    });
    if (
      execute({
        type: "batch",
        commands: copies.map((layer, index) => ({
          type: "insert-layer",
          surfaceId,
          layer,
          parentId: allLayers(doc)
            .filter(isGroupLayer)
            .find((g) => g.children === siblings(doc, selectedLayers[index].id))
            ?.id,
        })),
      })
    )
      setSelected(copies.map((l) => l.id));
  };
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const target = event.target as HTMLElement;
      const input = target.closest(
        "input,textarea,select,[contenteditable=true]",
      );
      if (input || target.closest("dialog,[role=dialog]")) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        event.shiftKey ? redo() : undo();
      } else if (mod && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
      } else if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setSelected(layers.filter(isKnownLayer).map((l) => l.id));
      } else if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        duplicate();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        deleteSelected();
      } else if (event.key === "Escape") {
        setSelected([]);
        setCrop(undefined);
        setTextEdit(undefined);
      } else if (
        ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(
          event.key,
        ) &&
        selectedLayers.length
      ) {
        event.preventDefault();
        const n = event.shiftKey ? 10 : 1;
        execute({
          type: "batch",
          commands: selectedLayers.map((l) => ({
            type: "update-layer",
            layerId: l.id,
            patch: {
              x:
                l.x +
                (event.key === "ArrowRight"
                  ? n
                  : event.key === "ArrowLeft"
                    ? -n
                    : 0),
              y:
                l.y +
                (event.key === "ArrowDown"
                  ? n
                  : event.key === "ArrowUp"
                    ? -n
                    : 0),
            },
          })),
        });
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  const add = (kind: "text" | "rectangle" | "ellipse" | "line") => {
    const common = base();
    const layer: Layer =
      kind === "text"
        ? {
            ...common,
            type: "text",
            width: 480,
            height: 150,
            text: "把时光，写成故事",
            fontAssetId: manifest.fonts[0]?.id ?? "noto-sans-sc",
            fontSize: 36,
            fontWeight: 400,
            lineHeight: 1.4,
            letterSpacing: 0,
            textAlign: "left",
            fill: "#234b46",
          }
        : {
            ...common,
            type: "shape",
            shapeKind: kind,
            height: kind === "line" ? 2 : 220,
            fill: kind === "line" ? "#507a70" : "#c5d7c7",
            stroke: "#426b61",
            strokeWidth: kind === "line" ? 3 : 0,
            radius: kind === "rectangle" ? 12 : 0,
          };
    if (execute({ type: "insert-layer", surfaceId, layer }))
      setSelected([layer.id]);
  };
  const addPhoto = (
    asset: AssetRecord,
    position?: { x: number; y: number },
  ) => {
    const width = 360,
      height = 280;
    const layer: ImageLayer = {
      ...base(),
      ...position,
      width,
      height,
      type: "image",
      assetId: asset.id,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      fitMode: "cover",
    };
    if (execute({ type: "insert-layer", surfaceId, layer }))
      setSelected([layer.id]);
  };
  const replacePhoto = (asset: AssetRecord) => {
    if (single?.type !== "image") return;
    patch({ assetId: asset.id, crop: { x: 0, y: 0, width: 1, height: 1 } });
  };
  const importFiles = async (files: File[]) => {
    if (busy) {
      setMessage("请等待当前导入完成");
      return;
    }
    const controller = new AbortController();
    importController.current = controller;
    failed.current = [];
    setHasRetry(false);
    setBusy(true);
    let current = resourceRef.current;
    try {
      for (let i = 0; i < files.length; i++) {
        setProgress(`${i + 1} / ${files.length} · 正在导入 ${files[i].name}`);
        try {
          const imported = await importImage(files[i], controller.signal);
          if (current.assets.some((a) => a.sha256 === imported.record.sha256)) {
            setProgress("重复照片已跳过");
            continue;
          }
          if (current.assets.length >= 500)
            throw new Error("最多 500 张照片，请移除未使用素材");
          await p.store.putAsset(imported.record, imported);
          current = {
            ...current,
            assets: [...current.assets, imported.record],
          };
          resourceRef.current = current;
          setManifest(current);
          autosave.markDirty();
          setProgress(`${i + 1} / ${files.length} · ${files[i].name} 导入完成`);
        } catch (e) {
          if (controller.signal.aborted) return;
          failed.current.push(files[i]);
          setMessage(`${files[i].name}：${errorText(e)}。可点击重试失败导入。`);
        }
      }
    } finally {
      setHasRetry(failed.current.length > 0);
      setBusy(false);
    }
  };
  const removeAsset = (asset: AssetRecord) => {
    const count = allLayers(doc)
      .filter(isImageLayer)
      .filter((l) => l.assetId === asset.id).length;
    if (count) {
      setMessage(
        `此照片有 ${count} 处引用。请先删除或替换这些画框，再移除素材。`,
      );
      return;
    }
    if (history.referencesAsset(asset.id)) {
      setMessage(
        "撤销或重做历史仍引用此照片，当前会话暂不能移除。可先备份项目，重新打开后再移除未使用素材。",
      );
      return;
    }
    const next = {
      ...manifest,
      assets: manifest.assets.filter((a) => a.id !== asset.id),
    };
    resourceRef.current = next;
    setManifest(next);
    autosave.markDirty();
  };
  const arrange = (mode: string) => {
    if (selectedLayers.length < 2) {
      setMessage("请至少选择两个同级图层");
      return;
    }
    const parent = siblings(doc, selectedLayers[0].id);
    if (selectedLayers.some((l) => siblings(doc, l.id) !== parent)) {
      setMessage("请选择同一组合内的图层");
      return;
    }
    const framed = selectedLayers.map((layer) => ({
      layer,
      bounds: frameBounds(layer),
    }));
    const minX = Math.min(...framed.map((l) => l.bounds.x)),
      minY = Math.min(...framed.map((l) => l.bounds.y)),
      maxX = Math.max(...framed.map((l) => l.bounds.x + l.bounds.width)),
      maxY = Math.max(...framed.map((l) => l.bounds.y + l.bounds.height));
    let commands: DocumentCommand[] = [];
    if (mode === "horizontal" || mode === "vertical") {
      if (selectedLayers.length < 3) {
        setMessage("均匀分布需要至少三个图层");
        return;
      }
      const horizontal = mode === "horizontal",
        key = horizontal ? "x" : "y",
        dimension = horizontal ? "width" : "height";
      const sorted = [...framed].sort((a, b) => a.bounds[key] - b.bounds[key]);
      const start = sorted[0].bounds[key],
        end = sorted.at(-1)!.bounds[key] + sorted.at(-1)!.bounds[dimension];
      const gap =
        (end - start - sorted.reduce((n, l) => n + l.bounds[dimension], 0)) /
        (sorted.length - 1);
      let cursor = start;
      commands = sorted.map(({ layer, bounds }) => {
        const c: DocumentCommand = {
          type: "update-layer",
          layerId: layer.id,
          patch: { [key]: layer[key] + cursor - bounds[key] },
        };
        cursor += bounds[dimension] + gap;
        return c;
      });
    } else
      commands = framed.map(({ layer: l, bounds: b }) => ({
        type: "update-layer",
        layerId: l.id,
        patch:
          mode === "left"
            ? { x: l.x + minX - b.x }
            : mode === "center"
              ? { x: l.x + (minX + maxX - b.width) / 2 - b.x }
              : mode === "right"
                ? { x: l.x + maxX - b.width - b.x }
                : mode === "top"
                  ? { y: l.y + minY - b.y }
                  : mode === "middle"
                    ? { y: l.y + (minY + maxY - b.height) / 2 - b.y }
                    : { y: l.y + maxY - b.height - b.y },
      }));
    execute({ type: "batch", commands });
  };
  const reorder = (offset: number) => {
    const commands: DocumentCommand[] = [];
    const parents = new Set(
      selectedLayers.map((layer) => siblings(doc, layer.id)!),
    );
    const selection = new Set(selected);
    for (const parent of parents) {
      const working = [...parent];
      const ids = working
        .filter((layer) => selection.has(layer.id))
        .map((layer) => layer.id);
      if (offset > 0) ids.reverse();
      for (const id of ids) {
        const index = working.findIndex((layer) => layer.id === id),
          destination = index + offset;
        if (
          destination < 0 ||
          destination >= working.length ||
          selection.has(working[destination].id)
        )
          continue;
        commands.push({
          type: "reorder-layer",
          layerId: id,
          index: destination,
        });
        const [layer] = working.splice(index, 1);
        working.splice(destination, 0, layer);
      }
    }
    execute({ type: "batch", commands });
  };
  const addSpread = () => {
    const spread = { id: uid("spread"), background: "#ffffff", layers: [] };
    if (execute({ type: "add-spread", spread })) changePage(spread.id);
  };
  const copySpread = () => {
    const original = doc.spreads.find((s) => s.id === surfaceId);
    if (!original) return;
    const spread = {
      ...structuredClone(original),
      id: uid("spread"),
      layers: original.layers.map(cloneLayer),
    };
    if (
      execute({
        type: "add-spread",
        spread,
        index: doc.spreads.indexOf(original) + 1,
      })
    )
      changePage(spread.id);
  };
  const deleteSpread = () => {
    const spread = doc.spreads.find((s) => s.id === surfaceId);
    if (!spread || doc.spreads.length <= 1) return;
    const count = [...walkLayers(spread.layers)].length;
    if (
      !confirm(`删除此跨页？其中 ${count} 个图层将一并删除，可使用撤销恢复。`)
    )
      return;
    if (execute({ type: "delete-spread", spreadId: surfaceId }))
      changePage(doc.spreads.find((s) => s.id !== surfaceId)!.id);
  };
  const save = () => autosave.flush();
  const statusText = {
    saved: "已保存至此浏览器",
    dirty: "有未保存的更改",
    saving: "正在保存…",
    conflict: "保存冲突：请先导出项目包保留草稿",
    error: "保存失败：请检查浏览器空间并重试",
  }[saveStatus];
  const cropAsset = manifest.assets.find((asset) => asset.id === crop?.assetId);
  const edit = (layer: KnownLayer) => {
    if (layer.type === "image") setCrop(structuredClone(layer));
    else if (layer.type === "text") setTextEdit(structuredClone(layer));
  };
  const run = async (fn: () => Promise<void>) => {
    try {
      const result = await save();
      if (!result.ok) {
        setMessage("保存失败，请先备份项目包保全草稿后再恢复其他项目。");
        return;
      }
      await fn();
    } catch (e) {
      setMessage(errorText(e));
    }
  };
  const backup = async () => {
    if (!p.onProjectExport) return;
    try {
      await p.onProjectExport(
        history.current,
        structuredClone(resourceRef.current),
      );
    } catch (e) {
      setMessage(errorText(e));
    }
  };
  return (
    <div className="editor-app">
      {layoutOpen && (
        <LayoutWizard
          doc={doc}
          resources={manifest}
          port={p.port}
          revisionToken={
            autosave.lastResult?.ok
              ? autosave.lastResult.value.doc.revision
              : doc.revision
          }
          onClose={() => setLayoutOpen(false)}
          onApply={(command) => {
            const applied = execute(command);
            if (applied) {
              setSelected([]);
              setSurface(history.current.spreads[0].id);
            }
            return applied;
          }}
        />
      )}
      <header className="topbar">
        <a className="brand" href="#" onClick={(e) => e.preventDefault()}>
          <span className="brand-mark">拾</span>
          <span>
            拾光<b>相册工作台</b>
          </span>
        </a>
        <div className="project-title">
          未命名相册 <span>本地项目</span>
        </div>
        <div className="top-actions">
          <span className="browser-only">仅此浏览器保存</span>
          <button onClick={() => void backup()} disabled={!p.onProjectExport}>
            备份项目包
          </button>
          <label className="button">
            恢复项目包
            <input
              hidden
              type="file"
              accept=".zip"
              aria-label="恢复项目包"
              disabled={!p.onRecover}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void run(() => p.onRecover!(file));
                e.target.value = "";
              }}
            />
          </label>
          <button
            disabled={busy || !manifest.assets.length}
            onClick={async () => {
              const result = await save();
              if (result.ok) setLayoutOpen(true);
              else setMessage("请先解决保存冲突后再排版。");
            }}
          >
            智能排版
          </button>
          <button className="save-button" onClick={() => void save()}>
            保存
          </button>
          {p.renderExport?.({ save })}
          {p.onExport && (
            <button className="primary" onClick={() => p.onExport!(save)}>
              导出相册 ↗
            </button>
          )}
        </div>
      </header>
      <div className="workspace-toolbar">
        <div className="tools">
          <button
            className="sidebar-toggle"
            aria-label="切换素材栏"
            onClick={() => setLeftOpen(!leftOpen)}
          >
            ☰ 素材
          </button>
          <button
            disabled={!history.canUndo}
            aria-label="撤销"
            title="撤销 · Ctrl / ⌘ Z"
            onClick={undo}
          >
            ↶
          </button>
          <button
            disabled={!history.canRedo}
            aria-label="重做"
            title="重做 · Ctrl / ⌘ Shift Z"
            onClick={redo}
          >
            ↷
          </button>
          <i />
          <button title="添加文字图层" onClick={() => add("text")}>
            文字
          </button>
          <button onClick={() => add("rectangle")}>矩形</button>
          <button onClick={() => add("ellipse")}>圆形</button>
          <button onClick={() => add("line")}>线条</button>
          <i />
          <button
            aria-label="复制图层"
            title="复制图层 · Ctrl / ⌘ D"
            disabled={!selected.length}
            onClick={duplicate}
          >
            复制
          </button>
          <button
            aria-label="删除图层"
            title="删除图层 · Delete"
            disabled={!selected.length}
            onClick={deleteSelected}
          >
            删除
          </button>
        </div>
        <div className="toolbar-right">
          <label>
            背景{" "}
            <input
              aria-label="跨页背景"
              type="color"
              value={
                doc.spreads.find((s) => s.id === surfaceId)?.background ??
                "#ffffff"
              }
              disabled={surfaceId.startsWith("cover:")}
              onChange={(e) =>
                execute({
                  type: "set-background",
                  spreadId: surfaceId,
                  color: e.target.value,
                })
              }
            />
          </label>
          <label>
            缩放{" "}
            <select
              aria-label="画布缩放"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              <option value={0.5}>50%</option>
              <option value={0.75}>75%</option>
              <option value={1}>适合窗口</option>
              <option value={1.5}>150%</option>
              <option value={2}>200%</option>
            </select>
          </label>
        </div>
      </div>
      <div className="workspace-body">
        <aside className={`left-sidebar ${leftOpen ? "open" : ""}`}>
          <nav className="library-tabs">
            <button
              className={tab === "photos" ? "active" : ""}
              onClick={() => setTab("photos")}
            >
              照片
            </button>
            {p.renderLibrary && (
              <button
                className={tab === "library" ? "active" : ""}
                onClick={() => setTab("library")}
              >
                模板与滤镜
              </button>
            )}
          </nav>
          {tab === "photos" ? (
            <AssetPanel
              assets={manifest.assets}
              port={p.port}
              onImport={(files) => void importFiles(files)}
              onAdd={addPhoto}
              canReplace={single?.type === "image"}
              onReplace={replacePhoto}
              onDelete={removeAsset}
              progress={progress}
              hasRetry={hasRetry}
              retry={() => void importFiles([...failed.current])}
            />
          ) : (
            p.renderLibrary?.({
              doc,
              surfaceId,
              selectedIds: selected,
              execute,
              resources: manifest,
              port: p.port,
            })
          )}
          <div className="local-note">
            <span>◈</span>
            <div>
              <b>你的回忆，留在本地</b>
              <p>
                原片与设计仅保存在当前浏览器。
                <br />
                定期备份项目包，可换机恢复。
              </p>
            </div>
          </div>
        </aside>
        <main
          className="canvas-column"
          onDragOver={(e) => {
            if (e.dataTransfer.types.includes("application/x-album-asset"))
              e.preventDefault();
          }}
          onDrop={(e) => {
            const id = e.dataTransfer.getData("application/x-album-asset");
            if (!id) return;
            e.preventDefault();
            const asset = manifest.assets.find((a) => a.id === id);
            if (asset) {
              const rect = e.currentTarget
                .querySelector(".artboard")
                ?.getBoundingClientRect();
              const width =
                doc.pageSize.width * (surfaceId.startsWith("cover:") ? 1 : 2);
              const scale = rect ? rect.width / width : 1;
              addPhoto(
                asset,
                rect
                  ? {
                      x: Math.max(
                        0,
                        Math.min(
                          width - 360,
                          (e.clientX - rect.left) / scale - 180,
                        ),
                      ),
                      y: Math.max(
                        0,
                        Math.min(
                          doc.pageSize.height - 280,
                          (e.clientY - rect.top) / scale - 140,
                        ),
                      ),
                    }
                  : undefined,
              );
            }
          }}
        >
          <div className="document-heading">
            <div>
              <span className="eyebrow">YOUR STORY, BEAUTIFULLY KEPT</span>
              <h1>
                {surfaceId === "cover:front"
                  ? "封面"
                  : surfaceId === "cover:back"
                    ? "封底"
                    : `跨页 ${doc.spreads.findIndex((s) => s.id === surfaceId) + 1}`}
                <span>自由编排，珍藏每一刻</span>
              </h1>
            </div>
            <span className="save-state" role="status">
              {statusText}
            </span>
          </div>
          {message && (
            <div className="message" role="alert">
              <span>{message}</span>
              <button aria-label="关闭提示" onClick={() => setMessage("")}>
                ×
              </button>
            </div>
          )}
          <CanvasView
            doc={doc}
            surfaceId={surfaceId}
            layers={layers}
            resources={manifest}
            port={p.port}
            selected={selected}
            onSelect={setSelected}
            execute={execute}
            onEdit={edit}
            zoom={zoom}
          />
          <div className="selection-toolbar">
            <button
              aria-label="全选图层"
              onClick={() =>
                setSelected(layers.filter(isKnownLayer).map((l) => l.id))
              }
            >
              全选
            </button>
            <button
              disabled={selected.length < 2}
              onClick={() => {
                const id = uid("group");
                if (
                  execute({
                    type: "group-layers",
                    layerIds: selected,
                    groupId: id,
                  })
                )
                  setSelected([id]);
              }}
            >
              组合
            </button>
            <button
              disabled={single?.type !== "group"}
              onClick={() => {
                if (single && isGroupLayer(single)) {
                  const ids = single.children.map((l) => l.id);
                  if (execute({ type: "ungroup-layer", layerId: single.id }))
                    setSelected(ids);
                }
              }}
            >
              取消组合
            </button>
            <i />
            {[
              ["left", "左对齐"],
              ["center", "水平居中"],
              ["right", "右对齐"],
              ["top", "顶对齐"],
              ["middle", "垂直居中"],
              ["bottom", "底对齐"],
              ["horizontal", "水平分布"],
              ["vertical", "垂直分布"],
            ].map(([mode, name]) => (
              <button
                key={mode}
                disabled={selected.length < 2}
                onClick={() => arrange(mode)}
              >
                {name}
              </button>
            ))}
          </div>
        </main>
        <aside className="right-sidebar">
          <PropertiesPanel
            layer={single}
            fonts={manifest.fonts}
            patch={patch}
            onCrop={() => {
              if (single?.type === "image") setCrop(structuredClone(single));
            }}
          />
          <div className="layer-actions">
            <button
              disabled={!selected.length}
              aria-label="图层上移"
              onClick={() => reorder(1)}
            >
              上移一层 ↑
            </button>
            <button
              disabled={!selected.length}
              aria-label="图层下移"
              onClick={() => reorder(-1)}
            >
              下移一层 ↓
            </button>
          </div>
          <LayerPanel
            layers={layers}
            selected={selected}
            onSelect={setSelected}
            patch={patch}
          />
        </aside>
      </div>
      <SpreadStrip
        onReorder={(id, index) =>
          execute({ type: "reorder-spread", spreadId: id, index })
        }
        doc={doc}
        active={surfaceId}
        onSelect={changePage}
        onAdd={addSpread}
        onClone={copySpread}
        onDelete={deleteSpread}
        onMove={(direction) => {
          const index = doc.spreads.findIndex((s) => s.id === surfaceId);
          if (index >= 0)
            execute({
              type: "reorder-spread",
              spreadId: surfaceId,
              index: Math.max(
                0,
                Math.min(doc.spreads.length - 1, index + direction),
              ),
            });
        }}
      />
      {crop && (
        <Modal
          label="照片裁剪"
          className="modal"
          onDismiss={() => setCrop(undefined)}
        >
          <div className="panel-heading">
            <h2>裁剪照片</h2>
            <button aria-label="关闭裁剪" onClick={() => setCrop(undefined)}>
              ×
            </button>
          </div>
          <p>调整原图归一化裁剪区域。画框的位置、尺寸与旋转保持不变。</p>
          <div
            className="crop-diagram"
            style={
              cropAsset
                ? {
                    width: `min(100%, ${(240 * cropAsset.width) / cropAsset.height}px)`,
                    height: "auto",
                    aspectRatio: `${cropAsset.width}/${cropAsset.height}`,
                    marginInline: "auto",
                  }
                : undefined
            }
            onPointerMove={(event) => {
              const drag = cropDrag.current;
              if (!drag) return;
              setCrop((current) =>
                current
                  ? {
                      ...current,
                      crop: {
                        ...current.crop,
                        x: Math.max(
                          0,
                          Math.min(
                            1 - current.crop.width,
                            drag.x +
                              (event.clientX - drag.clientX) / drag.width,
                          ),
                        ),
                        y: Math.max(
                          0,
                          Math.min(
                            1 - current.crop.height,
                            drag.y +
                              (event.clientY - drag.clientY) / drag.height,
                          ),
                        ),
                      },
                    }
                  : current,
              );
            }}
            onPointerUp={() => (cropDrag.current = undefined)}
            onPointerCancel={() => (cropDrag.current = undefined)}
          >
            {cropAsset && <AssetPreview asset={cropAsset} port={p.port} />}
            <div
              onPointerDown={(event) => {
                const rect =
                  event.currentTarget.parentElement!.getBoundingClientRect();
                event.currentTarget.setPointerCapture(event.pointerId);
                cropDrag.current = {
                  x: crop.crop.x,
                  y: crop.crop.y,
                  clientX: event.clientX,
                  clientY: event.clientY,
                  width: rect.width,
                  height: rect.height,
                };
              }}
              style={{
                left: `${crop.crop.x * 100}%`,
                top: `${crop.crop.y * 100}%`,
                width: `${crop.crop.width * 100}%`,
                height: `${crop.crop.height * 100}%`,
              }}
            />
          </div>
          <div className="field-grid">
            {(["x", "y", "width", "height"] as const).map((key, i) => (
              <label className="field" key={key}>
                <span>{["裁剪 X", "裁剪 Y", "裁剪宽度", "裁剪高度"][i]}</span>
                <input
                  aria-label={["裁剪 X", "裁剪 Y", "裁剪宽度", "裁剪高度"][i]}
                  type="number"
                  step="0.01"
                  min={key === "width" || key === "height" ? 0.01 : 0}
                  max="1"
                  value={crop.crop[key]}
                  onChange={(e) =>
                    setCrop({
                      ...crop,
                      crop: { ...crop.crop, [key]: Number(e.target.value) },
                    })
                  }
                />
              </label>
            ))}
          </div>
          {message && <p className="render-error">{message}</p>}
          <div className="modal-actions">
            <button
              onClick={() =>
                setCrop({
                  ...crop,
                  crop: { x: 0, y: 0, width: 1, height: 1 },
                })
              }
            >
              重置裁剪
            </button>
            <button
              className="primary"
              onClick={() => {
                if (
                  execute({
                    type: "update-layer",
                    layerId: crop.id,
                    patch: { crop: crop.crop },
                  })
                )
                  setCrop(undefined);
              }}
            >
              应用裁剪
            </button>
          </div>
        </Modal>
      )}
      {textEdit?.type === "text" && (
        <Modal
          label="编辑文字"
          className="modal"
          initialFocus="textarea"
          onDismiss={() => setTextEdit(undefined)}
        >
          <h2>编辑文字</h2>
          <textarea
            autoFocus
            aria-label="画布文字编辑"
            value={textEdit.text}
            onChange={(e) => setTextEdit({ ...textEdit, text: e.target.value })}
          />
          <div className="modal-actions">
            <button onClick={() => setTextEdit(undefined)}>取消</button>
            <button
              className="primary"
              onClick={() => {
                if (
                  execute({
                    type: "update-layer",
                    layerId: textEdit.id,
                    patch: { text: textEdit.text },
                  })
                )
                  setTextEdit(undefined);
              }}
            >
              应用文字
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
