import type { PreflightReport } from "@album/export";
export function PreflightPanel({
  report,
  acknowledged,
  onChange,
}: {
  report: PreflightReport;
  acknowledged: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <section className="preflight-panel" aria-label="导出检查">
      <h3>导出检查</h3>
      <p>预计工作集 {Math.ceil(report.estimatedBytes / 1024 ** 2)} MiB</p>
      <p>
        工作集是导出过程中预计占用的内存，不是文件大小。下方错误需要修复后再导出。
      </p>
      <ul>
        {report.surfaces.map((s) => (
          <li key={s.id}>
            {s.fileStem} · {s.pixelWidth} × {s.pixelHeight} px
          </li>
        ))}
      </ul>
      {report.blockers.map((i) => (
        <p className="preflight-blocker" role="alert" key={i.id}>
          {i.surfaceId
            ? `${report.surfaces.find((s) => s.id === i.surfaceId)?.fileStem ?? i.surfaceId} · `
            : ""}
          {i.code}：{i.message}
        </p>
      ))}
      {report.warnings.length > 0 && (
        <div>
          <button onClick={() => onChange(report.warnings.map((i) => i.id))}>
            确认全部已检查的预警
          </button>
          <button onClick={() => onChange([])}>清空预警确认</button>
        </div>
      )}
      {report.warnings.map((i) => (
        <label
          className={`preflight-warning ${i.level === "strong" ? "strong" : ""}`}
          key={i.id}
        >
          <input
            type="checkbox"
            checked={acknowledged.includes(i.id)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...acknowledged, i.id]
                  : acknowledged.filter((id) => id !== i.id),
              )
            }
          />
          {i.level === "strong" ? "强预警 · " : ""}
          {i.message} 我已检查并接受。
        </label>
      ))}
      {!report.blockers.length && !report.warnings.length && (
        <p className="preflight-success">检查通过。</p>
      )}
    </section>
  );
}
