import { test, expect } from "@playwright/test";
test("budget editing hides proofs and retries an uncertain save without another human challenge", async ({
  page,
}) => {
  let challenges = 0,
    verified = 0,
    attempts = 0;
  const keys: string[] = [];
  let budget = {
    id: "account-1",
    accountBillingId: "vendor-demo",
    providerName: "OpenAI 兼容服务",
    environment: "dev",
    dailyBudgetFen: 10000,
    reservedFen: 300,
    spentFen: 200,
    state: "active",
    revision: 1,
    budgetDate: "2026-10-27",
  };
  await page.route("**/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    let data: any = { items: [], hasMore: false, nextCursor: null };
    if (url.pathname.endsWith("/auth/session"))
      data = {
        csrfToken: "csrf",
        user: { id: "finance" },
        expiresAt: "2099-01-01T00:00:00Z",
      };
    else if (url.pathname.endsWith("/auth/reauthentication"))
      data = { state: "available", method: "email" };
    else if (url.pathname.endsWith("/auth/reauthentication/challenges")) {
      challenges++;
      data = {
        id: "challenge-1",
        purpose: "admin_operations",
        method: "email",
        destinationHint: "f***@example.com",
        expiresAt: "2099-01-01T00:00:00Z",
      };
    } else if (url.pathname.endsWith("/auth/reauthenticate")) {
      verified++;
      expect(request.postDataJSON().proof.purpose).toBe("admin_operations");
      data = {
        reauthProof: "private-server-proof-never-render",
        purpose: "admin_operations",
        expiresAt: "2099-01-01T00:00:00Z",
      };
    } else if (url.pathname.endsWith("/admin/ai/budgets/account-1")) {
      attempts++;
      keys.push(request.headers()["idempotency-key"]);
      expect(request.headers()["x-reauthentication-proof"]).toBe(
        "private-server-proof-never-render",
      );
      expect(request.headers()["if-match"]).toBe('"1"');
      expect(request.postDataJSON().dailyBudgetFen).toBe(20029);
      budget = { ...budget, dailyBudgetFen: 20029, revision: 2 };
      if (attempts === 1)
        return route.fulfill({
          status: 503,
          json: { error: { message: "temporary" } },
        });
      data = budget;
    } else if (url.pathname.endsWith("/admin/ai/budgets"))
      data.items = [budget];
    await route.fulfill({ json: { data, requestId: "test" } });
  });
  await page.goto("/tests/browser/harness/commerce.html?admin=1#aiFinance");
  await expect(
    page.getByRole("heading", { name: "AI 采购预算" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "调整 OpenAI 兼容服务 预算" }).click();
  await page.getByLabel("每日额度（元）").fill("200.29");
  await page.getByLabel("预算调整原因").fill("调整测试账户上限");
  await page.getByRole("button", { name: "验证并保存预算" }).click();
  const dialog = page.getByRole("dialog", { name: "身份验证" });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel("验证码", { exact: true }).fill("123456");
  await dialog.getByRole("button", { name: "验证并继续" }).click();
  await expect(page.getByRole("alert")).toContainText("保存未确认");
  await page.getByRole("button", { name: "验证并保存预算" }).click();
  await expect(page.getByRole("status")).toContainText(
    "已更新 OpenAI 兼容服务 的每日预算",
  );
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(challenges).toBe(1);
  expect(verified).toBe(1);
  await expect(
    page.getByText("private-server-proof-never-render", { exact: true }),
  ).toHaveCount(0);
});
