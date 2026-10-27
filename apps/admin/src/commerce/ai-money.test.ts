import { it, expect } from "vitest";
import { parseYuan, formatYuan } from "./ai-money";
it("converts yuan to integer fen without floating point rounding or scientific notation", () => {
  expect(parseYuan("0.29")).toBe(29);
  expect(parseYuan("12.3")).toBe(1230);
  expect(formatYuan(29)).toBe("0.29");
  expect(parseYuan(formatYuan(Number.MAX_SAFE_INTEGER))).toBe(
    Number.MAX_SAFE_INTEGER,
  );
  for (const value of ["1.005", "1e5", "-1", "NaN", "90071992547409.92"])
    expect(() => parseYuan(value)).toThrow("金额");
});
