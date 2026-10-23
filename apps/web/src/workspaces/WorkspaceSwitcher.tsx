import { useEffect, useState } from "react";
import { api, type DTO, type Page } from "../cloud/api";
export function WorkspaceSwitcher({
  onChange,
}: {
  onChange: (workspaceId: string) => void;
}) {
  const [items, setItems] = useState<DTO<"Workspace">[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void api<Page<DTO<"Workspace">>>("/workspaces")
      .then((v) => {
        if (live) {
          setItems(v.items);
          if (v.items[0]) onChange(v.items[0].id);
        }
      })
      .catch((e) => {
        if (live) setError(String(e));
      });
    return () => {
      live = false;
    };
  }, [onChange]);
  return (
    <label>
      工作区{" "}
      <select aria-label="工作区" onChange={(e) => onChange(e.target.value)}>
        {items.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name} · {w.role === "viewer" ? "只读" : "创作"}
          </option>
        ))}
      </select>
      {error && <span role="alert">{error}</span>}
    </label>
  );
}
