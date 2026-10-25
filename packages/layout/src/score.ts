import type { ComposedSpread } from "./compose";
import type { LayoutWeights } from "./types";
export function scoreSpread(
  spread: ComposedSpread,
  weights: LayoutWeights,
): ComposedSpread["score"] {
  const keys = [
    "subject",
    "timeline",
    "whitespace",
    "variety",
    "color",
  ] as const;
  const sum = keys.reduce((s, k) => s + weights[k], 0);
  if (
    !Number.isFinite(sum) ||
    sum <= 0 ||
    keys.some((k) => !Number.isFinite(weights[k]) || weights[k] < 0)
  )
    throw new Error("INVALID_POLICY");
  const score = { ...spread.score };
  for (const key of keys)
    score[key] = Number.isFinite(score[key])
      ? Math.max(0, Math.min(1, score[key]))
      : 0;
  score.total = spread.hardViolations.length
    ? -1
    : keys.reduce((s, k) => s + score[k] * weights[k], 0) / sum;
  return score;
}
