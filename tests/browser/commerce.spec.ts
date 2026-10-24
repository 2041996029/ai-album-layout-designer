import { test, expect } from "@playwright/test";
const wid = "workspace-demo";
async function setup(
  page: any,
  skus: any[] = [],
  orders: any[] = [],
  jobs: any[] = [],
) {
  await page.route("**/v1/**", async (route: any) => {
    const url = new URL(route.request().url());
    let data: any = { items: [], nextCursor: null, hasMore: false };
    if (url.pathname.endsWith("/auth/session"))
      data = {
        csrfToken: "csrf",
        user: { id: "user-demo" },
        expiresAt: "2099-01-01T00:00:00Z",
      };
    else if (url.pathname.endsWith("/capabilities"))
      data = {
        capabilities: [
          { key: "purchase", status: "available", platforms: ["web"] },
        ],
        configReleaseId: null,
        serverTime: new Date().toISOString(),
      };
    else if (url.pathname.endsWith("/skus")) data.items = skus;
    else if (url.pathname.endsWith("/orders"))
      data =
        route.request().method() === "POST"
          ? orders[0]
          : { ...data, items: orders };
    else if (url.pathname.endsWith("/jobs")) data.items = jobs;
    else if (url.pathname.includes("/orders/")) data = orders[0];
    else if (url.pathname.endsWith("/entitlements"))
      data = {
        availableCredits: 0,
        reservedCredits: 0,
        maxDpi: 72,
        watermarkRequired: true,
      };
    await route.fulfill({ json: { data, requestId: "test" } });
  });
  await page.goto(`/tests/browser/harness/commerce.html?workspace=${wid}`);
}
test("reachable membership shows no invented prices and honest unpublished states", async ({
  page,
}) => {
  await setup(page);
  await expect(page.getByRole("heading", { name: "会员与点数" })).toBeVisible();
  await expect(page.getByText("未上架", { exact: true })).toHaveCount(3);
  await expect(page.getByRole("button", { name: "购买" })).toHaveCount(0);
  await expect(page.getByText(/¥|￥/)).toHaveCount(0);
  await page.getByRole("link", { name: "订单与兑换" }).click();
  await expect(page.getByRole("heading", { name: "订单与兑换" })).toBeVisible();
});
test("client payment return remains pending and jobs expose durable identifiers", async ({
  page,
}) => {
  const order = {
    id: "order-server",
    workspaceId: wid,
    skuVersionId: "sku-v1",
    amountFen: 123,
    currency: "CNY",
    state: "pending",
    fulfillmentState: "unfulfilled",
    channel: "wechat_pay",
    revision: 1,
    createdAt: new Date().toISOString(),
  };
  await setup(
    page,
    [],
    [order],
    [
      {
        id: "job-server",
        kind: "export",
        state: "running",
        stage: "confirming_upstream",
        providerSubmissionState: "unknown",
        progress: 50,
        revision: 1,
        outputIds: [],
      },
    ],
  );
  await page.getByRole("link", { name: "订单与兑换" }).click();
  await expect(page.getByText("待确认", { exact: true })).toBeVisible();
  await expect(page.getByText("支付成功", { exact: true })).toHaveCount(0);
  await page.getByRole("link", { name: "任务中心" }).click();
  await expect(page.getByText("job-server", { exact: true })).toBeVisible();
  await expect(page.getByText("确认中", { exact: true })).toBeVisible();
});
test("admin forbidden response renders explicit denial without photos or secret controls", async ({
  page,
}) => {
  await page.route("**/v1/**", (route) =>
    route.fulfill({ status: 403, json: { error: { message: "FORBIDDEN" } } }),
  );
  await page.goto("/tests/browser/harness/commerce.html?admin=1");
  await expect(page.getByRole("heading", { name: "商业运营" })).toBeVisible();
  await expect(page.getByRole("alert")).toContainText("FORBIDDEN");
  await expect(page.getByRole("img")).toHaveCount(0);
  await expect(page.getByText("原片", { exact: true })).toHaveCount(0);
});

test("published purchase opens a server payment QR and stays pending until confirmation", async ({
  page,
}) => {
  const order = {
    id: "order-pay",
    workspaceId: wid,
    skuVersionId: "sku-live",
    amountFen: 123,
    currency: "CNY",
    state: "pending",
    fulfillmentState: "unfulfilled",
    channel: "wechat_pay",
    revision: 1,
    createdAt: new Date().toISOString(),
  };
  await setup(
    page,
    [
      {
        id: "sku",
        versionId: "sku-live",
        name: "已发布个人会员",
        priceFen: 123,
        durationDays: 30,
        creditGrant: 20,
        features: ["有效期30天"],
        channels: ["wechat_pay"],
        platforms: ["web"],
        state: "published",
      },
    ],
    [order],
  );
  await page.route("**/v1/orders/order-pay/payment-attempts", (route) =>
    route.fulfill({
      json: {
        data: {
          attemptId: "attempt",
          expiresAt: new Date(Date.now() + 300000).toISOString(),
          channel: "wechat_pay",
          launch: { kind: "qr", qrPayload: "weixin://test-published-order" },
        },
        requestId: "test",
      },
    }),
  );
  await page.getByRole("button", { name: "购买", exact: true }).click();
  await expect(page.getByRole("heading", { name: "订单与兑换" })).toBeVisible();
  await page.getByRole("button", { name: "前往支付" }).click();
  await expect(page.getByRole("img", { name: "微信支付二维码" })).toBeVisible();
  await expect(page.getByText("待确认", { exact: true })).toBeVisible();
  await expect(page.getByText("支付成功", { exact: true })).toHaveCount(0);
});
