import { createRoot } from "react-dom/client";
import { useState } from "react";
import { PreflightPanel } from "../../../apps/web/src/export/PreflightPanel";
import type { PreflightReport } from "@album/export";
export function mountPreflight(report: PreflightReport) {
  const node = document.createElement("div");
  document.body.append(node);
  function App() {
    const [ack, setAck] = useState<string[]>([]);
    return (
      <PreflightPanel report={report} acknowledged={ack} onChange={setAck} />
    );
  }
  createRoot(node).render(<App />);
}
