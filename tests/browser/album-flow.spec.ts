import { test, expect, type Page } from "@playwright/test";
async function boot(page: Page, count = 6) {
  await page.goto("/apps/web/index.html");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await page.evaluate(async (count) => {
    const dt = new DataTransfer();
    for (let i = 0; i < count; i++) {
      const c = document.createElement("canvas");
      c.width = 200;
      c.height = 300;
      const ctx = c.getContext("2d")!;
      ctx.fillStyle = `hsl(${i * 50},50%,60%)`;
      ctx.fillRect(0, 0, 200, 300);
      ctx.fillStyle = "black";
      ctx.fillText(String(i), 10, 20);
      const blob = await new Promise<Blob>((r) =>
        c.toBlob((b) => r(b!), "image/png"),
      );
      dt.items.add(new File([blob], `flow-${i}.png`, { type: "image/png" }));
    }
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="导入照片"]',
    )!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, count);
  await expect(
    page.getByRole("button", { name: /添加照片 flow-/ }),
  ).toHaveCount(count, { timeout: 30000 });
}
async function model(page: Page) {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").first()).toHaveText("已保存至此浏览器");
  return page.evaluate(async () => {
    const url = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(url);
    const s = new IndexedDbRevisionStore("album-local-v1");
    const ps = await s.listProjects();
    return (await s.load(ps[0].projectId)).doc;
  });
}
test("selecting a collection actually repaginates all selected photos and switching collections changes the book", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "全选照片", exact: true }).click();
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page
    .getByRole("button", { name: /日系 · 木漏れ日.*8 种跨页版式/ })
    .click();
  await expect(
    page.getByText(/已使用「.*」完成 .*全部 6 张照片已排入/),
  ).toBeVisible({ timeout: 30000 });
  const first = await model(page);
  expect(first.spreads.every((s: any) => s.importedTemplate)).toBe(true);
  const images = first.spreads
    .flatMap((s: any) => s.layers)
    .filter(
      (l: any) => l.type === "image" && l.layoutPhotoRole === "selection",
    );
  expect(images).toHaveLength(6);
  expect(new Set(images.map((l: any) => l.assetId)).size).toBe(6);
  await page.getByRole("button", { name: "模板", exact: true }).click();
  await page.getByRole("button", { name: /JK.*8 种跨页版式/ }).click();
  await expect(
    page.getByText(/已使用「.*」完成 .*全部 6 张照片已排入/),
  ).toBeVisible({ timeout: 30000 });
  const second = await model(page);
  expect(second.spreads[0].importedTemplate.sourceHash).not.toBe(
    first.spreads[0].importedTemplate.sourceHash,
  );
});
test("crop mode moves the photo within a fixed frame and commits one undoable change", async ({
  page,
}) => {
  await boot(page, 1);
  await page
    .getByRole("button", { name: "添加照片 flow-0.png", exact: true })
    .click();
  await page.getByRole("spinbutton", { name: "宽度", exact: true }).fill("456");
  await page.getByRole("spinbutton", { name: "高度", exact: true }).fill("180");
  const before = await model(page);
  await page.getByRole("button", { name: "裁剪照片", exact: true }).click();
  const stage = page.getByTestId("photo-crop-stage");
  const rect = (await stage.boundingBox())!;
  await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    rect.x + rect.width / 2,
    rect.y + rect.height / 2 + 30,
    { steps: 4 },
  );
  await page.mouse.up();
  await page.getByRole("button", { name: "应用裁剪", exact: true }).click();
  const after = await model(page);
  const a = after.spreads[0].layers[0],
    b = before.spreads[0].layers[0];
  expect([a.x, a.y, a.width, a.height]).toEqual([b.x, b.y, b.width, b.height]);
  expect(a.crop.height).toBeLessThan(1);
  expect(a.crop.y).toBeLessThan((1 - a.crop.height) / 2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await model(page)).spreads).toEqual(before.spreads);
});

test("export identifies the overflowing text and repairs it using actual font measurement", async ({
  page,
}) => {
  await boot(page, 1);
  await page.getByRole("button", { name: "文字", exact: true }).click();
  await page.getByRole("spinbutton", { name: "高度", exact: true }).fill("12");
  await page.getByRole("button", { name: "导出作品", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导出作品", exact: true });
  await dialog
    .getByRole("combobox", { name: "导出DPI", exact: true })
    .selectOption("72");
  await dialog
    .getByRole("button", { name: "检查导出条件", exact: true })
    .click();
  await expect(dialog.getByText(/TEXT_OVERFLOW/)).toBeVisible({
    timeout: 30000,
  });
  await dialog
    .getByRole("button", { name: "自动适配溢出文字并重新检查", exact: true })
    .click();
  await expect(dialog.getByText(/TEXT_OVERFLOW/)).toHaveCount(0, {
    timeout: 30000,
  });
  await expect(dialog.getByText("检查通过。", { exact: true })).toBeVisible({
    timeout: 30000,
  });
});

test("bulk selection controls and template chooser collapse numeric variants", async ({
  page,
}) => {
  await boot(page, 6);
  await page.getByRole("button", { name: "清空选片", exact: true }).click();
  await expect(
    page.locator('input[aria-label^="选择照片 flow-"]:checked'),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "全选照片", exact: true }).click();
  await page.getByRole("button", { name: "智能排版", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "整本智能排版", exact: true });
  await modal.getByRole("button", { name: "清空选片", exact: true }).click();
  await expect(
    modal.getByRole("button", { name: "生成排版方案", exact: true }),
  ).toBeDisabled();
  await modal.getByRole("button", { name: "全选照片", exact: true }).click();
  const names = await modal
    .getByRole("combobox", { name: "选择模板", exact: true })
    .locator("option")
    .allTextContents();
  expect(names.some((n) => /\/\s*[1-4]图/.test(n))).toBe(false);
  await modal
    .getByRole("combobox", { name: "选择模板", exact: true })
    .selectOption("theme_jk_1");
  await expect(modal.getByTestId("layout-preview-ready").first()).toBeVisible({
    timeout: 30000,
  });
  await modal
    .getByRole("button", { name: "应用选中方案", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  expect(
    (await model(page)).spreads.every((s: any) => s.importedTemplate),
  ).toBe(true);
});

test("smart layout uses an imported template and stages its private mask before applying", async ({
  page,
}) => {
  await boot(page, 1);
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page.getByRole("button", { name: "我的模板", exact: true }).click();
  const { buildMjtpl } = await import("../fixtures/mjtpl/build");
  const fixture = await buildMjtpl();
  await page.getByLabel("导入 MJTPL 模板").setInputFiles({
    name: "private.mjtpl",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(fixture.bytes),
  });
  await expect(
    page.getByText("已导入「Synthetic」，共 1 个版式。"),
  ).toBeVisible({ timeout: 30000 });
  await page.getByRole("button", { name: "智能排版", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "整本智能排版", exact: true });
  await expect(
    modal
      .getByRole("combobox", { name: "选择模板" })
      .locator('optgroup[label="我的模板"] option'),
  ).toHaveCount(1);
  await modal
    .getByRole("combobox", { name: "选择模板" })
    .selectOption({ label: "Synthetic" });
  await expect(modal.getByTestId("layout-preview-ready").first()).toBeVisible({
    timeout: 30000,
  });
  await modal
    .getByRole("button", { name: "应用选中方案", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  const doc = await model(page);
  const image = doc.spreads[0].layers.find((l: any) => l.type === "image");
  expect(image.alphaMask?.assetId).toBeTruthy();
  const present = await page.evaluate(async (maskId) => {
    const url = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(url);
    return (
      (
        await new IndexedDbRevisionStore("album-local-v1").read(
          maskId,
          "normalized",
        )
      ).length > 0
    );
  }, image.alphaMask.assetId);
  expect(present).toBe(true);
});

test("all checked theme pages replace the whole saved book and add missing spreads", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page
    .getByRole("button", { name: /日系 · 木漏れ日.*8 种跨页版式/ })
    .click();
  await expect(
    page.getByRole("button", { name: "全选跨页", exact: true }),
  ).toBeVisible();
  // Start with a smaller book (the selected designs are extended to fit six photos).
  await page.getByRole("button", { name: "取消全选跨页", exact: true }).click();
  const checks = page.getByRole("checkbox", { name: /^加入整本 / });
  await checks.nth(2).check();
  await checks.nth(3).check();
  await page
    .getByRole("button", { name: "用此模板智能排整本", exact: true })
    .click();
  await expect.poll(async () => (await model(page)).spreads.length).toBe(3);
  const before = await model(page);
  await page.getByRole("button", { name: "全选跨页", exact: true }).click();
  await page
    .getByRole("button", { name: "用此模板智能排整本", exact: true })
    .click();
  await expect.poll(async () => (await model(page)).spreads.length).toBe(8);
  const after = await model(page);
  expect(
    new Set(after.spreads.map((s: any) => s.importedTemplate.pageId)).size,
  ).toBe(8);
  const photos = after.spreads
    .flatMap((s: any) => s.layers)
    .filter((l: any) => l.layoutPhotoRole === "selection");
  expect(photos).toHaveLength(6);
  expect(new Set(photos.map((l: any) => l.assetId)).size).toBe(6);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await model(page)).spreads).toEqual(before.spreads);
});
