import { useEffect, useRef } from "react";
import type { PreflightIssue, PreflightReport } from "@album/export";
const labels: Record<string, [string, string]> = {
  LOW_PPI: [
    "清晰度偏低",
    "可缩小照片画框，或更换更高分辨率原片；检查实际效果后再确认。",
  ],
  TEXT_OVERFLOW: ["文字超出文本框", "使用自动适配，或返回画布扩大文字框。"],
  SAFE_AREA: ["内容靠近裁切边缘", "检查照片和文字是否需要向内移动。"],
  GUTTER_TEXT: ["文字靠近装订线", "检查跨页中央的文字，避免被装订遮挡。"],
  ASSET_MISSING: ["照片资源缺失", "重新导入对应原片后再检查。"],
  FONT_UNAVAILABLE: ["字体不可用", "更换为本地可用字体后再检查。"],
  MEMORY_BUDGET: ["导出内存不足", "降低 DPI 或分批导出页面。"],
  PIXEL_BUDGET: ["输出尺寸过大", "降低 DPI 后重新检查。"],
};
function GroupCheck({
  checked,
  partial,
  disabled,
  onChange,
  count,
}: {
  checked: boolean;
  partial: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
  count: number;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = partial;
  }, [partial]);
  return (
    <label className="preflight-group-confirm">
      <input
        ref={ref}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={`确认此类 ${count} 项预警`}
        onChange={(e) => onChange(e.target.checked)}
      />
      确认此类 {count} 项预警
    </label>
  );
}
export function PreflightPanel({
  report,
  acknowledged,
  onChange,
  disabled = false,
}: {
  report: PreflightReport;
  acknowledged: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const pending = report.warnings.filter(
    (i) => !acknowledged.includes(i.id),
  ).length;
  const groups = (issues: PreflightIssue[]) => {
    const result = new Map<string, PreflightIssue[]>();
    for (const issue of issues) {
      const key = `${issue.code}:${issue.level ?? "normal"}`;
      result.set(key, [...(result.get(key) ?? []), issue]);
    }
    return [...result.entries()];
  };
  const renderGroups = (issues: PreflightIssue[], warning: boolean) =>
    groups(issues).map(([key, items]) => {
      const first = items[0],
        [title, help] = labels[first.code] ?? [
          warning ? "需要检查" : "需要修复",
          "展开详情查看对应页面和内容。",
        ];
      const checked = items.filter((i) => acknowledged.includes(i.id)).length;
      return (
        <article
          className={`preflight-issue-group ${warning ? "warning" : "blocker"} ${first.level === "strong" ? "strong" : ""}`}
          key={key}
        >
          <header>
            <b role={warning ? undefined : "alert"}>{title}</b>
            <span>
              {items.length} 项{first.level === "strong" ? " · 强预警" : ""}
            </span>
            <small>{first.code}</small>
          </header>
          <p>{help}</p>
          {warning && (
            <GroupCheck
              checked={checked === items.length}
              partial={checked > 0 && checked < items.length}
              disabled={disabled}
              count={items.length}
              onChange={(value) => {
                const ids = new Set(items.map((i) => i.id));
                onChange(
                  value
                    ? [...new Set([...acknowledged, ...ids])]
                    : acknowledged.filter((id) => !ids.has(id)),
                );
              }}
            />
          )}
          <details open={!warning && issues.length === 1}>
            <summary>查看详情（{items.length} 项）</summary>
            <div className="preflight-issue-details">
              {items.map((i) => {
                const surface = i.surfaceId
                  ? `${report.surfaces.find((s) => s.id === i.surfaceId)?.fileStem ?? i.surfaceId} · `
                  : "";
                return warning ? (
                  <label className="preflight-warning" key={i.id}>
                    <input
                      type="checkbox"
                      checked={acknowledged.includes(i.id)}
                      disabled={disabled}
                      onChange={(e) =>
                        onChange(
                          e.target.checked
                            ? [...new Set([...acknowledged, i.id])]
                            : acknowledged.filter((id) => id !== i.id),
                        )
                      }
                    />
                    <span>
                      {surface}
                      {i.message} 我已检查并接受。
                    </span>
                  </label>
                ) : (
                  <p className="preflight-blocker" key={i.id}>
                    {surface}
                    {i.message}
                  </p>
                );
              })}
            </div>
          </details>
        </article>
      );
    });
  return (
    <section className="preflight-panel" aria-label="导出检查">
      <div className="preflight-heading">
        <h3>导出检查</h3>
        <span>{report.surfaces.length} 个输出面</span>
      </div>
      <p className="preflight-summary" role="status">
        需修复 {report.blockers.length} 项 · 预警 {report.warnings.length} 项 ·
        待确认 {pending} 项
      </p>
      <details className="preflight-specs">
        <summary>
          输出规格 · 预计工作集 {Math.ceil(report.estimatedBytes / 1024 ** 2)}{" "}
          MiB
        </summary>
        <p>工作集是导出时预计占用的内存，不是文件大小。</p>
        <ul>
          {report.surfaces.map((s) => (
            <li key={s.id}>
              {s.fileStem} · {s.pixelWidth} × {s.pixelHeight} px
            </li>
          ))}
        </ul>
      </details>
      {renderGroups(report.blockers, false)}
      {!!report.warnings.length && (
        <>
          <div className="preflight-bulk">
            <button
              disabled={disabled}
              onClick={() => onChange(report.warnings.map((i) => i.id))}
            >
              确认全部已检查的预警
            </button>
            <button
              disabled={disabled || !acknowledged.length}
              onClick={() => onChange([])}
            >
              清空预警确认
            </button>
          </div>
          {renderGroups(report.warnings, true)}
        </>
      )}
      {!report.blockers.length && !report.warnings.length && (
        <p className="preflight-success">检查通过。</p>
      )}
    </section>
  );
}
