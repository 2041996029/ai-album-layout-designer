import { useEffect, useState, useRef } from "react";
import { api, id, ifMatch, type DTO, type Page } from "../cloud/api";
export function WorkspaceTools({
  workspaceId,
  onCreate,
}: {
  workspaceId: string;
  onCreate: (width: number, height: number) => Promise<void>;
}) {
  const [workspace, setWorkspace] = useState<DTO<"Workspace">>();
  const [name, setName] = useState("");
  const [width, setWidth] = useState(300),
    [height, setHeight] = useState(300);
  const [shares, setShares] = useState<DTO<"Share">[] | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    void api<DTO<"Workspace">>(`/workspaces/${id(workspaceId)}`)
      .then((w) => {
        if (live.current) {
          setWorkspace(w);
          setName(w.name);
          setWidth(w.defaults?.pageWidthMm ?? 300);
          setHeight(w.defaults?.pageHeightMm ?? 300);
        }
      })
      .catch(() => {
        if (live.current) setMessage("无法读取工作区设置");
      });
    void api<Page<DTO<"Share">>>(`/workspaces/${id(workspaceId)}/shares`)
      .then((p) => {
        if (live.current) setShares(p.items);
      })
      .catch(() => {
        if (live.current) setMessage("分享管理暂不可用");
      });
    return () => {
      live.current = false;
    };
  }, [workspaceId]);
  const manage = workspace?.role === "owner" || workspace?.role === "admin";
  return (
    <section aria-label="工作区设置与分享">
      <h2>工作区设置</h2>
      {manage && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            if (!workspace || busy) return;
            setBusy(true);
            setMessage("");
            try {
              const w = await api<DTO<"Workspace">>(
                `/workspaces/${id(workspaceId)}`,
                "PATCH",
                {
                  name,
                  defaultPageWidthMm: width,
                  defaultPageHeightMm: height,
                },
                ifMatch(workspace.revision),
              );
              if (live.current) {
                setWorkspace(w);
                setMessage("工作区设置已保存，仅用于新建相册");
              }
            } catch {
              if (live.current) setMessage("设置未保存，请刷新后重试");
            } finally {
              if (live.current) setBusy(false);
            }
          }}
        >
          <label>
            工作区名称
            <input
              required
              maxLength={80}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            新相册宽度（毫米）
            <input
              required
              type="number"
              min={50}
              max={1000}
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
            />
          </label>
          <label>
            新相册高度（毫米）
            <input
              required
              type="number"
              min={50}
              max={1000}
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
            />
          </label>
          <button disabled={busy}>保存工作区默认设置</button>
        </form>
      )}
      {workspace && workspace.role !== "viewer" && (
        <button
          disabled={
            busy || width < 50 || width > 1000 || height < 50 || height > 1000
          }
          onClick={async () => {
            if (busy) return;
            setBusy(true);
            try {
              await onCreate(
                workspace.defaults?.pageWidthMm ?? 300,
                workspace.defaults?.pageHeightMm ?? 300,
              );
            } catch {
              if (live.current) setMessage("新相册未打开，当前作品仍保留");
            } finally {
              if (live.current) setBusy(false);
            }
          }}
        >
          按工作区默认设置新建云相册
        </button>
      )}
      <p>默认尺寸只影响新建相册，已有相册保持原尺寸。</p>
      <h3>分享管理</h3>
      {shares?.length === 0 && (
        <p>暂无分享。云端预览导出服务接通后可创建分享。</p>
      )}
      <ul>
        {(shares ?? []).map((s) => (
          <li key={s.id}>
            预览分享 ·{" "}
            {s.state === "active"
              ? "有效"
              : s.state === "expired"
                ? "已到期"
                : "已撤销"}{" "}
            · 到期{" "}
            {new Date(s.expiresAt).toLocaleString("zh-CN", {
              timeZone: "Asia/Shanghai",
            })}
            {manage && s.state === "active" && (
              <button
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const changed = await api<DTO<"Share">>(
                      `/shares/${id(s.id)}`,
                      "DELETE",
                      undefined,
                      ifMatch(s.revision),
                    );
                    if (live.current)
                      setShares((old) =>
                        (old ?? []).map((v) => (v.id === s.id ? changed : v)),
                      );
                  } catch {
                    if (live.current) setMessage("撤销失败，请稍后重试");
                  } finally {
                    if (live.current) setBusy(false);
                  }
                }}
              >
                撤销分享
              </button>
            )}
          </li>
        ))}
      </ul>
      <p>
        撤销后停止签发新链接，已签发的下载链接最多仍可使用 300
        秒。分享只包含已生成的预览，不包含原片。
      </p>
      {message && <p role="status">{message}</p>}
    </section>
  );
}
