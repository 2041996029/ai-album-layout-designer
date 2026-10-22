import type { DocumentModel } from "@album/document";
export function SpreadStrip({
  doc,
  active,
  onSelect,
  onAdd,
  onClone,
  onDelete,
  onMove,
  onReorder,
}: {
  doc: DocumentModel;
  active: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onClone: () => void;
  onDelete: () => void;
  onMove: (direction: number) => void;
  onReorder: (id: string, index: number) => void;
}) {
  return (
    <footer className="spread-strip">
      <div className="spread-summary">
        <b>相册页面</b>
        <small>
          {doc.spreads.length} 个跨页 · {doc.spreads.length * 2} 内页
        </small>
        <span>封面单独计数</span>
      </div>
      <div className="spread-items">
        {(["front", "back"] as const).map((cover, i) => (
          <button
            key={cover}
            className={`spread-card cover ${active === `cover:${cover}` ? "active" : ""}`}
            onClick={() => onSelect(`cover:${cover}`)}
            aria-label={i ? "封底" : "封面"}
          >
            <div className="spread-preview">
              <span>{i ? "BACK" : "COVER"}</span>
            </div>
            <small>{i ? "封底" : "封面"}</small>
          </button>
        ))}
        <span className="strip-divider" />
        {doc.spreads.map((s, index) => (
          <button
            key={s.id}
            className={`spread-card ${active === s.id ? "active" : ""}`}
            aria-label={`跨页 ${index + 1}`}
            onClick={() => onSelect(s.id)}
            draggable
            onDragStart={(e) =>
              e.dataTransfer.setData("application/x-album-spread", s.id)
            }
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const id = e.dataTransfer.getData("application/x-album-spread");
              const from = doc.spreads.findIndex((s) => s.id === id);
              if (id && from !== index) {
                onReorder(id, index);
              }
            }}
          >
            <div
              className="spread-preview"
              style={{ background: s.background }}
            >
              <span>
                {s.layers.length ? `${s.layers.length} 图层` : "空白跨页"}
              </span>
              <i />
            </div>
            <small>
              {index * 2 + 1} — {index * 2 + 2}
            </small>
          </button>
        ))}
        <button
          className="add-spread"
          aria-label="添加跨页"
          disabled={doc.spreads.length >= 50}
          onClick={onAdd}
        >
          ＋<small>添加跨页</small>
        </button>
      </div>
      <div className="spread-actions">
        <button
          onClick={onClone}
          disabled={active.startsWith("cover:") || doc.spreads.length >= 50}
          aria-label="复制跨页"
        >
          复制跨页
        </button>
        <div>
          <button
            aria-label="跨页前移"
            disabled={active.startsWith("cover:")}
            onClick={() => onMove(-1)}
          >
            ←
          </button>
          <button
            aria-label="跨页后移"
            disabled={active.startsWith("cover:")}
            onClick={() => onMove(1)}
          >
            →
          </button>
          <button
            aria-label="删除跨页"
            onClick={onDelete}
            disabled={active.startsWith("cover:") || doc.spreads.length <= 1}
          >
            删除
          </button>
        </div>
      </div>
    </footer>
  );
}
