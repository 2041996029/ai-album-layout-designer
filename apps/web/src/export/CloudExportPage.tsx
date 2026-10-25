import { useEffect, useState, useRef } from "react";
import { allSurfaceIds } from "@album/export";
import type { DocumentModel } from "@album/document";
import { api, id, type DTO, type Page } from "../cloud/api";

/** Exports the selected saved cloud revision. Local editor export remains separate. */
export function CloudExportPage({ workspaceId }: { workspaceId: string }) {
  const [projects, setProjects] = useState<DTO<"Project">[]>([]),
    [projectId, setProjectId] = useState(""),
    [format, setFormat] = useState<"png" | "jpeg" | "pdf">("png"),
    [dpi, setDpi] = useState<72 | 150 | 300>(72),
    [capability, setCapability] = useState("loading"),
    [preflight, setPreflight] = useState<DTO<"PreflightResult">>(),
    [acknowledged, setAcknowledged] = useState<string[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [job, setJob] = useState<DTO<"Job">>();
  const epoch = useRef(0),
    acceptKey = useRef("");
  function invalidate() {
    epoch.current++;
    setPreflight(undefined);
    setAcknowledged([]);
    setJob(undefined);
    setError("");
    setBusy(false);
  }
  useEffect(() => {
    let live = true;
    invalidate();
    setProjects([]);
    setProjectId("");
    void api<DTO<"Capabilities">>("/capabilities?platform=web")
      .then((c) => {
        if (live)
          setCapability(
            c.capabilities.find((c) => c.key === "cloudExport")?.status ??
              "unconfigured",
          );
      })
      .catch(() => {
        if (live) setCapability("unconfigured");
      });
    void (async () => {
      let cursor: string | null = null;
      const items: DTO<"Project">[] = [];
      do {
        const page: Page<DTO<"Project">> = await api(
          `/workspaces/${id(workspaceId)}/projects${cursor ? `?cursor=${id(cursor)}` : ""}`,
        );
        items.push(...page.items);
        cursor = page.hasMore ? page.nextCursor : null;
      } while (cursor && live);
      if (live) setProjects(items);
    })().catch((e) => {
      if (live) setError(String(e));
    });
    return () => {
      live = false;
      epoch.current++;
    };
  }, [workspaceId]);
  async function check() {
    const gen = ++epoch.current;
    setBusy(true);
    setError("");
    setPreflight(undefined);
    setAcknowledged([]);
    setJob(undefined);
    try {
      const saved = await api<DTO<"ProjectDocument">>(
        `/projects/${id(projectId)}`,
        "GET",
        undefined,
        { "X-Workspace-Id": workspaceId },
      );
      const request: DTO<"PreflightRequest"> = {
        revision: saved.project.revision,
        exportSpec: {
          format,
          dpi,
          view: "spread",
          pageIds: allSurfaceIds(
            saved.document as DocumentModel,
            "spread",
            false,
          ),
          includeCover: false,
          bleedMm: 3,
          jpegMatte: "#FFFFFF",
        },
      };
      const result = await api<DTO<"PreflightResult">>(
        `/projects/${id(projectId)}/preflight`,
        "POST",
        request,
        { "X-Workspace-Id": workspaceId },
      );
      if (gen !== epoch.current) return;
      acceptKey.current = crypto.randomUUID();
      setPreflight(result);
    } catch (e) {
      if (gen === epoch.current) setError(String(e));
    } finally {
      if (gen === epoch.current) setBusy(false);
    }
  }
  async function submit() {
    if (!preflight?.preflightToken) return;
    const gen = epoch.current;
    setBusy(true);
    setError("");
    try {
      const input: DTO<"ExportJobCreate"> = {
        workspaceId,
        projectId: preflight.projectId,
        revision: preflight.revision,
        preflightToken: preflight.preflightToken,
        normalizedSpecHash: preflight.normalizedSpecHash,
        warningsAcknowledged: acknowledged,
      };
      const accepted = await api<DTO<"Job">>("/export-jobs", "POST", input, {
        "Idempotency-Key": acceptKey.current,
        "X-Workspace-Id": workspaceId,
      });
      if (gen === epoch.current) setJob(accepted);
    } catch (e) {
      if (gen === epoch.current) setError(String(e));
    } finally {
      if (gen === epoch.current) setBusy(false);
    }
  }
  const warnings =
    preflight?.issues.filter((i) => i.acknowledgementRequired) ?? [];
  return (
    <section className="commerce-page">
      <div className="eyebrow">SAVED CLOUD PROJECT</div>
      <h1>云端导出</h1>
      <p>
        选择已保存的云相册，预检后确认警告并提交。尚未保存的编辑请先在编辑器保存到云端。
      </p>
      {capability !== "available" && (
        <p role="status">
          云端导出
          {capability === "loading" ? "正在检查可用性" : "尚未配置或暂不可用"}
          。编辑器中的本地导出仍可使用。
        </p>
      )}
      <label>
        已保存的云相册
        <select
          aria-label="已保存的云相册"
          value={projectId}
          disabled={busy}
          onChange={(e) => {
            invalidate();
            setProjectId(e.target.value);
          }}
        >
          <option value="">选择相册</option>
          {projects.map((p) => (
            <option value={p.id} key={p.id}>
              {p.name} · 已保存版本 {p.revision}
            </option>
          ))}
        </select>
      </label>
      <label>
        格式
        <select
          value={format}
          disabled={busy}
          onChange={(e) => {
            invalidate();
            setFormat(e.target.value as typeof format);
          }}
        >
          {["png", "jpeg", "pdf"].map((f) => (
            <option key={f}>{f}</option>
          ))}
        </select>
      </label>
      <label>
        DPI
        <select
          value={dpi}
          disabled={busy}
          onChange={(e) => {
            invalidate();
            setDpi(Number(e.target.value) as typeof dpi);
          }}
        >
          {[72, 150, 300].map((d) => (
            <option key={d}>{d}</option>
          ))}
        </select>
      </label>
      <button
        disabled={busy || !projectId || capability !== "available"}
        onClick={() => void check()}
      >
        检查云端导出
      </button>
      {error && (
        <p role="alert">
          {error.includes("RESOURCE_BUDGET_REVIEW_REQUIRED")
            ? "此规格曾超出资源预算，请降低 DPI 或调整输出规模后重新预检。"
            : `${error}；内容或权限变化后请重新预检。`}
        </p>
      )}
      {preflight && (
        <div>
          <h2>服务器预检 · 版本 {preflight.revision}</h2>
          <p>
            {preflight.surfaces.length} 个输出面 · 有效至 {preflight.expiresAt}
          </p>
          {preflight.issues.map((i) => (
            <div key={i.id}>
              {i.acknowledgementRequired ? (
                <label>
                  <input
                    type="checkbox"
                    disabled={busy || !!job}
                    checked={acknowledged.includes(i.id)}
                    onChange={(e) =>
                      setAcknowledged((v) =>
                        e.target.checked
                          ? [...v, i.id]
                          : v.filter((x) => x !== i.id),
                      )
                    }
                  />
                  我已了解{i.severity === "strong_warning" ? "强警告" : "警告"}
                  ：{i.message}
                </label>
              ) : (
                <p role="alert">阻断：{i.message}</p>
              )}
            </div>
          ))}
          <button
            disabled={
              busy ||
              !!job ||
              preflight.blocked ||
              !preflight.preflightToken ||
              warnings.some((w) => !acknowledged.includes(w.id))
            }
            onClick={() => void submit()}
          >
            确认并提交云端导出
          </button>
        </div>
      )}
      {job && (
        <p role="status">
          云端任务已接受：<code>{job.id}</code> ·{" "}
          <a href="#tasks">在任务中心查看</a>
        </p>
      )}
    </section>
  );
}
