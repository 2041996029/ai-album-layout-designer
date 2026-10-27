import { openDB } from "idb";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DocumentModel } from "@album/document";
import type { ResourceManifest } from "@album/assets";
import { cacheCloudProject, syncAssets } from "./resources";
import { CloudRevisionStore, type SavedRevision } from "@album/storage";
import {
  api,
  apiBase,
  cloudFetch,
  cloudConfigured,
  id,
  setSession,
  type DTO,
} from "./api";
import { LoginPanel } from "../auth/LoginPanel";
import { WorkspaceTools } from "../workspaces/WorkspaceTools";
import { WorkspaceSwitcher } from "../workspaces/WorkspaceSwitcher";
import { FolderBrowser } from "../assets/FolderBrowser";
import { AccountSettings } from "../account/AccountSettings";
import "./cloud.css";
export function CloudPanel({
  current,
  onOpen,
  onImport,
}: {
  onOpen: (saved: SavedRevision) => void;
  onImport: (file: File) => Promise<void>;
  current: { doc: DocumentModel; resources: ResourceManifest };
}) {
  const [capabilities, setCapabilities] = useState<DTO<"Capabilities">>(),
    [session, setUser] = useState<DTO<"WebSession"> | null>(null),
    [unavailable, setUnavailable] = useState(false),
    [open, setOpen] = useState(false),
    [workspace, setWorkspace] = useState(""),
    [status, setStatus] = useState(""),
    [saving, setSaving] = useState(false),
    [asset, setAsset] = useState(""),
    [projects, setProjects] = useState<DTO<"Project">[]>([]),
    [canSave, setCanSave] = useState(false);
  const epoch = useRef(0),
    remote = useRef<{ id: string; revision: number } | null>(null),
    latest = useRef(current);
  latest.current = current;
  const localProject = useRef(current.doc.projectId);
  useEffect(() => {
    if (localProject.current !== current.doc.projectId) {
      localProject.current = current.doc.projectId;
      epoch.current++;
      remote.current = null;
      setStatus("");
      setSaving(false);
    }
  }, [current.doc.projectId]);
  useEffect(() => {
    if (!cloudConfigured) {
      setUnavailable(true);
      return;
    }
    let live = true;
    void api<DTO<"Capabilities">>("/capabilities?platform=web")
      .then(async (c) => {
        if (!live) return;
        setCapabilities(c);
        try {
          const s = await api<DTO<"WebSession">>("/auth/session");
          if (live) {
            setSession(s);
            setUser(s);
          }
        } catch {
          /* anonymous */
        }
      })
      .catch(() => {
        if (live) setUnavailable(true);
      });
    return () => {
      live = false;
    };
  }, []);
  const change = useCallback((wid: string) => {
    epoch.current++;
    remote.current = null;
    setWorkspace(wid);
    setStatus("");
    setSaving(false);
    setAsset("");
  }, []);
  useEffect(() => {
    let live = true;
    setProjects([]);
    setCanSave(false);
    if (workspace)
      void api<DTO<"Workspace">>(`/workspaces/${id(workspace)}`)
        .then((w) => {
          if (live) setCanSave(w.role !== "viewer");
        })
        .catch(() => {});
    if (workspace)
      void api<{ items: DTO<"Project">[] }>(
        `/workspaces/${id(workspace)}/projects`,
      )
        .then((v) => {
          if (live) setProjects(v.items);
        })
        .catch(() => {});
    return () => {
      live = false;
    };
  }, [workspace]);
  const login = useCallback((s: DTO<"WebSession">) => {
    setSession(s);
    setUser(s);
  }, []);
  async function save() {
    const gen = epoch.current,
      wid = workspace,
      snapshot = structuredClone(latest.current),
      capturedRemote = remote.current ? { ...remote.current } : null;
    setSaving(true);
    setStatus("正在保存到云端…");
    try {
      const db = await openDB(`album-cloud-recovery:${wid}`, 1, {
        upgrade(db) {
          db.createObjectStore("drafts");
        },
      });
      try {
        await db.put(
          "drafts",
          { ...snapshot, capturedAt: new Date().toISOString() },
          `${snapshot.doc.projectId}:${crypto.randomUUID()}`,
        );
      } finally {
        db.close();
      }
      const store = new CloudRevisionStore(apiBase, wid, cloudFetch);
      let project = capturedRemote;
      if (!project) {
        const created = await api<DTO<"ProjectDocument">>(
          `/workspaces/${id(wid)}/projects`,
          "POST",
          {
            name: "我的相册",
            mode: "full_editor",
            scene: "other",
            pageWidthMm: (snapshot.doc.pageSize.width * 25.4) / 96,
            pageHeightMm: (snapshot.doc.pageSize.height * 25.4) / 96,
            spreadCount: snapshot.doc.spreads.length,
          },
        );
        project = {
          id: created.project.id,
          revision: created.project.revision,
        };
        if (gen === epoch.current) remote.current = project;
      }
      if (gen !== epoch.current) return;
      const synced = await syncAssets(wid, snapshot.doc, snapshot.resources);
      if (gen !== epoch.current) return;
      const result = await store.save(
        { ...synced.doc, projectId: project.id, revision: project.revision },
        project.revision,
        synced.resources,
      );
      if (gen !== epoch.current) return;
      if (result.ok) {
        remote.current = {
          id: project.id,
          revision: result.value.doc.revision,
        };
        setStatus(
          JSON.stringify(latest.current) === JSON.stringify(snapshot)
            ? "已保存到云端"
            : "此前版本已云保存，当前修改待保存",
        );
      } else
        setStatus(
          result.code === "REVISION_CONFLICT"
            ? "该版本已由其他设备修改，本地草稿已保留"
            : "云端保存失败，本地草稿已保留",
        );
    } catch {
      if (gen === epoch.current) setStatus("云端保存失败，本地草稿已保留");
    } finally {
      if (gen === epoch.current) setSaving(false);
    }
  }
  return (
    <aside className="cloud-panel" aria-label="云工作区">
      <button onClick={() => setOpen(!open)} aria-expanded={open}>
        云工作区
      </button>
      <span>
        {unavailable
          ? "云服务暂不可用，当前编辑保存在此浏览器"
          : !capabilities
            ? "正在检查云服务…"
            : session
              ? `${session.user.displayName} · 本地创作可继续`
              : "尚未登录云工作区"}
      </span>
      {open && (
        <div className="cloud-content">
          {unavailable ? (
            <p>当前部署未连接云服务。可继续本地编辑，并导出可恢复项目包。</p>
          ) : capabilities && !session ? (
            <LoginPanel capabilities={capabilities} onLogin={login} />
          ) : session ? (
            <>
              <WorkspaceSwitcher onChange={change} />
              {workspace && (
                <div key={workspace}>
                  <label>
                    打开云相册
                    <select
                      aria-label="打开云相册"
                      defaultValue=""
                      onChange={async (e) => {
                        const projectId = e.target.value;
                        if (!projectId) return;
                        const gen = ++epoch.current;
                        setSaving(true);
                        try {
                          const value = await new CloudRevisionStore(
                            apiBase,
                            workspace,
                            cloudFetch,
                          ).load(projectId);
                          if (gen !== epoch.current) return;
                          const cached = await cacheCloudProject(value);
                          if (gen !== epoch.current) return;
                          remote.current = {
                            id: projectId,
                            revision: value.doc.revision,
                          };
                          localProject.current = cached.doc.projectId;
                          onOpen(cached);
                          setStatus("云相册已打开；本地原项目仍保留");
                        } catch {
                          if (gen === epoch.current)
                            setStatus("无法打开云相册，原本地项目仍保留");
                        } finally {
                          if (gen === epoch.current) setSaving(false);
                        }
                      }}
                    >
                      <option value="">选择相册</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    disabled={saving || !canSave}
                    onClick={() => void save()}
                  >
                    保存当前相册到云端
                  </button>
                  <p role="status">{status}</p>
                  {status.includes("其他设备") && (
                    <p>
                      恢复草稿和本地项目包仍保留。请先导出项目包，再从云端核对最新版本。
                    </p>
                  )}
                  <a
                    href={`./commerce.html?workspace=${encodeURIComponent(workspace)}`}
                  >
                    会员、订单与任务中心 →
                  </a>
                  <a
                    href={`./commerce.html?workspace=${encodeURIComponent(workspace)}#export`}
                  >
                    导出已保存的云相册 →
                  </a>
                  <a
                    href={`./commerce.html?workspace=${encodeURIComponent(workspace)}#art`}
                  >
                    AI 创作 →
                  </a>
                  <WorkspaceTools
                    workspaceId={workspace}
                    onCreate={async (width, height) => {
                      const gen = ++epoch.current,
                        targetWorkspace = workspace;
                      setSaving(true);
                      try {
                        const value = await api<DTO<"ProjectDocument">>(
                          `/workspaces/${id(targetWorkspace)}/projects`,
                          "POST",
                          {
                            name: "新相册",
                            mode: "full_editor",
                            scene: "other",
                            pageWidthMm: width,
                            pageHeightMm: height,
                            spreadCount: 10,
                          },
                        );
                        if (gen !== epoch.current) return;
                        const { hashDocument } =
                          await import("@album/document");
                        if (
                          (await hashDocument(
                            value.document as DocumentModel,
                          )) !== value.documentSha256
                        )
                          throw Error("相册校验失败");
                        const cached = await cacheCloudProject({
                          doc: value.document as DocumentModel,
                          resources: (value.resources ?? {
                            assets: [],
                            fonts: [],
                          }) as ResourceManifest,
                          docHash: value.documentSha256,
                          savedAt: value.project.updatedAt,
                        });
                        if (gen !== epoch.current) return;
                        remote.current = {
                          id: value.project.id,
                          revision: value.project.revision,
                        };
                        localProject.current = cached.doc.projectId;
                        onOpen(cached);
                        setStatus("已按工作区默认尺寸新建相册，原作品仍保留");
                      } finally {
                        if (gen === epoch.current) setSaving(false);
                      }
                    }}
                  />
                  <FolderBrowser
                    workspaceId={workspace}
                    onSelectAsset={async (assetId) => {
                      const gen = epoch.current;
                      setAsset(assetId);
                      setStatus("正在导入云素材…");
                      try {
                        const token = await api<DTO<"DownloadToken">>(
                          `/assets/${id(assetId)}/download-token?variant=original`,
                          "POST",
                        );
                        const response = await fetch(token.url, {
                          credentials: "omit",
                        });
                        if (!response.ok) throw Error("云素材下载失败");
                        const bytes = new Uint8Array(
                          await response.arrayBuffer(),
                        );
                        const hash = Array.from(
                          new Uint8Array(
                            await crypto.subtle.digest("SHA-256", bytes),
                          ),
                          (b) => b.toString(16).padStart(2, "0"),
                        ).join("");
                        if (
                          bytes.length !== token.sizeBytes ||
                          hash !== token.sha256
                        )
                          throw Error("云素材校验失败");
                        if (gen !== epoch.current) return;
                        await onImport(
                          new File([bytes], token.filename, {
                            type: token.mime,
                          }),
                        );
                        if (gen === epoch.current)
                          setStatus("云素材已导入照片库，可直接用于模板");
                      } catch (e) {
                        if (gen === epoch.current)
                          setStatus(
                            e instanceof Error ? e.message : "云素材导入失败",
                          );
                      }
                    }}
                  />
                  {asset && <p>云素材通过原图校验后导入当前照片库。</p>}
                </div>
              )}
              <AccountSettings
                onLogout={() => {
                  epoch.current++;
                  setUser(null);
                  change("");
                }}
              />
            </>
          ) : null}
        </div>
      )}
    </aside>
  );
}
