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
test("basic template click fills imported photos and applies/undoes one target spread", async ({
  page,
}) => {
  await boot(page);
  await photos(page);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.getByRole("button", { name: "添加跨页", exact: true }).click();
  await page.getByRole("button", { name: "圆形", exact: true }).click();
  const before = await model(page);
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  expect(await page.getByLabel("模板分类").locator("option").count()).toBe(15);
  for (const value of ["wedding", "travel", "family", "portrait", "ink"]) {
    await page.getByLabel("模板分类").selectOption(value);
    await expect(page.getByRole("region", { name: "原创模板" })).toBeVisible();
  }
  await page.getByLabel("模板系列").selectOption("basic");
  await page.getByLabel("模板分类").selectOption("wedding");
  await page.getByRole("button", { name: /婚礼 · 原创留白/ }).click();
  const after = await model(page);
  expect(after.spreads[0]).toEqual(before.spreads[0]);
  expect(after.spreads[1].templateRef).toMatchObject({
    id: "tpl_wedding",
    version: 1,
  });
  expect(after.spreads[1].layers).toHaveLength(4);
  expect(
    after.spreads[1].layers
      .filter((l: any) => l.type === "image")
      .every(
        (l: any) =>
          l.fitMode === "contain" && l.crop.height === 1 && l.crop.width === 1,
      ),
  ).toBe(true);
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
    page.getByText(
      "选中照片 · 2 张可编辑照片。锁定照片与装饰不受影响，可一次撤销。",
    ),
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
test("common style library previews imported photos and applies background, typography and undo", async ({
  page,
}, testInfo) => {
  await boot(page);
  await photos(page);
  const before = await model(page);
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page.getByLabel("模板系列").selectOption("basic");
  await page.getByLabel("模板分类").selectOption("qipao");
  const region = page.getByRole("region", { name: "原创模板" });
  await expect(region.locator(".template-card")).toHaveCount(1);
  await expect(
    region.locator(".template-card").first().locator("svg image"),
  ).toHaveCount(2);
  await region.getByRole("button", { name: /旗袍 · 海棠旧梦/ }).click();
  const after = await model(page);
  expect(after.spreads[0].background).toBe("#f2e8db");
  expect(after.spreads[0].templateRef.id).toBe("style_qipao_2");
  expect(
    after.spreads[0].layers.filter((l: any) => l.type === "text")[0],
  ).toMatchObject({ text: "海棠旧梦", fill: "#723e37" });
  expect(
    after.spreads[0].layers.filter((l: any) => l.type === "text")[0]
      .letterSpacing,
  ).toBeCloseTo((5 * before.pageSize.width) / 1133.858268);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await model(page)).spreads).toEqual(before.spreads);
  await page.getByLabel("模板分类").selectOption("jk");
  await expect(region.locator(".template-card")).toHaveCount(1);
  await region.screenshot({
    path: testInfo.outputPath("style-template-library.png"),
  });
  await page.getByRole("button", { name: "智能排版", exact: true }).click();
  await expect(
    page.getByLabel("选择模板").locator('optgroup[label="JK 校园"] option'),
  ).toHaveCount(2);
});
test("twelve original collections offer eight editable decorated spreads each", async ({
  page,
}) => {
  await boot(page);
  await photos(page);
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page.getByLabel("模板系列").selectOption("themes");
  for (const category of [
    "japanese",
    "jk",
    "qipao",
    "chinese",
    "wedding",
    "couple",
    "family",
    "travel",
    "korean",
    "hongkong",
    "french",
    "monochrome",
  ]) {
    await page.getByLabel("模板分类").selectOption(category);
    await expect(page.locator(".template-card")).toHaveCount(1);
    await expect(
      page
        .locator(".template-card")
        .first()
        .locator("svg rect,svg ellipse,svg line")
        .first(),
    ).toBeVisible();
  }
  await page.getByLabel("模板分类").selectOption("qipao");
  await page.locator(".template-card").click();
  await expect(page.locator(".theme-page-grid article")).toHaveCount(8);
  await expect(
    page.getByText(/已使用「.*」完成 .*全部 2 张照片已排入/),
  ).toBeVisible();
  const after = await model(page);
  expect(after.spreads[0].templateRef.id).toMatch(/^mjpage_/);
  expect(
    after.spreads
      .flatMap((s: any) => s.layers)
      .filter(
        (l: any) => l.type === "image" && l.layoutPhotoRole === "selection",
      ),
  ).toHaveLength(2);
  expect(after.spreads).toHaveLength(8);
  expect(after.spreads[0].layers.some((l: any) => l.type === "shape")).toBe(
    true,
  );
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await model(page)).spreads[0].layers).toHaveLength(0);
});
test("original collection opens eight theme pages and applies with existing local fonts", async ({
  page,
}) => {
  await boot(page);
  await photos(page);
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page.getByLabel("模板系列").selectOption("themes");
  await page.getByLabel("模板分类").selectOption("qipao");
  await page.locator(".template-card").click();
  await expect(
    page.getByText(/已使用「.*」完成 .*全部 2 张照片已排入/),
  ).toBeVisible();
  await expect(page.locator(".theme-page-grid article")).toHaveCount(8);
  await expect
    .poll(() =>
      page
        .locator(".theme-large-preview")
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByText("调整照片", { exact: true }).click();
  await page.getByLabel("导入模板照片 1").selectOption({ label: "first.jpg" });
  await page.getByRole("button", { name: "替换当前跨页", exact: true }).click();
  await expect(page.getByText("已应用当前跨页，可以一次撤销。")).toBeVisible();
  const saved = await model(page);
  expect(
    saved.spreads[0].layers.filter((l: any) => l.type === "image"),
  ).toHaveLength(1);
  expect(saved.spreads[0].layers.some((l: any) => l.type === "shape")).toBe(
    true,
  );
  expect(saved.spreads[0].importedTemplate.sourceLayers.length).toBeGreaterThan(
    1,
  );
});

test("no photo selection applies filters across spreads, with one undo", async ({
  page,
}) => {
  await boot(page);
  await photos(page);
  await page.getByRole("button", { name: "添加照片 first.jpg" }).click();
  await page.getByRole("button", { name: "添加跨页", exact: true }).click();
  await page.getByRole("button", { name: "添加照片 second.png" }).click();
  await page.getByRole("button", { name: "文字", exact: true }).click();
  const before = await model(page);
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page.getByRole("button", { name: "滤镜", exact: true }).click();
  await expect(page.getByText(/整本相册 · 2 张可编辑照片/)).toBeVisible();
  await page.getByRole("button", { name: /^F07 / }).click();
  const after = await model(page);
  expect(
    after.spreads
      .flatMap((s: any) => s.layers)
      .filter((l: any) => l.type === "image")
      .every((l: any) => l.filter?.presetId === "F07"),
  ).toBe(true);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await model(page)).spreads).toEqual(before.spreads);
});
test("selected photo gets filter alone; explicit album scope includes other spreads", async ({
  page,
}) => {
  await boot(page);
  await photos(page);
  await page.getByRole("button", { name: "添加照片 first.jpg" }).click();
  await page.getByRole("button", { name: "添加跨页", exact: true }).click();
  await page.getByRole("button", { name: "添加照片 second.png" }).click();
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page.getByRole("button", { name: "滤镜", exact: true }).click();
  await page.getByRole("button", { name: /^F07 / }).click();
  let saved = await model(page);
  expect(saved.spreads[0].layers[0].filter ?? null).toBeNull();
  expect(saved.spreads[1].layers[0].filter.presetId).toBe("F07");
  await page.getByLabel("滤镜应用范围").selectOption("album");
  await page.getByRole("button", { name: /^F08 / }).click();
  saved = await model(page);
  expect(saved.spreads[0].layers[0].filter.presetId).toBe("F08");
  expect(saved.spreads[1].layers[0].filter.presetId).toBe("F08");
});
test("theme automatic filling never repeats missing photos and respects locked content", async ({
  page,
}, testInfo) => {
  await boot(page);
  await photos(page);
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page.getByLabel("模板分类").selectOption("qipao");
  await page.locator(".template-card").click();
  const filled = await model(page);
  expect(
    filled.spreads
      .flatMap((s: any) => s.layers)
      .filter(
        (l: any) => l.type === "image" && l.layoutPhotoRole === "selection",
      ),
  ).toHaveLength(2);
  await page
    .locator(".theme-page-grid")
    .getByRole("button", { name: /4 图/ })
    .first()
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "照片不足" }),
  ).toBeVisible();
  expect((await model(page)).spreads).toEqual(filled.spreads);
  await page
    .locator(".theme-page-grid")
    .getByRole("button", { name: /2 图/ })
    .first()
    .click();
  const before = await model(page),
    image = before.spreads[0].layers.find((l: any) => l.type === "image");
  await page
    .getByRole("button", { name: `切换锁定 ${image.id}`, exact: true })
    .click();
  const locked = await model(page);
  await page
    .locator(".theme-page-grid")
    .getByRole("button", { name: /1 图/ })
    .first()
    .click();
  await expect(
    page.getByRole("alert").filter({ hasText: "锁定" }),
  ).toBeVisible();
  expect((await model(page)).spreads).toEqual(locked.spreads);
  await page
    .getByRole("region", { name: "我的主题模板" })
    .screenshot({ path: testInfo.outputPath("theme-interaction.png") });
  await page.getByRole("button", { name: "滤镜", exact: true }).click();
  await page.getByRole("button", { name: /^F07 / }).click();
  const filtered = await model(page);
  expect(
    filtered.spreads[0].layers.find((l: any) => l.id === image.id).filter ??
      null,
  ).toBeNull();
  expect(
    filtered.spreads[0].layers
      .filter((l: any) => l.type === "image" && !l.locked)
      .every((l: any) => l.filter?.presetId === "F07"),
  ).toBe(true);
});

test("existing cropped portrait can be repaired across the album and undone once", async ({
  page,
}) => {
  await boot(page);
  await photos(page);
  await page
    .getByRole("button", { name: "添加照片 first.jpg", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "适配方式", exact: true })
    .selectOption("cover");
  const before = await model(page);
  expect(before.spreads[0].layers[0].fitMode).toBe("cover");
  await page.getByRole("button", { name: "修复照片裁切", exact: true }).click();
  const after = await model(page);
  const photo = after.spreads[0].layers[0];
  expect(photo.fitMode).toBe("contain");
  expect(photo.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  expect([photo.x, photo.y, photo.width, photo.height]).toEqual([
    before.spreads[0].layers[0].x,
    before.spreads[0].layers[0].y,
    before.spreads[0].layers[0].width,
    before.spreads[0].layers[0].height,
  ]);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await model(page)).spreads).toEqual(before.spreads);
});
