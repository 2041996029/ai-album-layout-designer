import { useState } from "react";
import { api, id, type Page } from "../cloud/api";
export function PagedMore<T>({
  path,
  cursor,
  label,
  onPage,
}: {
  path: string;
  cursor: string | null | undefined;
  label: string;
  onPage: (page: Page<T>) => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if (!cursor) return null;
  return (
    <div>
      {error && <p role="alert">{error}</p>}
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            onPage(
              await api<Page<T>>(
                `${path}${path.includes("?") ? "&" : "?"}cursor=${id(cursor)}`,
              ),
            );
          } catch (e) {
            setError(String(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "读取中…" : label}
      </button>
    </div>
  );
}
