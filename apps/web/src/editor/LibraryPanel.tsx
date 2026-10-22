import { originalThemeBundle } from "../templates/original-theme";
import type { ConvertedTheme } from "@album/template-import";
import { ThemeLibraryPanel } from "../templates/ThemeLibraryPanel";
import { useState } from "react";
import { TemplatePanel, type LibraryContext } from "./TemplatePanel";
import { FilterPanel } from "./FilterPanel";
export function LibraryPanel(ctx: LibraryContext) {
  const [tab, setTab] = useState("templates");
  const [seed, setSeed] = useState<ConvertedTheme>();
  const [error, setError] = useState("");
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
          onClick={() => setTab("imported")}
          aria-pressed={tab === "imported"}
        >
          我的模板
        </button>
        <button
          onClick={() => setTab("filters")}
          aria-pressed={tab === "filters"}
        >
          滤镜
        </button>
      </nav>
      {error && <p role="alert">{error}</p>}
      {tab === "templates" ? (
        <TemplatePanel
          {...ctx}
          onUseCollection={async (themeId) => {
            try {
              const value = await originalThemeBundle(themeId, ctx.resources);
              setSeed(value);
              setError("");
              setTab("imported");
            } catch (e) {
              setError(String(e));
            }
          }}
        />
      ) : tab === "imported" ? (
        <ThemeLibraryPanel {...ctx} initialTheme={seed} />
      ) : (
        <FilterPanel {...ctx} />
      )}
    </>
  );
}
