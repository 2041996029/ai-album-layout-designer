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

test("finance reviews refunds with reason, ticket and fresh proof and sees durable differences", async ({
  page,
}) => {
  let decision: any,
    challengeCount = 0;
  const used = new Set<string>();
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    let data: any = { items: [], nextCursor: null, hasMore: false };
    if (url.pathname.endsWith("/auth/reauthentication"))
      data = { state: "available", method: "sms" };
    if (url.pathname.endsWith("/reauthentication/challenges")) {
      challengeCount++;
      data = {
        id: "challenge-" + challengeCount,
        method: "sms",
        destinationHint: "手机尾号1234",
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        purpose: "admin_operations",
      };
    }
    if (url.pathname.endsWith("/auth/reauthenticate")) {
      expect(route.request().postDataJSON().proof.proof).toBe("654321");
      data = {
        reauthProof: "internal-" + challengeCount,
        purpose: "admin_operations",
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };
    }
    if (url.pathname.endsWith("/admin/refunds"))
      data.items = [
        {
          id: "refund-review",
          orderId: "order-review",
          state: "manual_review",
          amountFen: 123,
          reasonCode: "REVIEW_REQUIRED",
          revision: 1,
        },
      ];
    if (url.pathname.endsWith("/admin/audit-events"))
      data.items = [
        {
          id: "audit-report",
          action: "commerce.reconciliation",
          targetId: "report-review",
          reason: "每日复核",
        },
      ];
    if (url.pathname.endsWith("/reconciliations/report-review"))
      data = {
        id: "report-review",
        scope: "payments",
        scannedCount: 1,
        discrepancyCount: 1,
        state: "completed",
        reviews: [
          {
            id: "difference-record",
            orderId: "order-review",
            paidFen: 123,
            refundedFen: 0,
            localState: "closed",
            localFulfillmentState: "unfulfilled",
          },
        ],
      };
    if (url.pathname.endsWith("/refund-review/decision")) {
      const token = route.request().headers()["x-reauthentication-proof"];
      expect(token).toBe("internal-" + challengeCount);
      expect(used.has(token)).toBe(false);
      used.add(token);
      decision = route.request().postDataJSON();
      data = { id: "refund-review", state: "requested" };
    }
    await route.fulfill({ json: { data, requestId: "test" } });
  });
  await page.goto("/tests/browser/harness/commerce.html?admin=1");
  await page.getByRole("button", { name: "退款复核", exact: true }).click();
  await expect(page.getByRole("heading", { name: "退款复核" })).toBeVisible();
  await page.getByLabel("原因", { exact: true }).fill("工单复核");
  await page.getByLabel("工单号").fill("ticket-42");
  await expect(page.getByLabel("二次验证凭证", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "批准退款" }).click();
  await expect(page.getByRole("dialog", { name: "身份验证" })).toBeVisible();
  await page.getByLabel("验证码", { exact: true }).fill("654321");
  await page.getByRole("button", { name: "验证并继续" }).click();
  await expect.poll(() => decision?.decision).toBe("approve");
  expect(decision.reason).toContain("ticket-42");
  expect(challengeCount).toBe(1);
  await page.getByRole("button", { name: "批准退款" }).click();
  await page.getByLabel("验证码", { exact: true }).fill("654321");
  await page.getByRole("button", { name: "验证并继续" }).click();
  await expect.poll(() => used.size).toBe(2);
  expect(challengeCount).toBe(2);
  await page.getByRole("button", { name: "渠道对账", exact: true }).click();
  await page.getByRole("button", { name: "查看对账差异" }).click();
  await expect(
    page.getByText("difference-record", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText(/closed/)).toBeVisible();
});

test("orders load additional cursor pages without hiding earlier records", async ({
  page,
}) => {
  await setup(page);
  const first = {
    id: "order-page-first",
    workspaceId: wid,
    state: "pending",
    fulfillmentState: "unfulfilled",
    amountFen: 123,
    createdAt: new Date().toISOString(),
    revision: 1,
  };
  let receivedCursor = "";
  await page.route(`**/v1/workspaces/${wid}/orders**`, (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    receivedCursor = cursor ?? "";
    return route.fulfill({
      json: {
        data: cursor
          ? {
              items: [{ ...first, id: "order-page-older", state: "closed" }],
              nextCursor: null,
              hasMore: false,
            }
          : { items: [first], nextCursor: "cursor-first", hasMore: true },
        requestId: "test",
      },
    });
  });
  await page.getByRole("link", { name: "订单与兑换" }).click();
  await page.getByRole("button", { name: "加载更多订单" }).click();
  expect(receivedCursor).toBe("cursor-first");
  await expect(
    page.getByText("order-page-first", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("order-page-older", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "加载更多订单" })).toHaveCount(
    0,
  );
});

test("unconfigured human verification disables financial actions without asking for protocol tokens", async ({
  page,
}) => {
  const paid = {
    id: "paid-refund-order",
    workspaceId: wid,
    state: "paid",
    fulfillmentState: "fulfilled",
    amountFen: 123,
    createdAt: new Date().toISOString(),
    revision: 1,
  };
  await setup(page, [], [paid]);
  await page.route("**/v1/auth/reauthentication", (route) =>
    route.fulfill({
      json: {
        data: { state: "unconfigured", reasonCode: "REAUTH_UNCONFIGURED" },
        requestId: "test",
      },
    }),
  );
  await page.getByRole("link", { name: "订单与兑换" }).click();
  await page.getByLabel("退款原因", { exact: true }).fill("工单退款");
  await expect(
    page.getByText("身份验证尚未开通，请联系管理员。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "申请退款" })).toBeDisabled();
  await expect(page.getByLabel("退款二次验证凭证")).toHaveCount(0);
});
test("refund history survives reload and refreshes provider state from the server", async ({
  page,
}) => {
  await setup(page);
  let state = "manual_review",
    detailReads = 0;
  const record = () => ({
    id: "refund-history",
    orderId: "order-history",
    amountFen: 123,
    state,
    reason: "用户退款",
    createdAt: new Date().toISOString(),
    revision: 1,
  });
  await page.route(`**/v1/workspaces/${wid}/refunds**`, (route) =>
    route.fulfill({
      json: {
        data: { items: [record()], nextCursor: null, hasMore: false },
        requestId: "test",
      },
    }),
  );
  await page.route("**/v1/refunds/refund-history", (route) => {
    detailReads++;
    return route.fulfill({ json: { data: record(), requestId: "test" } });
  });
  await page.getByRole("link", { name: "订单与兑换" }).click();
  await expect(page.getByText("refund-history", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("refund-history", { exact: true })).toBeVisible();
  state = "succeeded";
  await page.getByRole("button", { name: "刷新记录" }).click();
  await expect(page.getByText("退款成功", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "刷新退款" }).click();
  await expect.poll(() => detailReads).toBe(1);
});

test("refund action verifies a human code for billing purpose and internally sends the fresh proof", async ({
  page,
}) => {
  const order = {
    id: "order-human-refund",
    workspaceId: wid,
    state: "paid",
    fulfillmentState: "fulfilled",
    amountFen: 123,
    createdAt: new Date().toISOString(),
    revision: 3,
  };
  await setup(page, [], [order]);
  let record: any,
    refunded = false;
  await page.route("**/v1/auth/reauth**", (route) => {
    const url = new URL(route.request().url());
    let data: any = { state: "available", method: "sms" };
    if (url.pathname.endsWith("/challenges")) {
      expect(route.request().postDataJSON().purpose).toBe("billing_refund");
      data = {
        id: "human-refund-challenge",
        method: "sms",
        destinationHint: "手机尾号1234",
        expiresAt: new Date(Date.now() + 300000).toISOString(),
        purpose: "billing_refund",
      };
    }
    if (url.pathname.endsWith("/reauthenticate")) {
      const input = route.request().postDataJSON();
      expect(input.purpose).toBe("billing_refund");
      expect(input.proof.proof).toBe("654321");
      data = {
        reauthProof: "internal-billing-proof",
        purpose: "billing_refund",
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      };
    }
    return route.fulfill({ json: { data, requestId: "test" } });
  });
  await page.route(`**/v1/workspaces/${wid}/refunds**`, (route) =>
    route.fulfill({
      json: {
        data: {
          items: record ? [record] : [],
          hasMore: false,
          nextCursor: null,
        },
        requestId: "test",
      },
    }),
  );
  await page.route("**/v1/orders/order-human-refund/refunds", (route) => {
    expect(route.request().headers()["x-reauthentication-proof"]).toBe(
      "internal-billing-proof",
    );
    expect(route.request().postDataJSON().expectedOrderRevision).toBe(3);
    refunded = true;
    record = {
      id: "refund-human",
      orderId: order.id,
      state: "manual_review",
      amountFen: 123,
      createdAt: new Date().toISOString(),
      revision: 1,
      reason: "复核",
    };
    return route.fulfill({
      status: 202,
      json: { data: record, requestId: "test" },
    });
  });
  await page.getByRole("link", { name: "订单与兑换" }).click();
  await page.getByLabel("退款原因", { exact: true }).fill("工单退款");
  await page.getByRole("button", { name: "申请退款" }).click();
  await page.getByLabel("验证码", { exact: true }).fill("654321");
  await page.getByRole("button", { name: "验证并继续" }).click();
  await expect.poll(() => refunded).toBe(true);
  await expect(page.getByText("refund-human", { exact: true })).toBeVisible();
});

test("cloud export stays unavailable without a published configured capability", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("link", { name: "云端导出", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "云端导出", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("status")).toContainText("尚未配置或暂不可用");
  await expect(
    page.getByRole("button", { name: "检查云端导出", exact: true }),
  ).toBeDisabled();
});
