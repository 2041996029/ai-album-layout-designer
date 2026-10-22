import { useEffect, useRef, useState } from "react";
import { createScene, type SceneHandle } from "@album/render";
import type { ImportedPage, ConvertedTheme } from "@album/template-import";
export function ThemePreview({
  converted,
  page,
}: {
  converted: ConvertedTheme;
  page: ImportedPage;
}) {
  const host = useRef<HTMLDivElement>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const controller = new AbortController(),
      canvas = document.createElement("canvas");
    let scene: SceneHandle | undefined;
    host.current!.replaceChildren(canvas);
    setError("");
    const scale = Math.min(1, 640 / page.width);
    const doc = {
      schemaVersion: 1 as const,
      projectId: "preview",
      revision: 1,
      unit: "px96" as const,
      colorSpace: "srgb" as const,
      pageSize: { width: page.width / 2, height: page.height },
      printProfile: { bleedMm: 0, safeMm: 0 },
      cover: { front: [], back: [] },
      spreads: [
        { id: page.id, background: page.background, layers: page.layers },
      ],
    };
    void createScene(canvas, {
      doc,
      surface: {
        id: page.id,
        sourceSpreadId: page.id,
        clip: { x: 0, y: 0, width: page.width, height: page.height },
        bleedPx96: 0,
        background: page.background,
        pixelWidth: Math.round(page.width * scale),
        pixelHeight: Math.round(page.height * scale),
      },
      pixelScale: scale,
      manifest: converted.theme.resources,
      port: {
        async read(id, variant) {
          const b = converted.files.get(`${id}:${variant}`);
          if (!b) throw Error("缺少预览素材");
          return b;
        },
      },
      signal: controller.signal,
    })
      .then((s) => {
        if (controller.signal.aborted) s.dispose();
        else scene = s;
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(String(e));
      });
    return () => {
      controller.abort();
      scene?.dispose();
    };
  }, [converted, page]);
  return (
    <div className="theme-render-preview">
      <div ref={host} />
      {error && <p role="alert">转换预览失败：{error}</p>}
      <small>转换图层预览，应用后可继续替换照片。</small>
    </div>
  );
}
