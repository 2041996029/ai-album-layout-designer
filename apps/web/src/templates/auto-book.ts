type Page = {
  id: string;
  photoSlots: unknown[];
  issues: { severity: string }[];
};
export function planThemeBook(
  pages: readonly Page[],
  photoCount: number,
): string[] {
  const usable = pages.filter(
    (p) =>
      p.photoSlots.length > 0 &&
      !p.issues.some((i) => i.severity === "blocker"),
  );
  if (
    !Number.isInteger(photoCount) ||
    photoCount < 1 ||
    photoCount > 500 ||
    !usable.length
  )
    throw Error("请先选择照片，并使用包含照片框的模板。");
  const cycle = usable.reduce((sum, p) => sum + p.photoSlots.length, 0);
  const complete: string[] = [];
  let remaining = photoCount;
  while (remaining >= cycle && complete.length + usable.length <= 50) {
    complete.push(...usable.map((p) => p.id));
    remaining -= cycle;
  }
  if (!remaining) return complete;
  const score = (path: string[]) =>
    path.length * 4 +
    path.reduce((n, id, i) => n + (path.slice(0, i).includes(id) ? 3 : 0), 0);
  while (true) {
    const paths: (string[] | undefined)[] = Array(remaining + 1);
    paths[0] = [];
    for (let n = 1; n <= remaining; n++)
      for (const page of usable) {
        const previous = paths[n - page.photoSlots.length];
        if (!previous || previous.length + complete.length >= 50) continue;
        const candidate = [...previous, page.id];
        if (!paths[n] || score(candidate) < score(paths[n]!))
          paths[n] = candidate;
      }
    if (paths[remaining]) return [...complete, ...paths[remaining]!];
    if (!complete.length)
      throw Error(
        "照片数量无法匹配此模板或超过 50 个跨页，请调整选片或选择其他模板。",
      );
    complete.splice(-usable.length);
    remaining += cycle;
  }
}

/** Keep the user's complete page selection, including pages with empty photo slots. */
export function planSelectedThemeBook(
  pages: readonly Page[],
  selectedIds: readonly string[],
  photoCount: number,
): string[] {
  if (!selectedIds.length) throw Error("请先选择用于整本排版的跨页。");
  if (!Number.isInteger(photoCount) || photoCount < 1 || photoCount > 500)
    throw Error("请先选择照片（最多 500 张）。");
  const selected = selectedIds.map((id) => {
    const page = pages.find((p) => p.id === id);
    if (!page || page.issues.some((i) => i.severity === "blocker"))
      throw Error("UNSUPPORTED_TEMPLATE_PAGE");
    return page;
  });
  const result = [...selectedIds];
  let capacity = selected.reduce((sum, p) => sum + p.photoSlots.length, 0);
  if (!capacity) throw Error("请选用包含照片框的跨页。");
  let cursor = 0;
  while (capacity < photoCount) {
    if (result.length >= 50)
      throw Error("排版超过 50 个跨页，请增加每页照片数或减少选片。");
    const page = selected[cursor++ % selected.length];
    if (!page.photoSlots.length) continue;
    result.push(page.id);
    capacity += page.photoSlots.length;
  }
  if (result.length > 50) throw Error("排版最多支持 50 个跨页。");
  return result;
}
