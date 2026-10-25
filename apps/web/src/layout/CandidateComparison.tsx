import { useEffect, useRef, useState } from "react";
import { createScene, type SceneHandle } from "@album/render";
import type { DocumentModel, Spread } from "@album/document";
import type { ResourceManifest, ResourcePort } from "@album/assets";
import type { LayoutCandidate } from "@album/layout";
function Preview({
  doc,
  spread,
  resources,
  port,
}: {
  doc: DocumentModel;
  spread: Spread;
  resources: ResourceManifest;
  port: ResourcePort;
}) {
  const host = useRef<HTMLDivElement>(null),
    [status, setStatus] = useState("loading");
  useEffect(() => {
    const controller = new AbortController(),
      canvas = document.createElement("canvas");
    host.current!.replaceChildren(canvas);
    let handle: SceneHandle | undefined;
    const width = doc.pageSize.width * 2,
      height = doc.pageSize.height,
      pixelScale = Math.min(1, 480 / width);
    void createScene(canvas, {
      doc,
      surface: {
        id: spread.id,
        sourceSpreadId: spread.id,
        clip: { x: 0, y: 0, width, height },
        bleedPx96: 0,
        background: spread.background,
        pixelWidth: Math.round(width * pixelScale),
        pixelHeight: Math.round(height * pixelScale),
      },
      manifest: resources,
      port,
      signal: controller.signal,
      pixelScale,
    })
      .then((scene) => {
        if (controller.signal.aborted) {
          scene.dispose();
          return;
        }
        handle = scene;
        setStatus("ready");
      })
      .catch(() => {
        if (!controller.signal.aborted) setStatus("error");
      });
    return () => {
      controller.abort();
      handle?.dispose();
    };
  }, [doc, spread, resources, port]);
  return (
    <div className="layout-preview">
      <div ref={host} />
      {status === "ready" ? (
        <span data-testid="layout-preview-ready">预览已就绪</span>
      ) : (
        <span>
          {status === "error" ? "预览失败，请检查素材" : "正在绘制照片…"}
        </span>
      )}
    </div>
  );
}
const warningText: Record<string, string> = {
  SUBJECT_UNKNOWN: "未进行主体识别，已完整保留照片。",
  SAFE_FIT_APPLIED: "已使用完整显示，避免裁切人脸和主体。",
  SUBJECT_CROP_RISK: "部分主体可能被裁剪，请检查照片。",
  LOCKED_CONTENT_OVERLAP_REVIEW: "保留了锁定内容，请检查与新照片的重叠。",
};
export function CandidateComparison({
  candidates,
  selected,
  onSelect,
  doc,
  resources,
  port,
}: {
  candidates: LayoutCandidate[];
  selected: number;
  onSelect: (i: number) => void;
  doc: DocumentModel;
  resources: ResourceManifest;
  port: ResourcePort;
}) {
  const c = candidates[selected],
    previewDoc = { ...doc, spreads: c.spreads };
  return (
    <section className="layout-comparison">
      <h3>
        选择一个方案 <small>{candidates.length} 个有效方案</small>
      </h3>
      <div
        className="layout-candidate-tabs"
        role="radiogroup"
        aria-label="排版候选方案"
      >
        {candidates.map((c, i) => (
          <label key={c.candidateId}>
            <input
              type="radio"
              name="layout-candidate"
              checked={selected === i}
              onChange={() => onSelect(i)}
            />
            方案 {i + 1}
            <small>{c.spreads.length} 个跨页</small>
          </label>
        ))}
      </div>
      <p className="layout-integrity">
        已使用{" "}
        {c.assignmentManifest.inputAssetIds.length -
          c.assignmentManifest.unusedAssetIds.length}{" "}
        / {c.assignmentManifest.inputAssetIds.length} 张
      </p>
      <p>
        未使用 {c.assignmentManifest.unusedAssetIds.length} 张 · 重复{" "}
        {c.assignmentManifest.repeatedAssetIds.length} 张
      </p>
      {c.warnings.map((w) => (
        <p className="layout-warning" key={w.code}>
          {warningText[w.code] ?? w.message}
        </p>
      ))}
      {c.assignmentManifest.unusedAssetIds.length > 0 && (
        <details>
          <summary>查看未使用照片</summary>
          {c.assignmentManifest.unusedAssetIds.map((id) => (
            <p key={id}>
              {resources.assets.find((a) => a.id === id)?.source.name ?? id}
            </p>
          ))}
        </details>
      )}
      {c.assignmentManifest.repeatedAssetIds.length > 0 && (
        <details>
          <summary>查看重复照片位置</summary>
          {c.assignmentManifest.repeatedAssetIds.map((id) => (
            <p key={id}>
              {resources.assets.find((a) => a.id === id)?.source.name ?? id}：
              {c.assignmentManifest.placements
                .filter((p) => p.assetId === id)
                .map(
                  (p) =>
                    `跨页 ${c.spreads.findIndex((s) => s.id === p.spreadId) + 1}`,
                )
                .join("、")}
            </p>
          ))}
        </details>
      )}
      <div className="layout-spread-previews">
        {c.spreads.map((spread, i) => (
          <figure key={`${c.candidateId}-${spread.id}`}>
            <figcaption>跨页 {i + 1}</figcaption>
            <Preview
              doc={previewDoc}
              spread={spread}
              resources={resources}
              port={port}
            />
          </figure>
        ))}
      </div>
    </section>
  );
}
