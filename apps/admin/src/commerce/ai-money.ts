export function parseYuan(input: string): number {
  const value = input.trim();
  if (!/^[0-9]+(?:\.[0-9]{1,2})?$/.test(value))
    throw Error("金额须为非负数，最多两位小数。");
  const [whole, fraction = ""] = value.split("."),
    fen = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (fen > BigInt(Number.MAX_SAFE_INTEGER)) throw Error("金额超出允许范围。");
  return Number(fen);
}
export function formatYuan(fen: number): string {
  if (!Number.isSafeInteger(fen) || fen < 0) throw Error("金额无效。");
  const value = BigInt(fen);
  return `${value / 100n}.${String(value % 100n).padStart(2, "0")}`;
}
