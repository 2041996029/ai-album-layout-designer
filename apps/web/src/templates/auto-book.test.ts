import { it, expect } from "vitest";
import { planThemeBook } from "./auto-book";
const pages = Array.from({ length: 8 }, (_, i) => ({
  id: `page_${i}`,
  photoSlots: Array.from({ length: (i % 4) + 1 }, () => ({})),
  issues: [],
}));
it("automatically uses every photo without forcing the user to match slot counts", () => {
  for (const count of [1, 6, 20, 37, 100]) {
    const ids = planThemeBook(pages, count);
    expect(ids.length).toBeLessThanOrEqual(50);
    expect(
      ids.reduce(
        (sum, id) => sum + pages.find((p) => p.id === id)!.photoSlots.length,
        0,
      ),
    ).toBe(count);
  }
});
it("rejects an impossible photo count rather than claiming a template was applied", () => {
  expect(() =>
    planThemeBook([{ id: "pair", photoSlots: [{}, {}], issues: [] }], 3),
  ).toThrow();
});

it("applies all eight designs in their original order when a complete collection fits", () => {
  expect(planThemeBook(pages, 20)).toEqual(pages.map((p) => p.id));
});

it("can repaginate when a complete theme would leave an impossible remainder", () => {
  const pages = [
    { id: "pair", photoSlots: [{}, {}], issues: [] },
    { id: "triple", photoSlots: [{}, {}, {}], issues: [] },
  ];
  const ids = planThemeBook(pages, 6);
  expect(
    ids.reduce(
      (sum, id) => sum + pages.find((p) => p.id === id)!.photoSlots.length,
      0,
    ),
  ).toBe(6);
});

it("honors every checked page and only appends pages when photos exceed capacity", async () => {
  const { planSelectedThemeBook } = await import("./auto-book");
  const selected = pages.map((p) => p.id);
  expect(planSelectedThemeBook(pages, selected, 6)).toEqual(selected);
  const expanded = planSelectedThemeBook(pages, selected, 27);
  expect(expanded.slice(0, 8)).toEqual(selected);
  expect(expanded.length).toBeGreaterThan(8);
  expect(
    expanded.reduce(
      (n, id) => n + pages.find((p) => p.id === id)!.photoSlots.length,
      0,
    ),
  ).toBeGreaterThanOrEqual(27);
  expect(planSelectedThemeBook(pages, ["page_3", "page_0"], 2)).toEqual([
    "page_3",
    "page_0",
  ]);
});
