import { isGroupLayer, type Layer } from "@album/document";
import { label, type Patch } from "./types";
interface Props {
  layers: Layer[];
  selected: string[];
  onSelect: (ids: string[]) => void;
  patch: Patch;
}
export function LayerPanel({ layers, selected, onSelect, patch }: Props) {
  const rows = (list: Layer[], depth = 0): React.ReactNode =>
    [...list].reverse().map((layer) => (
      <div key={layer.id}>
        <div
          className={`layer-row ${selected.includes(layer.id) ? "selected" : ""}`}
          style={{ paddingLeft: 12 + depth * 16 }}
        >
          <button
            className="layer-select"
            aria-label={`选择图层 ${label(layer)}`}
            aria-pressed={selected.includes(layer.id)}
            onClick={(e) =>
              onSelect(
                e.shiftKey
                  ? selected.includes(layer.id)
                    ? selected.filter((id) => id !== layer.id)
                    : [...selected, layer.id]
                  : [layer.id],
              )
            }
          >
            <span className="layer-symbol">
              {layer.type === "image"
                ? "▧"
                : layer.type === "text"
                  ? "T"
                  : layer.type === "group"
                    ? "▣"
                    : "◇"}
            </span>
            {label(layer)}
          </button>
          <button
            title="显隐"
            aria-label={`切换显隐 ${layer.id}`}
            onClick={() => patch({ visible: !layer.visible }, [layer.id])}
          >
            {layer.visible ? "◉" : "○"}
          </button>
          <button
            title="锁定"
            aria-label={`切换锁定 ${layer.id}`}
            onClick={() => patch({ locked: !layer.locked }, [layer.id])}
          >
            {layer.locked ? "▣" : "▫"}
          </button>
        </div>
        {isGroupLayer(layer) && rows(layer.children, depth + 1)}
      </div>
    ));
  return (
    <section className="layers-panel">
      <div className="panel-heading">
        <h2>图层</h2>
        <small>由上至下</small>
      </div>
      {rows(layers)}
      {!layers.length && <p className="muted center">添加照片或形状开始创作</p>}
    </section>
  );
}
