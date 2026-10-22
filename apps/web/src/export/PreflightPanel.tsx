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
    <section aria-label="导出检查">
      <h3>导出检查</h3>
      <p>预计工作集 {Math.ceil(report.estimatedBytes / 1024 ** 2)} MiB</p>
      <ul>
        {report.surfaces.map((s) => (
          <li key={s.id}>
            {s.fileStem} · {s.pixelWidth} × {s.pixelHeight} px
          </li>
        ))}
      </ul>
      {report.blockers.map((i) => (
        <p role="alert" key={i.id}>
          {i.code}：{i.message}
        </p>
      ))}
      {report.warnings.map((i) => (
        <label key={i.id} style={{ display: "block" }}>
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
      {!report.blockers.length && !report.warnings.length && <p>检查通过。</p>}
    </section>
  );
}
