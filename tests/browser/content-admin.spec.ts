import { test, expect } from "@playwright/test";
test("content administrators can register versioned licenses without finance access or duplicate retries", async ({
  page,
}) => {
  let finance = 0,
    attempts = 0;
  const keys: string[] = [];
  const record = {
    id: "license-v1",
    name: "原创水墨",
    source: "original:studio",
    termsVersion: "2026-v1",
    commercialAllowed: true,
    embeddingAllowed: false,
    referenceImageAllowed: true,
    territories: ["CN"],
    revision: 1,
  };
  let registered = false;
  await page.route("**/v1/**", async (route) => {
    const request = route.request(),
      url = new URL(request.url());
    let data: any = { items: [], nextCursor: null, hasMore: false };
    if (url.pathname.endsWith("/auth/session"))
      data = {
        csrfToken: "csrf",
        user: { id: "content-admin" },
        expiresAt: "2099-01-01T00:00:00Z",
      };
    else if (url.pathname.endsWith("/admin/licenses")) {
      if (request.method() === "POST") {
        attempts++;
        keys.push(request.headers()["idempotency-key"]);
        expect(request.postDataJSON()).toMatchObject({
          name: "原创水墨",
          commercialAllowed: true,
          referenceImageAllowed: true,
        });
        if (attempts === 1)
          return route.fulfill({
            status: 503,
            json: { error: { message: "temporary" } },
          });
        registered = true;
        data = record;
      } else data.items = registered ? [record] : [];
    } else {
      if (
        /\/(admin\/(orders|refunds|redemption-batches)|skus)(?:$|\/)/.test(
          url.pathname,
        )
      )
        finance++;
      return route.fulfill({
        status: 403,
        json: { error: { message: "FORBIDDEN" } },
      });
    }
    await route.fulfill({ json: { data, requestId: "test" } });
  });
  await page.goto("/tests/browser/harness/commerce.html?admin=1#content");
  await expect(page.getByRole("heading", { name: "授权资料库" })).toBeVisible();
  await page.getByLabel("授权名称", { exact: true }).fill("原创水墨");
  await page.getByLabel("条款版本", { exact: true }).fill("2026-v1");
  await page.getByLabel("授权来源", { exact: true }).fill("original:studio");
  await page.getByLabel("登记原因", { exact: true }).fill("登记原创作品条款");
  await page.getByLabel("明确允许商业使用").check();
  await page.getByLabel("明确允许参考图处理").check();
  await page.getByRole("button", { name: "登记新授权版本" }).click();
  await expect(page.getByRole("alert")).toContainText("登记未完成");
  await page.getByRole("button", { name: "登记新授权版本" }).click();
  await expect(page.getByRole("status")).toContainText(
    "已登记「原创水墨」授权版本 1",
  );
  await expect(
    page.getByRole("heading", { name: "原创水墨", exact: true }),
  ).toBeVisible();
  expect(keys).toHaveLength(2);
  expect(keys[0]).toBe(keys[1]);
  expect(finance).toBe(0);
});
