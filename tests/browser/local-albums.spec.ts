import { test, expect } from "@playwright/test";

test("rename, create and switch local albums without losing edits or the active album", async ({
  page,
}) => {
  await page.goto("/apps/web/index.html");
  await page.getByRole("button", { name: "文字", exact: true }).click();
  await page.getByRole("button", { name: /^相册：/ }).click();
  const dialog = page.getByRole("dialog", { name: "我的相册", exact: true });
  await dialog.getByLabel("当前相册名称", { exact: true }).fill("夏日写真");
  await dialog.getByRole("button", { name: "保存名称", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "相册：夏日写真", exact: true }),
  ).toBeVisible();
  await dialog.getByLabel("新相册名称", { exact: true }).fill("毕业纪念");
  await dialog.getByRole("button", { name: "新建相册", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "相册：毕业纪念", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^相册：/ }).click();
  await page
    .getByRole("button", { name: "打开相册 夏日写真", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "相册：夏日写真", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".layer-row")).toHaveCount(1);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "相册：夏日写真", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: /^相册：/ }).click();
  await page
    .getByRole("button", { name: "打开相册 毕业纪念", exact: true })
    .click();
  await expect(page.locator(".layer-row")).toHaveCount(0);
});

test("failed saving prevents album switching and retains the current editor", async ({
  page,
}) => {
  await page.goto("/apps/web/index.html");
  await page.getByRole("button", { name: /^相册：/ }).click();
  await page.getByLabel("新相册名称", { exact: true }).fill("第二本");
  await page.getByRole("button", { name: "新建相册", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "相册：第二本", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "文字", exact: true }).click();
  await page.getByRole("button", { name: /^相册：/ }).click();
  await page.evaluate(async () => {
    const path = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(path);
    IndexedDbRevisionStore.prototype.save = async (doc: any) => ({
      ok: false,
      code: "STORAGE_FULL",
      recoveryDraft: doc,
    });
  });
  await page
    .getByRole("button", { name: "打开相册 未命名相册", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "我的相册" }).getByRole("alert"),
  ).toContainText("未保存成功");
  await expect(
    page.getByRole("button", { name: "相册：第二本", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "关闭相册列表", exact: true }).click();
  await expect(page.locator(".layer-row")).toHaveCount(1);
});
