import {
  allLayers,
  isGroupLayer,
  isImageLayer,
  walkLayers,
  type DocumentModel,
  type Layer,
} from "@album/document";
import type { PreparedLayout } from "./types";
export type Allocation = {
  spreads: ReadonlyArray<{ spreadId: string; assetIds: string[] }>;
  unusedAssetIds: string[];
};
export type LayoutConflict = {
  code: string;
  assetIds: string[];
  spreadIds: string[];
  minimumRequiredSpreads: number | null;
  options: (
    "increaseSpreads" | "raiseCapacity" | "allowSelection" | "unlock"
  )[];
};
export type AllocationResult =
  { ok: true; value: Allocation } | { ok: false; conflicts: LayoutConflict[] };
export function allocateBook(
  p: PreparedLayout,
  d: DocumentModel,
): AllocationResult {
  const { constraints: c } = p.input;
  const fail = (
    code: string,
    assetIds: string[] = [],
    spreadIds: string[] = [],
    minimumRequiredSpreads: number | null = null,
  ): AllocationResult => ({
    ok: false,
    conflicts: [
      {
        code,
        assetIds,
        spreadIds,
        minimumRequiredSpreads,
        options:
          code === "CAPACITY_EXCEEDED"
            ? ["increaseSpreads", "raiseCapacity", "allowSelection"]
            : ["unlock"],
      },
    ],
  });
  if (d.projectId !== p.input.projectId || d.revision !== p.input.baseRevision)
    return fail("STALE_DOCUMENT");
  const layerIds = new Set(allLayers(d).map((l) => l.id));
  const existing = new Set(d.spreads.map((s) => s.id));
  if (
    c.lockedLayerIds?.some((id) => !layerIds.has(id)) ||
    [...(c.lockedSpreadIds ?? []), ...(c.targetSpreadIds ?? [])].some(
      (id) => !existing.has(id),
    )
  )
    return fail("UNKNOWN_LOCK_OR_TARGET");
  if (
    d.spreads.slice(c.spreadCount).some((s) => s.layers.length) ||
    (c.targetSpreadIds && c.spreadCount !== d.spreads.length)
  )
    return fail("SPREAD_COUNT_CONFLICT");
  const ids = new Set(p.orderedAssetIds),
    repeat = new Set(
      c.duplicatePolicy === "allowExplicit" ? c.explicitRepeatAssetIds : [],
    );
  const spreads = Array.from(
    { length: c.spreadCount },
    (_, i) => d.spreads[i] ?? { id: `layout_spread_${i + 1}`, layers: [] },
  );
  if (new Set(spreads.map((s) => s.id)).size !== spreads.length)
    return fail("SPREAD_ID_CONFLICT");
  const fixed = spreads.map(
    (s) =>
      !!c.lockedSpreadIds?.includes(s.id) ||
      (!!c.targetSpreadIds && !c.targetSpreadIds.includes(s.id)),
  );
  const locked = spreads.map((s, i) => {
    const found: string[] = [];
    const walk = (layers: Layer[], inherited: boolean) => {
      for (const l of layers) {
        const lock =
          inherited || l.locked === true || !!c.lockedLayerIds?.includes(l.id);
        if (isImageLayer(l) && lock && l.layoutPhotoRole !== "decoration")
          found.push(l.assetId);
        if (isGroupLayer(l)) walk(l.children, lock);
      }
    };
    for (const root of s.layers)
      walk(
        [root],
        fixed[i] ||
          [...walkLayers([root])].some(
            (l) => l.locked === true || c.lockedLayerIds?.includes(l.id),
          ),
      );
    return found;
  });
  const count = new Map<string, number>();
  for (let i = 0; i < spreads.length; i++) {
    if (locked[i].length > c.maxPhotosPerSpread)
      return fail("LOCKED_CAPACITY", locked[i], [spreads[i].id]);
    for (const id of locked[i]) {
      if (!ids.has(id) || c.excludedAssetIds?.includes(id))
        return fail("LOCKED_ASSET_NOT_SELECTED", [id], [spreads[i].id]);
      count.set(id, (count.get(id) ?? 0) + 1);
      if (count.get(id)! > 1 && !repeat.has(id))
        return fail("LOCKED_DUPLICATE", [id], [spreads[i].id]);
    }
  }
  if (c.selectionPolicy === "all" && c.excludedAssetIds?.length)
    return fail("EXCLUDED_REQUIRED_PHOTO", c.excludedAssetIds);
  let ordered = p.orderedAssetIds.filter(
    (id) => !c.excludedAssetIds?.includes(id),
  );
  const required = new Set([...(c.requiredAssetIds ?? []), ...count.keys()]);
  const totalCapacity = c.spreadCount * c.maxPhotosPerSpread;
  if (ordered.length > totalCapacity) {
    if (c.selectionPolicy === "all" || required.size > totalCapacity)
      return fail(
        "CAPACITY_EXCEEDED",
        [],
        [],
        Math.ceil(
          (c.selectionPolicy === "all" ? ordered.length : required.size) /
            c.maxPhotosPerSpread,
        ),
      );
    const weight = new Map(
      p.input.photos.map((photo) => [photo.assetId, photo.weight ?? 1]),
    );
    const optional = ordered
      .filter((id) => !required.has(id))
      .map((id, index) => ({ id, index }))
      .sort(
        (a, b) => weight.get(b.id)! - weight.get(a.id)! || a.index - b.index,
      );
    const kept = new Set([
      ...required,
      ...optional.slice(0, totalCapacity - required.size).map((v) => v.id),
    ]);
    ordered = ordered.filter((id) => kept.has(id));
  }
  // First satisfy the exact locked occurrence counts, then fill remaining mandatory space.
  for (const [id, n] of count)
    while (ordered.filter((v) => v === id).length < n)
      ordered.splice(ordered.lastIndexOf(id) + 1, 0, id);
  const minimum = c.spreadCount * c.minPhotosPerSpread;
  const deficit = Math.max(0, minimum - ordered.length);
  if (deficit) {
    const allowed = ordered.filter(
      (id, index) => repeat.has(id) && ordered.indexOf(id) === index,
    );
    if (!allowed.length) return fail("INSUFFICIENT_PHOTOS");
    for (let k = 0; k < deficit; k++) {
      const id = allowed[k % allowed.length];
      ordered.splice(ordered.lastIndexOf(id) + 1, 0, id);
    }
  }
  if (ordered.length > totalCapacity) return fail("LOCKED_CAPACITY");
  const n = ordered.length,
    groups = new Map(
      p.input.photos.map((photo) => [photo.assetId, photo.groupId]),
    );
  const dp = Array.from({ length: spreads.length + 1 }, () =>
    new Float64Array(n + 1).fill(Infinity),
  );
  const prev = Array.from({ length: spreads.length + 1 }, () =>
    new Int32Array(n + 1).fill(-1),
  );
  dp[0][0] = 0;
  const average = n / spreads.length;
  for (let page = 0; page < spreads.length; page++)
    for (let start = 0; start <= n; start++) {
      if (!Number.isFinite(dp[page][start])) continue;
      const low = fixed[page] ? locked[page].length : c.minPhotosPerSpread,
        high = fixed[page] ? low : c.maxPhotosPerSpread;
      for (let size = low; size <= high && start + size <= n; size++) {
        const end = start + size,
          segment = ordered.slice(start, end),
          local = new Map<string, number>();
        for (const id of segment) local.set(id, (local.get(id) ?? 0) + 1);
        const needed = new Map<string, number>();
        for (const id of locked[page])
          needed.set(id, (needed.get(id) ?? 0) + 1);
        if (
          [...needed].some(([id, k]) => (local.get(id) ?? 0) < k) ||
          (fixed[page] && segment.join("\0") !== locked[page].join("\0"))
        )
          continue;
        // Reserve locked occurrences on later pages rather than consuming them here.
        if (
          locked
            .slice(page + 1)
            .flat()
            .some((id) => !ordered.slice(end).includes(id))
        )
          continue;
        const chapterCut =
          end > 0 &&
          end < n &&
          groups.get(ordered[end - 1]) &&
          groups.get(ordered[end - 1]) === groups.get(ordered[end])
            ? 4
            : 0;
        const cost = dp[page][start] + (size - average) ** 2 + chapterCut;
        if (cost < dp[page + 1][end]) {
          dp[page + 1][end] = cost;
          prev[page + 1][end] = start;
        }
      }
    }
  if (!Number.isFinite(dp[spreads.length][n]))
    return fail(
      "LOCKED_ORDER_OR_CAPACITY",
      [],
      spreads.filter((_, i) => locked[i].length > 0).map((s) => s.id),
    );
  const result: Allocation["spreads"][number][] = [];
  let end = n;
  for (let page = spreads.length; page > 0; page--) {
    const start = prev[page][end];
    result.unshift({
      spreadId: spreads[page - 1].id,
      assetIds: ordered.slice(start, end),
    });
    end = start;
  }
  const used = new Set(ordered);
  return {
    ok: true,
    value: {
      spreads: result,
      unusedAssetIds: p.orderedAssetIds.filter((id) => !used.has(id)),
    },
  };
}
