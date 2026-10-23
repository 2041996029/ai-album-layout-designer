import { test, expect, type Page } from "@playwright/test";
async function boot(page: Page, count = 1) {
  await page.goto("/apps/web/index.html");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible();
  await page.evaluate(async (count) => {
    const canvas = document.createElement("canvas");
    canvas.width = 200;
    canvas.height = 300;
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#c47848";
    ctx.fillRect(0, 0, 200, 300);
    ctx.fillStyle = "#648b6a";
    ctx.fillRect(60, 0, 100, 180);
    const blob = await new Promise<Blob>((resolve) =>
      canvas.toBlob((b) => resolve(b!), "image/png"),
    );
    const dt = new DataTransfer();
    dt.items.add(new File([blob], "polish.png", { type: "image/png" }));
    for (let i = 1; i < count; i++) {
      ctx.fillStyle = `hsl(${i * 90},50%,60%)`;
      ctx.fillRect(0, 0, 20, 20);
      const extra = await new Promise<Blob>((resolve) =>
        canvas.toBlob((b) => resolve(b!), "image/png"),
      );
      dt.items.add(new File([extra], `polish-${i}.png`, { type: "image/png" }));
    }
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="导入照片"]',
    )!;
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, count);
  await expect(
    page.getByRole("button", { name: "添加照片 polish.png", exact: true }),
  ).toBeVisible();
}
test("template search and filter previews retain choices across library navigation", async ({
  page,
}) => {
  await boot(page);
  await page
    .getByRole("button", { name: "添加照片 polish.png", exact: true })
    .click();
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "搜索模板", exact: true });
  await expect(search).toBeVisible();
  await search.fill("旗袍");
  await expect(page.locator(".template-card:visible")).toHaveCount(1);
  await search.fill("不存在的风格");
  await expect(page.getByText("没有匹配的模板", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "清空模板筛选", exact: true }).click();
  await expect(page.locator(".template-card:visible")).toHaveCount(12);
  await page.getByRole("button", { name: "滤镜", exact: true }).click();
  await expect(page.locator(".filter-card img")).toHaveCount(33);
  await page.getByRole("button", { name: /^F07 / }).click();
  await expect(page.getByRole("button", { name: /^F07 / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "模板", exact: true }).click();
  await page.getByRole("button", { name: "滤镜", exact: true }).click();
  await expect(page.getByRole("button", { name: /^F07 / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "照片", exact: true }).click();
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await expect(page.getByRole("button", { name: /^F07 / })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.screenshot({ path: "/tmp/album-filters-polished.png" });
});

test("many repeated export warnings stay grouped and acknowledgements remain per issue", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/preflight.html");
  await page.evaluate(async () => {
    const path = "/tests/browser/harness/ui-polish.tsx";
    const { mountPreflight } = await import(path);
    const report = {
      estimatedBytes: 400 * 1024 ** 2,
      surfaces: [],
      blockers: [],
      warnings: Array.from({ length: 40 }, (_, i) => ({
        id: `warning_${i}`,
        code: "LOW_PPI",
        message: `照片 ${i + 1} 清晰度偏低`,
        path: `/photo/${i}`,
        level: "strong",
        severity: "warning",
      })),
    };
    mountPreflight(report);
  });
  await expect(page.getByText("清晰度偏低", { exact: true })).toBeVisible();
  await expect(page.locator(".preflight-issue-group")).toHaveCount(1);
  await expect(page.getByRole("checkbox")).toHaveCount(1);
  await page
    .getByRole("checkbox", { name: "确认此类 40 项预警", exact: true })
    .check();
  await expect(page.getByText("待确认 0 项", { exact: false })).toBeVisible();
  await page.getByText("查看详情（40 项）", { exact: true }).click();
  await page.getByRole("checkbox", { name: /照片 1 清晰度偏低/ }).uncheck();
  await expect(
    page.getByRole("checkbox", { name: "确认此类 40 项预警", exact: true }),
  ).not.toBeChecked();
  await expect(page.getByText("待确认 1 项", { exact: false })).toBeVisible();
});

test("unchecking one default-selected photo keeps the others selected", async ({
  page,
}) => {
  await boot(page, 3);
  const checks = page.getByRole("checkbox", { name: /^选择照片 / });
  await expect(checks).toHaveCount(3);
  await checks.nth(0).uncheck();
  await expect(checks.nth(1)).toBeChecked();
  await expect(checks.nth(2)).toBeChecked();
  await expect(page.getByText("已选 2 张", { exact: true })).toBeVisible();
});

test("a long real export report keeps actions reachable and still requires warning acknowledgement", async ({
  page,
}) => {
  await boot(page);
  await page
    .getByRole("button", { name: "添加照片 polish.png", exact: true })
    .click();
  for (let i = 0; i < 9; i++)
    await page.getByRole("button", { name: "复制跨页", exact: true }).click();
  await page.getByRole("button", { name: "导出作品", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导出作品", exact: true });
  await dialog
    .getByRole("button", { name: "检查导出条件", exact: true })
    .click();
  await expect(dialog.getByText("清晰度偏低", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  const start = dialog.getByRole("button", { name: "开始导出", exact: true });
  await expect(start).toBeDisabled();
  await dialog
    .getByRole("button", { name: "确认全部已检查的预警", exact: true })
    .click();
  await expect(start).toBeEnabled();
  await dialog.evaluate((node) => (node.scrollTop = node.scrollHeight));
  const bounds = await start.boundingBox();
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  await dialog.screenshot({ path: "/tmp/album-export-polished.png" });
  await dialog.getByRole("button", { name: "返回编辑", exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test("template cards mark the layout actually used by the current spread", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page
    .getByRole("button", { name: /日系 · 木漏れ日.*8 种跨页版式/ })
    .click();
  await page.getByRole("button", { name: "返回模板库", exact: false }).click();
  await expect(
    page.getByRole("button", { name: /日系 · 木漏れ日.*8 种跨页版式/ }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("cancelling export keeps the cancellation feedback instead of showing ready to export", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.getByRole("button", { name: "导出作品", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导出作品", exact: true });
  await dialog.getByLabel("导出DPI", { exact: true }).selectOption("72");
  await dialog
    .getByRole("button", { name: "检查导出条件", exact: true })
    .click();
  await expect(dialog.getByText("检查通过。", { exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const path = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(path);
    const original = IndexedDbRevisionStore.prototype.pinResources;
    IndexedDbRevisionStore.prototype.pinResources = async function (
      ...args: any[]
    ) {
      await new Promise<void>((resolve) => {
        (window as any).releaseExportPin = resolve;
      });
      return original.apply(this, args);
    };
  });
  await dialog.getByRole("button", { name: "开始导出", exact: true }).click();
  await dialog.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(() => (window as any).releaseExportPin());
  await expect(
    dialog.getByText("已取消，没有生成完整下载", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "下载文件与清单 ZIP", exact: true }),
  ).toHaveCount(0);
});
