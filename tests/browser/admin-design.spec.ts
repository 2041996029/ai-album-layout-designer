import { test, expect, type Page } from "@playwright/test";
const order = (id: string, state = "paid") => ({
  id,
  workspaceId: "workspace-photography",
  skuVersionId: "sku-portrait",
  amountFen: 19900,
  currency: "CNY",
  state,
  fulfillmentState: "fulfilled",
  channel: "wechat_pay",
  revision: 1,
  createdAt: "2026-10-26T02:00:00Z",
});
async function openAdmin(page: Page, unavailable = false) {
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (unavailable)
      return route.fulfill({
        status: 503,
        json: { error: { message: "UNCONFIGURED" } },
      });
    let data: unknown = { items: [], nextCursor: null, hasMore: false };
    if (url.pathname.endsWith("/auth/session"))
      data = {
        csrfToken: "csrf",
        user: { id: "operator" },
        expiresAt: "2099-01-01T00:00:00Z",
      };
    else if (url.pathname.endsWith("/reauthentication"))
      data = { state: "unconfigured" };
    else if (url.pathname.endsWith("/admin/orders"))
      data = url.searchParams.has("cursor")
        ? { items: [order("order-C")], nextCursor: null, hasMore: false }
        : {
            items: [order("order-A"), order("order-B", "pending")],
            nextCursor: "next-page",
            hasMore: true,
          };
    await route.fulfill({ json: { data, requestId: "admin-design" } });
  });
  await page.goto("/tests/browser/harness/commerce.html?admin=1");
}
test("admin modules filter loaded orders and keep pagination accessible", async ({
  page,
}) => {
  await openAdmin(page);
  await expect(
    page.getByRole("navigation", { name: "运营模块" }),
  ).toBeVisible();
  await expect(page.getByLabel("已加载订单", { exact: true })).toHaveText("2");
  await page.getByRole("button", { name: "订单管理", exact: true }).click();
  await expect(page.getByRole("table", { name: "订单列表" })).toBeVisible();
  await page.getByLabel("搜索已加载订单").fill("order-B");
  await expect(
    page.getByRole("row").filter({ hasText: "order-B" }),
  ).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "order-A" }),
  ).toHaveCount(0);
  await page.getByLabel("搜索已加载订单").fill("");
  await page.getByRole("button", { name: "加载更多订单查询" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: "order-C" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "退款复核", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "暂无退款记录" }),
  ).toBeVisible();
  await expect(page.getByRole("table", { name: "订单列表" })).toBeHidden();
});
test("unavailable admin has honest metrics and useful mobile navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openAdmin(page, true);
  await expect(page.getByRole("alert")).toContainText("服务尚未连接");
  await expect(page.getByLabel("已加载订单", { exact: true })).toHaveText("—");
  await page.getByRole("button", { name: "权益调整", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "额度 / 会员调整" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test("failed refresh suppresses previously loaded metric values", async ({
  page,
}) => {
  await openAdmin(page);
  await expect(page.getByLabel("已加载订单", { exact: true })).toHaveText("2");
  await page.route("**/v1/**", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "UNCONFIGURED" } },
    }),
  );
  await page.getByRole("button", { name: "刷新数据", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("服务尚未连接");
  await expect(page.getByLabel("已加载订单", { exact: true })).toHaveText("—");
});
