import { test, expect } from "@playwright/test";
async function boot(page: import("@playwright/test").Page) {
  await page.goto("/apps/web/index.html");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible({ timeout: 120000 });
}
test("export stays in the topbar and modal owns focus, keyboard and focus restoration", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const launch = page
    .locator(".topbar")
    .getByRole("button", { name: "导出作品", exact: true });
  await expect(launch).toBeVisible();
  await launch.click();
  const modal = page.getByRole("dialog", { name: "导出作品" });
  await expect(modal.getByLabel("导出格式")).toBeFocused();
  await expect(modal.getByLabel("跨页 1 · 第 1–2 页")).toBeChecked();
  await modal.getByRole("button", { name: "关闭", exact: true }).focus();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Escape");
  await expect(modal).toHaveCount(0);
  await expect(launch).toBeFocused();
  await expect(
    page.getByRole("button", { name: "选择图层 矩形", exact: true }),
  ).toBeVisible();
  await launch.click();
  await modal.getByRole("button", { name: "关闭", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect
    .poll(() =>
      page.evaluate(() => !!document.activeElement?.closest("dialog")),
    )
    .toBe(true);
});
test("empty guidance, named layer controls and responsive workspace are clear", async ({
  page,
}, info) => {
  await boot(page);
  await expect(page.getByText("从一张照片开始")).toBeVisible();
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await expect(page.getByText("从一张照片开始")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /切换锁定/ }).first(),
  ).toHaveAttribute("aria-pressed", "false");
  for (const width of [1024, 1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByTestId("scene-state")).toHaveAttribute(
      "data-render-status",
      "ready",
    );
    await page.screenshot({
      path: info.outputPath(`polish-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
});
test("an open modal blocks editor shortcuts even when disabled controls leave focus on body", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.getByRole("button", { name: "导出作品", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "导出作品" })).toBeVisible();
  // Disabled fieldsets can leave the native keyboard target on BODY during checks.
  await page.evaluate(() =>
    document.body.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
    ),
  );
  await page
    .getByRole("dialog", { name: "导出作品" })
    .getByRole("button", { name: "关闭", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "选择图层 矩形", exact: true }),
  ).toBeVisible();
});
