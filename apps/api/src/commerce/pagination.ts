import type { PoolClient } from "pg";
import { fail } from "@album/server-core";
import { pageLimit, pageCursor, readPageCursor } from "../assets/pagination";
type Row = Record<string, any>;
export type CommercePage<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};
function context(request: any, scope: string, workspaceId?: string) {
  const query = request.query ?? {},
    filters = Object.fromEntries(
      Object.entries(query)
        .filter(([k]) => !["cursor", "limit"].includes(k))
        .sort(([a], [b]) => a.localeCompare(b)),
    );
  const owner = workspaceId ?? `admin:${request.actor.userId}`;
  const limit = pageLimit(
    query.limit === undefined ? undefined : Number(query.limit),
  );
  const cursor = readPageCursor(
    query.cursor,
    "commerce:" + scope,
    owner,
    filters,
  );
  if (cursor && (!cursor.value || !Number.isFinite(Date.parse(cursor.value))))
    fail("INVALID_CURSOR");
  return { query, filters, owner, limit, cursor, scope: "commerce:" + scope };
}
function result<T extends Row>(
  rows: T[],
  c: ReturnType<typeof context>,
): CommercePage<T> {
  const last = rows[c.limit - 1],
    hasMore = rows.length > c.limit;
  return {
    items: rows.slice(0, c.limit),
    hasMore,
    nextCursor: hasMore
      ? pageCursor(c.scope, c.owner, c.filters, {
          id: last.id,
          value: last.cursor_created_at,
        })
      : null,
  };
}
/** Code-owned SQL is wrapped with bounded keyset pagination. No request provides SQL identifiers. */
export async function sqlPage(
  tx: PoolClient,
  request: any,
  scope: string,
  sql: string,
  parameters: unknown[] = [],
  workspaceId?: string,
): Promise<CommercePage<Row>> {
  const c = context(request, scope, workspaceId),
    values = [...parameters],
    clauses: string[] = [];
  const bind = (v: unknown) => {
    values.push(v);
    return "$" + values.length;
  };
  const columns: Record<string, string> = {
    workspaceId: "workspace_id",
    kind: "kind",
    state: "state",
    actorId: "actor_user_id",
    targetId: "target_id",
    action: "action",
    category: "namespace",
  };
  for (const [key, column] of Object.entries(columns))
    if (c.query[key] !== undefined)
      clauses.push(`p.${column}=${bind(c.query[key])}`);
  if (c.query.from !== undefined)
    clauses.push(`p.created_at>=${bind(c.query.from)}::timestamptz`);
  if (c.query.to !== undefined)
    clauses.push(`p.created_at<=${bind(c.query.to)}::timestamptz`);
  if (
    c.query.from &&
    c.query.to &&
    Date.parse(c.query.from) > Date.parse(c.query.to)
  )
    fail("INVALID_REQUEST");
  if (c.cursor)
    clauses.push(
      `(p.created_at,p.id)<(${bind(c.cursor.value)}::timestamptz,${bind(c.cursor.id)}::text)`,
    );
  const rows = (
    await tx.query(
      `SELECT p.*,p.created_at::text AS cursor_created_at FROM (${sql}) p ${clauses.length ? "WHERE " + clauses.join(" AND ") : ""} ORDER BY p.created_at DESC,p.id DESC LIMIT ${bind(c.limit + 1)}`,
      values,
    )
  ).rows;
  return result(rows, c);
}
export async function mapPage<T, U>(
  page: CommercePage<T>,
  map: (item: T) => U | Promise<U>,
): Promise<CommercePage<U>> {
  return { ...page, items: await Promise.all(page.items.map(map)) };
}
/** Only intrinsically bounded collections (one active SKU, <=102 export faces) use memory pagination. */
export function arrayPage<T extends { id: string; createdAt: string }>(
  request: any,
  scope: string,
  items: T[],
  workspaceId?: string,
): CommercePage<T> {
  const c = context(request, scope, workspaceId),
    rows = items
      .map((x) => ({ ...x, cursor_created_at: x.createdAt }))
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      )
      .filter(
        (x) =>
          !c.cursor ||
          x.createdAt < c.cursor.value! ||
          (x.createdAt === c.cursor.value && x.id < c.cursor.id),
      );
  const page = result(rows, c);
  return {
    ...page,
    items: page.items.map(({ cursor_created_at, ...x }) => x as unknown as T),
  };
}
