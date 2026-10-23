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
