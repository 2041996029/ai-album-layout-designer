import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const one = readFileSync(
    new URL("../fixtures/images/orientation-6.jpg", import.meta.url),
  ),
  two = readFileSync(
    new URL("../fixtures/images/transparent.png", import.meta.url),
  );
async function boot(page: Page) {
  await page.goto("/apps/web/index.html");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible({ timeout: 120000 });
}
async function model(page: Page) {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").first()).toHaveText("已保存至此浏览器");
  return page.evaluate(async () => {
    const p = "/packages/storage/src/index.ts",
      { IndexedDbRevisionStore } = await import(p),
      store = new IndexedDbRevisionStore("album-local-v1"),
      projects = await store.listProjects();
    return (await store.load(projects[0].projectId)).doc;
  });
}
async function photos(page: Page) {
  await page.getByLabel("导入照片", { exact: true }).setInputFiles([
    { name: "first.jpg", mimeType: "image/jpeg", buffer: one },
    { name: "second.png", mimeType: "image/png", buffer: two },
  ]);
  await expect(
    page.getByRole("button", { name: "添加照片 second.png" }),
  ).toBeVisible({ timeout: 30000 });
}
test("five template categories preview without changes, require explicit binding, and apply/undo one target spread", async ({
  page,
}) => {
  await boot(page);
  await photos(page);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.getByRole("button", { name: "添加跨页", exact: true }).click();
  await page.getByRole("button", { name: "圆形", exact: true }).click();
  const before = await model(page);
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  expect(await page.getByLabel("模板分类").locator("option").count()).toBe(6);
  for (const value of ["wedding", "travel", "family", "portrait", "ink"]) {
    await page.getByLabel("模板分类").selectOption(value);
    await expect(page.getByRole("region", { name: "原创模板" })).toBeVisible();
  }
  await page.getByLabel("模板分类").selectOption("wedding");
  await page.getByRole("button", { name: /婚礼 · 原创留白/ }).click();
  expect((await model(page)).spreads).toEqual(before.spreads);
  await page
    .getByRole("button", { name: "应用到当前跨页", exact: true })
    .click();
  await page.getByRole("button", { name: "确认替换当前跨页" }).click();
  await expect(page.getByRole("alert")).toHaveText("请为每个照片槽选择照片。");
  await page
    .getByLabel("模板照片 photo_1")
    .selectOption({ label: "first.jpg" });
  await page
    .getByLabel("模板照片 photo_2")
    .selectOption({ label: "second.png" });
  await page
    .getByRole("button", { name: "应用到当前跨页", exact: true })
    .click();
  await page.getByRole("button", { name: "确认替换当前跨页" }).click();
  const after = await model(page);
  expect(after.spreads[0]).toEqual(before.spreads[0]);
  expect(after.spreads[1].templateRef).toMatchObject({
    id: "tpl_wedding",
    version: 1,
  });
  expect(after.spreads[1].layers).toHaveLength(4);
  expect(new Set(after.spreads[1].layers.map((l: any) => l.id)).size).toBe(4);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await model(page)).spreads).toEqual(before.spreads);
});
test("33 filters batch selected photos and preserve text; strength is one undo step", async ({
  page,
}) => {
  await boot(page);
  await photos(page);
  await page.getByRole("button", { name: "添加照片 first.jpg" }).click();
  await page.getByRole("button", { name: "添加照片 second.png" }).click();
  await page.getByRole("button", { name: "文字", exact: true }).click();
  await page.getByRole("button", { name: "全选图层" }).click();
  const before = await model(page);
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page.getByRole("button", { name: "滤镜", exact: true }).click();
  await expect(
    page.getByText("选中 2 个可编辑照片图层，文字和形状不受影响。"),
  ).toBeVisible();
  expect(
    await page
      .getByRole("region", { name: "照片滤镜" })
      .getByRole("button", { name: /^F\d{2} / })
      .count(),
  ).toBe(33);
  await page.getByRole("button", { name: /^F07 / }).click();
  const filtered = await model(page);
  expect(
    filtered.spreads[0].layers
      .filter((l: any) => l.type === "image")
      .every((l: any) => l.filter.presetId === "F07"),
  ).toBe(true);
  expect(
    filtered.spreads[0].layers.find((l: any) => l.type === "text"),
  ).toEqual(before.spreads[0].layers.find((l: any) => l.type === "text"));
  const slider = page.getByLabel("滤镜强度", { exact: true });
  await slider.focus();
  await slider.press("End");
  const changed = await model(page);
  expect(
    changed.spreads[0].layers
      .filter((l: any) => l.type === "image")
      .every((l: any) => l.filter.strength === 1),
  ).toBe(true);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await model(page)).spreads).toEqual(filtered.spreads);
  await page.getByRole("button", { name: "全选图层" }).click();
  await page.getByRole("button", { name: "原图（移除滤镜）" }).click();
  expect(
    (await model(page)).spreads[0].layers
      .filter((l: any) => l.type === "image")
      .every((l: any) => l.filter === null),
  ).toBe(true);
});
