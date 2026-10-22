import { useEffect, useState } from "react";
import type { AssetRecord, ResourcePort } from "@album/assets";
export function AssetPreview({
  asset,
  port,
}: {
  asset: AssetRecord;
  port: ResourcePort;
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true,
      owned = "";
    void port
      .read(asset.id, "preview")
      .then((bytes) => {
        if (active) {
          owned = URL.createObjectURL(
            new Blob([new Uint8Array(bytes)], { type: "image/png" }),
          );
          setUrl(owned);
        }
      })
      .catch(() => {
        if (active) setError("预览缺失：重新导入原片");
      });
    return () => {
      active = false;
      if (owned) URL.revokeObjectURL(owned);
    };
  }, [asset, port]);
  return url ? (
    <img src={url} alt={asset.source.name} />
  ) : (
    <span className="preview-placeholder">{error || "加载…"}</span>
  );
}
interface Props {
  assets: readonly AssetRecord[];
  port: ResourcePort;
  onImport: (files: File[]) => void;
  onAdd: (asset: AssetRecord) => void;
  onReplace: (asset: AssetRecord) => void;
  canReplace: boolean;
  onDelete: (asset: AssetRecord) => void;
  progress: string;
  retry: () => void;
  hasRetry: boolean;
}
export function AssetPanel(p: Props) {
  return (
    <section className="asset-panel">
      <div className="panel-heading">
        <h2>照片素材</h2>
        <small>{p.assets.length} / 500</small>
      </div>
      <label className="import-card">
        <span>＋</span>
        <b>导入照片</b>
        <small>JPEG / PNG · 单张最大 25MB</small>
        <input
          aria-label="导入照片"
          type="file"
          accept="image/jpeg,image/png"
          multiple
          onChange={(e) => {
            p.onImport(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
      </label>
      {p.progress && <p className="import-progress">{p.progress}</p>}
      {p.hasRetry && (
        <button className="wide" onClick={p.retry}>
          重试失败导入
        </button>
      )}
      <p className="panel-hint">拖动照片到画布，或点击添加。原片始终保留。</p>
      <div className="asset-grid">
        {p.assets.map((asset) => (
          <article
            className="asset-tile"
            key={asset.id}
            draggable
            onDragStart={(e) =>
              e.dataTransfer.setData("application/x-album-asset", asset.id)
            }
          >
            <button
              aria-label={`添加照片 ${asset.source.name}`}
              className="asset-image"
              onClick={() => p.onAdd(asset)}
            >
              <AssetPreview asset={asset} port={p.port} />
              <span>＋ 添加</span>
            </button>
            <div className="asset-name" title={asset.source.name}>
              {asset.source.name}
            </div>
            <small>
              {asset.width} × {asset.height}
            </small>
            <div className="asset-actions">
              {p.canReplace && (
                <button
                  aria-label={`替换照片 ${asset.source.name}`}
                  onClick={() => p.onReplace(asset)}
                >
                  换入选框
                </button>
              )}
              <button
                aria-label={`删除素材 ${asset.source.name}`}
                onClick={() => p.onDelete(asset)}
              >
                移除
              </button>
            </div>
          </article>
        ))}
      </div>
      {!p.assets.length && (
        <p className="muted center">照片都在这里，故事由你安排。</p>
      )}
    </section>
  );
}
