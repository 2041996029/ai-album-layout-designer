import { useEffect, useState } from "react";
import { api, ifMatch, id, type DTO, type Page } from "../cloud/api";
export function FolderBrowser({
  workspaceId,
  onSelectAsset,
}: {
  workspaceId: string;
  onSelectAsset: (assetId: string) => void;
}) {
  const [path, setPath] = useState<{ id: string; name: string }[]>([]),
    [folders, setFolders] = useState<DTO<"Folder">[]>([]),
    [assets, setAssets] = useState<DTO<"Asset">[]>([]),
    [q, setQ] = useState(""),
    [sort, setSort] = useState("name_asc"),
    [trash, setTrash] = useState(false),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [name, setName] = useState(""),
    [tick, refresh] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [target, setTarget] = useState(""),
    [role, setRole] = useState("viewer"),
    [usage, setUsage] = useState<DTO<"Usage">>();
  const parent = path.at(-1)?.id ?? null,
    write = role !== "viewer";
  useEffect(() => {
    let live = true;
    setBusy(true);
    setError("");
    setSelected([]);
    const fq = new URLSearchParams({ state: trash ? "trashed" : "active", q });
    if (parent) fq.set("parentId", parent);
    const aq = new URLSearchParams({
      state: trash ? "trashed" : "ready",
      q,
      sort,
    });
    if (parent) aq.set("folderId", parent);
    async function all<T>(url: string) {
      const items: T[] = [];
      let cursor: string | null = null;
      do {
        const p: Page<T> = await api(
          url + (cursor ? "&cursor=" + id(cursor) : ""),
        );
        items.push(...p.items);
        cursor = p.hasMore ? p.nextCursor : null;
      } while (cursor);
      return items;
    }
    void Promise.all([
      all<DTO<"Folder">>(`/workspaces/${id(workspaceId)}/folders?${fq}`),
      all<DTO<"Asset">>(`/workspaces/${id(workspaceId)}/assets?${aq}`),
      api<DTO<"Workspace">>(`/workspaces/${id(workspaceId)}`),
      api<DTO<"Usage">>(`/workspaces/${id(workspaceId)}/usage`),
    ])
      .then(([f, a, w, u]) => {
        if (live) {
          setFolders(f);
          setAssets(a);
          setRole(w.role);
          setUsage(u);
        }
      })
      .catch((e) => {
        if (live) setError(String(e));
      })
      .finally(() => {
        if (live) setBusy(false);
      });
    return () => {
      live = false;
    };
  }, [workspaceId, parent, q, sort, trash, tick]);
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      refresh((v) => v + 1);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }
  async function upload(file: File) {
    if (
      !["image/jpeg", "image/png"].includes(file.type) ||
      file.size > 25_000_000
    )
      throw Error("请选择不超过25MB的 JPEG 或 PNG");
    const sha256 = Array.from(
      new Uint8Array(
        await crypto.subtle.digest("SHA-256", await file.arrayBuffer()),
      ),
      (b) => b.toString(16).padStart(2, "0"),
    ).join("");
    const ticket = await api<DTO<"UploadTicket">>(
      `/workspaces/${id(workspaceId)}/uploads`,
      "POST",
      {
        filename: file.name,
        sizeBytes: file.size,
        declaredMime: file.type,
        sha256,
        folderId: parent,
      },
    );
    let body: File | FormData = file;
    if (ticket.method === "POST") {
      const form = new FormData();
      for (const h of ticket.formFields) form.append(h.name, h.value);
      form.append("file", file);
      body = form;
    }
    const r = await fetch(ticket.url, {
      method: ticket.method,
      headers: Object.fromEntries(ticket.headers.map((h) => [h.name, h.value])),
      body,
      credentials: "omit",
    });
    if (!r.ok) throw Error("上传失败，请重试");
    await api(`/assets/${id(ticket.assetId)}/complete`, "POST", {
      uploadId: ticket.uploadId,
      sha256,
      sizeBytes: file.size,
    });
  }
  return (
    <section aria-label="云素材">
      <h2>云素材</h2>
      <nav aria-label="文件夹路径">
        <button onClick={() => setPath([])}>全部素材</button>
        {path.map((p, i) => (
          <button key={p.id} onClick={() => setPath(path.slice(0, i + 1))}>
            {p.name}
          </button>
        ))}
      </nav>
      <label>
        搜索
        <input value={q} onChange={(e) => setQ(e.target.value)} />
      </label>
      <label>
        排序
        <select value={sort} onChange={(e) => setSort(e.target.value)}>
          <option value="name_asc">名称</option>
          <option value="created_desc">最近上传</option>
        </select>
      </label>
      <button
        onClick={() => {
          setTrash(!trash);
          setPath([]);
        }}
      >
        {trash ? "返回素材" : "回收站"}
      </button>
      {usage && (
        <p>
          素材 {usage.storageBytes} 字节 · 回收站 {usage.recycleBinBytes} 字节 ·
          上传预留 {usage.reservedUploadBytes} 字节 / {usage.storageLimitBytes}{" "}
          字节
        </p>
      )}
      {write && !trash && (
        <>
          <label>
            文件夹名称
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={80}
            />
          </label>
          <button
            disabled={busy || !name.trim()}
            onClick={() =>
              void act(async () => {
                await api(`/workspaces/${id(workspaceId)}/folders`, "POST", {
                  name,
                  parentId: parent,
                });
                setName("");
              })
            }
          >
            新建文件夹
          </button>
          <label>
            上传至当前目录
            <input
              type="file"
              accept="image/jpeg,image/png"
              disabled={busy}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void act(() => upload(f));
                e.target.value = "";
              }}
            />
          </label>
        </>
      )}
      {busy && <p role="status">正在读取云素材…</p>}
      {error && <p role="alert">{error}</p>}
      <ul>
        {[...folders]
          .sort((a, b) =>
            sort === "name_asc"
              ? a.name.localeCompare(b.name)
              : b.createdAt.localeCompare(a.createdAt),
          )
          .map((f) => (
            <li key={f.id}>
              <button
                onClick={() => setPath([...path, { id: f.id, name: f.name }])}
              >
                {f.name}
              </button>
              {write &&
                (trash ? (
                  <button
                    disabled={busy}
                    onClick={() =>
                      void act(() =>
                        api(
                          `/folders/${id(f.id)}/restore`,
                          "POST",
                          { parentId: parent },
                          ifMatch(f.revision),
                        ),
                      )
                    }
                  >
                    恢复文件夹
                  </button>
                ) : (
                  <>
                    <button
                      disabled={busy || !name.trim()}
                      onClick={() =>
                        void act(() =>
                          api(
                            `/folders/${id(f.id)}`,
                            "PATCH",
                            { name },
                            ifMatch(f.revision),
                          ),
                        )
                      }
                    >
                      重命名
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(() =>
                          api(
                            `/folders/${id(f.id)}`,
                            "PATCH",
                            { parentId: target || null },
                            ifMatch(f.revision),
                          ),
                        )
                      }
                    >
                      移动文件夹
                    </button>
                    <button
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          const p = await api<DTO<"FolderDeletePreview">>(
                            `/folders/${id(f.id)}/delete-preview`,
                          );
                          if (!p.canDelete)
                            throw Error(
                              `仍被 ${p.references.projects.length} 个项目和 ${p.references.activeJobCount} 个任务引用，无法回收`,
                            );
                          await api(
                            `/folders/${id(f.id)}`,
                            "DELETE",
                            undefined,
                            ifMatch(f.revision),
                          );
                        })
                      }
                    >
                      移入回收站
                    </button>
                  </>
                ))}
            </li>
          ))}
      </ul>
      {write && (
        <div>
          <button
            disabled={busy}
            onClick={() => setSelected(assets.map((a) => a.id))}
          >
            全选当前素材
          </button>
          <button disabled={busy} onClick={() => setSelected([])}>
            取消全选素材
          </button>
        </div>
      )}
      <ul>
        {assets.map((a) => (
          <li key={a.id}>
            {write && (
              <input
                aria-label={`选择 ${a.originalFilename ?? a.id}`}
                type="checkbox"
                checked={selected.includes(a.id)}
                onChange={(e) =>
                  setSelected(
                    e.target.checked
                      ? [...selected, a.id]
                      : selected.filter((v) => v !== a.id),
                  )
                }
              />
            )}
            <button disabled={trash} onClick={() => onSelectAsset(a.id)}>
              {a.originalFilename ?? a.id}
            </button>
            {write && (
              <button
                disabled={busy}
                onClick={() =>
                  void act(() =>
                    api(
                      `/assets/${id(a.id)}${trash ? "/restore" : ""}`,
                      trash ? "POST" : "DELETE",
                      trash ? { folderId: parent } : undefined,
                      ifMatch(a.revision),
                    ),
                  )
                }
              >
                {trash ? "恢复素材" : "回收素材"}
              </button>
            )}
          </li>
        ))}
      </ul>
      {write && (
        <>
          <label>
            移动到
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">根目录</option>
              {folders
                .filter((f) => f.state === "active")
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
            </select>
          </label>
          <button
            disabled={busy || !selected.length || trash}
            onClick={() =>
              void act(() =>
                api(
                  `/workspaces/${id(workspaceId)}/assets/batch-move`,
                  "POST",
                  {
                    assetIds: selected,
                    targetFolderId: target || null,
                    expectedAssets: assets
                      .filter((a) => selected.includes(a.id))
                      .map((a) => ({ assetId: a.id, revision: a.revision })),
                  },
                ),
              )
            }
          >
            移动选中素材
          </button>
        </>
      )}
      <p>移入回收站，不会立即删除云对象</p>
    </section>
  );
}
