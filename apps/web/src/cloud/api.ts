import type { components } from "../../../../packages/contracts/src/api";
export type DTO<K extends keyof components["schemas"]> =
  components["schemas"][K];
export const apiBase = (
  (import.meta as ImportMeta & { env?: Record<string, string> }).env
    ?.VITE_API_BASE_URL || "/v1"
).replace(/\/$/, "");
let csrf = "";
export function setSession(session: DTO<"WebSession"> | null) {
  csrf = session?.csrfToken ?? "";
}
export const cloudFetch: typeof fetch = (url, init = {}) =>
  fetch(url, {
    ...init,
    credentials: "include",
    headers: {
      ...(csrf ? { "X-CSRF-Token": csrf } : {}),
      ...Object.fromEntries(new Headers(init.headers)),
    },
  });
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<T> {
  const response = await cloudFetch(apiBase + path, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(method === "GET" ? {} : { "Idempotency-Key": crypto.randomUUID() }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (response.status === 204) return undefined as T;
  const value = await response.json().catch(() => null);
  if (!response.ok || !value || !("data" in value))
    throw new Error(value?.error?.message ?? "云服务暂不可用");
  return value.data as T;
}
export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};
export const id = encodeURIComponent;

export const ifMatch = (revision: number) => ({ "If-Match": `"${revision}"` });

export const cloudConfigured =
  !import.meta.env.PROD || Boolean(import.meta.env.VITE_API_BASE_URL);
