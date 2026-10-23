import { useEffect, useRef, useState } from "react";
import type {
  IndexedDbRevisionStore,
  SavedRevision,
  SaveResult,
} from "@album/storage";
import type { DocumentModel } from "@album/document";
import type { ResourceManifest } from "@album/assets";

type Project = Awaited<
  ReturnType<IndexedDbRevisionStore["listProjects"]>
>[number];
const nameOf = (p?: Project) => p?.name || "未命名相册";
export function LocalAlbumMenu({
  store,
  projectId,
  save,
  onOpen,
}: {
  store: IndexedDbRevisionStore;
  projectId: string;
  save: () => Promise<SaveResult>;
  onOpen: (next: SavedRevision) => void;
}) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false);
  const [name, setName] = useState(""),
    [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);
  const operation = useRef(false);
  const current = projects.find((p) => p.projectId === projectId);
  const refresh = async () => {
    const rows = await store.listProjects();
    setProjects(rows);
    return rows;
  };
  useEffect(() => {
    void refresh().catch(() => setError("无法读取本地相册列表。"));
  }, [projectId]);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  const run = async (action: () => Promise<void>) => {
    if (operation.current) return;
    operation.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败，请重试。");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  const persist = async () => {
    const result = await save();
    if (!result.ok)
      throw Error(
        "当前相册未保存成功，已保留当前页面，请先重试保存或备份项目包。",
      );
    return result.value;
  };
  return (
    <>
      <button
        className="album-title-button"
        aria-label={`相册：${nameOf(current)}`}
        onClick={() =>
          void run(async () => {
            const rows = await refresh();
            setName(nameOf(rows.find((p) => p.projectId === projectId)));
            setOpen(true);
          })
        }
        disabled={busy}
      >
        <b>{nameOf(current)}</b>
        <small>切换 / 重命名 ▾</small>
      </button>
      {open && (
        <dialog
          className="modal album-manager"
          ref={dialog}
          aria-label="我的相册"
          onCancel={(e) => {
            if (busy) e.preventDefault();
            else setOpen(false);
          }}
        >
          <header>
            <h2>我的相册</h2>
            <button
              aria-label="关闭相册列表"
              disabled={busy}
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>
          <p>相册保存在此浏览器，切换或新建前会自动保存当前相册。</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                await store.renameProject(projectId, name);
                await refresh();
              });
            }}
          >
            <label>
              当前相册名称
              <input
                autoFocus
                aria-label="当前相册名称"
                value={name}
                maxLength={80}
                onChange={(e) => setName(e.target.value)}
                disabled={busy}
              />
            </label>
            <button disabled={busy || !name.trim()} type="submit">
              保存名称
            </button>
          </form>
          <ul className="local-album-list">
            {projects.map((p) => (
              <li key={p.projectId}>
                <button
                  aria-label={`打开相册 ${nameOf(p)}`}
                  disabled={busy || p.projectId === projectId}
                  onClick={() =>
                    void run(async () => {
                      await persist();
                      const next = await store.load(p.projectId);
                      onOpen(next);
                    })
                  }
                >
                  <b>{nameOf(p)}</b>
                  <small>
                    {p.projectId === projectId ? "当前相册 · " : ""}
                    {new Date(p.savedAt).toLocaleString()}
                  </small>
                </button>
              </li>
            ))}
          </ul>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                const before = await persist();
                const doc: DocumentModel = {
                  schemaVersion: 1,
                  unit: "px96",
                  colorSpace: "srgb",
                  pageSize: structuredClone(before.doc.pageSize),
                  printProfile: structuredClone(before.doc.printProfile),
                  projectId: `prj_${crypto.randomUUID().replaceAll("-", "")}`,
                  revision: 1,
                  cover: { front: [], back: [] },
                  spreads: [
                    { id: "spread_1", background: "#ffffff", layers: [] },
                  ],
                };
                const resources: ResourceManifest = {
                  assets: [],
                  fonts: before.resources.fonts,
                };
                const next = await store.create(doc, resources);
                await store.renameProject(
                  doc.projectId,
                  newName.trim() || "未命名相册",
                );
                onOpen(next);
              });
            }}
          >
            <label>
              新相册名称
              <input
                aria-label="新相册名称"
                placeholder="例如：夏日写真"
                value={newName}
                maxLength={80}
                onChange={(e) => setNewName(e.target.value)}
                disabled={busy}
              />
            </label>
            <button type="submit" disabled={busy}>
              新建相册
            </button>
          </form>
          {error && <p role="alert">{error}</p>}
          {busy && <p role="status">正在保存并处理…</p>}
        </dialog>
      )}
    </>
  );
}
