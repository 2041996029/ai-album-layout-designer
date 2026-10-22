import { useState } from "react";
import { TemplatePanel, type LibraryContext } from "./TemplatePanel";
import { FilterPanel } from "./FilterPanel";
export function LibraryPanel(ctx: LibraryContext) {
  const [tab, setTab] = useState("templates");
  return (
    <>
      <nav style={{ display: "flex", padding: 12, gap: 8 }}>
        <button
          onClick={() => setTab("templates")}
          aria-pressed={tab === "templates"}
        >
          模板
        </button>
        <button
          onClick={() => setTab("filters")}
          aria-pressed={tab === "filters"}
        >
          滤镜
        </button>
      </nav>
      {tab === "templates" ? (
        <TemplatePanel {...ctx} />
      ) : (
        <FilterPanel {...ctx} />
      )}
    </>
  );
}
