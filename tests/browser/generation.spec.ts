import { test, expect } from "@playwright/test";
test("AI studio confirms credits, invalidates edited quotes and preserves one acceptance key on retry", async ({
  page,
}) => {
  let quotes = 0,
    accepts = 0,
    polls = 0;
  const keys: string[] = [];
  await page.route("**/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    let data: any = { items: [], hasMore: false, nextCursor: null };
    if (url.pathname.endsWith("/auth/session"))
      data = {
        csrfToken: "csrf",
        user: { id: "u" },
        expiresAt: "2099-01-01T00:00:00Z",
      };
    if (url.pathname.endsWith("/generation-presets"))
      data.items = [
        {
          id: "preset-v1",
          version: 1,
          name: "山水水墨",
          capabilities: ["textToImage"],
          ratios: ["1:1", "3:2"],
          referenceAllowed: false,
          commercialAllowed: true,
          licenseRef: "original",
          policyVersion: "policy-v1",
          maxPromptCharacters: 4000,
          seedSupported: false,
          available: true,
        },
      ];
    if (url.pathname.endsWith("/generation-quotes")) {
      quotes++;
      data = {
        id: "quote-" + quotes,
        credits: 3,
        inputHash: "a".repeat(64),
        policyVersion: "policy-v1",
        expiresAt: "2099-01-01T00:00:00Z",
      };
    }
    if (url.pathname.endsWith("/generation-jobs")) {
      accepts++;
      keys.push(request.headers()["idempotency-key"]);
      if (accepts === 1)
        return route.fulfill({
          status: 503,
          json: { error: { message: "temporarily unavailable" } },
        });
      data = {
        id: "job-1",
        state: "queued",
        kind: "generation",
        providerSubmissionState: "not_submitted",
      };
    }
    if (url.pathname.endsWith("/jobs/job-1"))
      data = {
        id: "job-1",
        state: ++polls > 1 ? "succeeded" : "running",
        kind: "generation",
        providerSubmissionState: "unknown",
      };
    if (url.pathname.endsWith("/generation-jobs/job-1/result"))
      data = {
        jobId: "job-1",
        state: "succeeded",
        asset: { id: "art-1", originalFilename: "AI-art.png" },
      };
    if (url.pathname.endsWith("/assets/art-1/download-token"))
      data = {
        url: "data:image/png;base64,iVBORw0KGgo=",
        expiresAt: "2099-01-01T00:00:00Z",
      };
    await route.fulfill({ json: { data, requestId: "test" } });
  });
  await page.goto(
    "/tests/browser/harness/commerce.html?workspace=workspace-demo#art",
  );
  await expect(
    page.getByRole("heading", { name: "把灵感，留在相册里" }),
  ).toBeVisible();
  await page.getByLabel("画面描述").fill("晨光中的群山");
  await page.getByRole("button", { name: "获取本次报价" }).click();
  await expect(page.getByText("本次 1 张 · 3 点")).toBeVisible();
  expect(accepts).toBe(0);
  await page.getByLabel("画面描述").fill("江南春雨");
  await expect(
    page.getByRole("button", { name: "确认使用 3 点生成" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "获取本次报价" }).click();
  await page.getByRole("button", { name: "确认使用 3 点生成" }).click();
  await expect(page.getByRole("alert")).toContainText("提交未确认");
  await page.getByRole("button", { name: "确认使用 3 点生成" }).click();
  await expect(
    page.getByRole("heading", { name: "正在确认生成结果" }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  await expect(
    page.getByRole("heading", { name: "作品已保存到素材库" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: "审核通过的 AI 创作预览" }),
  ).toHaveAttribute("src", /^data:image/);
});
test("unconfigured AI studio offers no fake generation or prices", async ({
  page,
}) => {
  await page.route("**/v1/**", async (route) => {
    await route.fulfill({
      json: {
        data: { items: [], hasMore: false, nextCursor: null },
        requestId: "test",
      },
    });
  });
  await page.goto(
    "/tests/browser/harness/commerce.html?workspace=workspace-demo#art",
  );
  await expect(
    page.getByText("暂无已开通的创作风格。", { exact: false }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /报价|生成/ })).toHaveCount(0);
});
