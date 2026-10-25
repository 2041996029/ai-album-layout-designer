import { originalThemeBundle } from "../templates/original-theme";
import type { ConvertedTheme } from "@album/template-import";
import {
  ThemeLibraryPanel,
  themeErrorText,
} from "../templates/ThemeLibraryPanel";
import { useRef, useState } from "react";
import { TemplatePanel, type LibraryContext } from "./TemplatePanel";
import { FilterPanel } from "./FilterPanel";
export function LibraryPanel(ctx: LibraryContext) {
  const [tab, setTab] = useState("templates"),
    [seed, setSeed] = useState<ConvertedTheme>();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [visitedFilters, setVisitedFilters] = useState(false);
  const pending = useRef(false);
  return (
    <div className="library-workspace">
      <nav className="library-subtabs" aria-label="模板与滤镜分类">
        <button
          disabled={busy}
          onClick={() => setTab("templates")}
          aria-pressed={tab === "templates"}
        >
          模板
        </button>
        <button
          disabled={busy}
          onClick={() => setTab("imported")}
          aria-pressed={tab === "imported"}
        >
          {seed ? "套装详情" : "我的模板"}
        </button>
        <button
          disabled={busy}
          onClick={() => {
            setVisitedFilters(true);
            setTab("filters");
          }}
          aria-pressed={tab === "filters"}
        >
          滤镜
        </button>
      </nav>
      {busy && (
        <p className="library-feedback" role="status">
          正在套用模板，请稍候…
        </p>
      )}
      {error && (
        <p className="library-feedback" role="alert">
          {error}
        </p>
      )}
      <div hidden={tab !== "templates"}>
        <TemplatePanel
          {...ctx}
          pending={busy}
          onUseCollection={async (themeId) => {
            if (pending.current) return;
            pending.current = true;
            setBusy(true);
            setError("");
            try {
              const value = await originalThemeBundle(themeId, ctx.resources);
              if (await ctx.autoLayoutTheme(value)) {
                setSeed(value);
                setTab("imported");
              }
            } catch (e) {
              setError(themeErrorText(e));
            } finally {
              pending.current = false;
              setBusy(false);
            }
          }}
        />
      </div>
      <div hidden={tab !== "imported"}>
        <button className="library-back" onClick={() => setTab("templates")}>
          ← 返回模板库
        </button>
        <ThemeLibraryPanel {...ctx} initialTheme={seed} />
      </div>
      {visitedFilters && (
        <div hidden={tab !== "filters"}>
          <FilterPanel {...ctx} active={tab === "filters"} />
        </div>
      )}
    </div>
  );
}
