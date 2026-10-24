import { PagedMore } from "../commerce/PagedMore";
import { useEffect, useState } from "react";
import { api, id, type DTO, type Page } from "../cloud/api";
const states: Record<string, string> = {
  queued: "排队中",
  running: "处理中",
  packaging: "打包中",
  retry_wait: "等待重试",
  cancel_requested: "取消中",
  succeeded: "已完成",
  failed: "失败",
  cancelled: "已取消",
};
export function TaskCenter({
  workspaceId,
}: {
  workspaceId: string;
}): React.JSX.Element {
  const [jobs, setJobs] = useState<DTO<"Job">[]>([]),
    [next, setNext] = useState<string | null>(null),
    [error, setError] = useState("");
  async function refresh(reset = true) {
    try {
      setError("");
      const p = await api<Page<DTO<"Job">>>(
        `/workspaces/${id(workspaceId)}/jobs`,
      );
      setJobs((v) =>
        reset
          ? p.items
          : [
              ...p.items,
              ...v.filter((x) => !p.items.some((y) => y.id === x.id)),
            ],
      );
      if (reset) setNext(p.nextCursor);
    } catch (e) {
      setError(String(e));
    }
  }
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(false), 5000);
    return () => clearInterval(timer);
  }, [workspaceId]);
  return (
    <section className="commerce-page">
      <div className="eyebrow">DURABLE CLOUD TASKS</div>
      <h1>任务中心</h1>
      <p className="commerce-lead">离开页面，云端任务仍会继续。</p>
      <p className="muted">
        工作区 <code>{workspaceId}</code> · 状态来自数据库任务记录
      </p>
      <button onClick={() => void refresh()}>刷新任务</button>
      {error && (
        <p role="alert">
          {error.includes("FRESH_PREFLIGHT_REQUIRED")
            ? "内容、素材或警告已变化，请返回编辑器重新预检并确认。"
            : error.includes("FRESH_QUOTE_REQUIRED")
              ? "此任务需要重新报价，请返回创作流程。"
              : error}{" "}
          <a href="./index.html">返回编辑器</a>
        </p>
      )}
      {!jobs.length && (
        <div className="empty-state">
          暂无云端任务。接受导出后，可在这里跟踪进度。
        </div>
      )}
      <div className="task-grid">
        {jobs.map((j) => (
          <article className="task-card" key={j.id}>
            <div className="eyebrow">{j.kind.toUpperCase()}</div>
            <h2>
              {j.providerSubmissionState === "unknown"
                ? "确认中"
                : states[j.state]}
            </h2>
            <code>{j.id}</code>
            <progress max={100} value={j.progress} aria-label="任务进度" />
            <p>
              {j.progress}% · {j.stage}
            </p>
            {j.parentJobId && (
              <p>
                重试来源 <code>{j.parentJobId}</code>
              </p>
            )}
            {!["failed", "cancelled", "succeeded"].includes(j.state) && (
              <button
                onClick={async () => {
                  try {
                    await api(`/jobs/${id(j.id)}/cancel`, "POST", {
                      reason: "用户取消",
                    });
                    await refresh();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                取消任务
              </button>
            )}
            {["failed", "cancelled"].includes(j.state) && (
              <button
                onClick={async () => {
                  try {
                    await api(`/jobs/${id(j.id)}/retry`, "POST", {
                      expectedRevision: j.revision,
                      reason: "用户重试",
                    });
                    await refresh();
                  } catch (e) {
                    setError(String(e));
                  }
                }}
              >
                重试
              </button>
            )}
            {j.state === "succeeded" &&
              j.outputIds.map((output) => (
                <button
                  key={output}
                  onClick={async () => {
                    try {
                      const link = await api<{ url: string }>(
                        `/outputs/${id(output)}/download-token`,
                        "POST",
                      );
                      location.assign(link.url);
                    } catch (e) {
                      setError(String(e));
                    }
                  }}
                >
                  下载产物
                </button>
              ))}
          </article>
        ))}
      </div>
      <PagedMore<DTO<"Job">>
        path={`/workspaces/${id(workspaceId)}/jobs`}
        cursor={next}
        label="加载更多任务"
        onPage={(p) => {
          setJobs((v) => [...v, ...p.items]);
          setNext(p.nextCursor);
        }}
      />
    </section>
  );
}
