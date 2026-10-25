import { test, expect } from "@playwright/test";
import { tsImport } from "tsx/esm/api";
async function finalUiFixture(
  origin: string,
): Promise<
  Awaited<
    ReturnType<
      (typeof import("../../apps/api/test/final-ui-fixture"))["finalUiFixture"]
    >
  >
> {
  const module = await tsImport(
    "../../apps/api/test/final-ui-fixture.ts",
    import.meta.url,
  );
  return module.finalUiFixture(origin);
}

test("saved project cloud export reaches real server warning acknowledgement and durable job", async ({
  page,
  baseURL,
}) => {
  test.skip(
    !process.env.C3_TEST_DATABASE_URL,
    "Disposable PostgreSQL required",
  );
  const fixture = await finalUiFixture(baseURL!);
  try {
    await page
      .context()
      .addCookies([
        {
          name: "album_session",
          value: fixture.session.accessToken,
          url: baseURL!,
        },
      ]);
    await page.route("**/v1/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      const response = await fixture.app.inject({
        method: req.method(),
        url: url.pathname + url.search,
        payload: req.postData() ?? undefined,
        headers: await req.allHeaders(),
      });
      await route.fulfill({
        status: response.statusCode,
        headers: { "content-type": "application/json" },
        body: response.body,
      });
    });
    await page.goto(
      `/tests/browser/harness/commerce.html?workspace=${fixture.wid}`,
    );
    await page.getByRole("link", { name: "云端导出", exact: true }).click();
    await page.getByLabel("已保存的云相册").selectOption(fixture.pid);
    await page
      .getByRole("button", { name: "检查云端导出", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "服务器预检 · 版本 2" }),
    ).toBeVisible();
    const submit = page.getByRole("button", {
      name: "确认并提交云端导出",
      exact: true,
    });
    await expect(submit).toBeDisabled();
    await page.getByRole("checkbox", { name: /我已了解强警告/ }).check();
    await submit.click();
    await expect(page.getByRole("status")).toContainText("云端任务已接受");
    const rows = await fixture.db.database.transaction(
      async (tx) =>
        (
          await tx.query(
            "SELECT id,state FROM jobs WHERE workspace_id=$1 AND kind='export'",
            [fixture.wid],
          )
        ).rows,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].state).toBe("queued");
    await page.getByRole("link", { name: "在任务中心查看" }).click();
    await expect(page.getByText(rows[0].id, { exact: true })).toBeVisible();
    expect(
      (
        await fixture.db.database.transaction((tx) =>
          tx.query(
            "SELECT count(*) FROM job_snapshots WHERE workspace_id=$1 AND kind='export'",
            [fixture.wid],
          ),
        )
      ).rows[0].count,
    ).toBe("1");
  } finally {
    await fixture.close();
  }
});

test("finance selects a visible paid order and discovered grant before a real source-bound adjustment", async ({
  page,
  baseURL,
}) => {
  test.skip(
    !process.env.C3_TEST_DATABASE_URL,
    "Disposable PostgreSQL required",
  );
  const fixture = await finalUiFixture(baseURL!);
  try {
    await page
      .context()
      .addCookies([
        {
          name: "album_session",
          value: fixture.session.accessToken,
          url: baseURL!,
        },
      ]);
    await page.route("**/v1/**", async (route) => {
      const req = route.request(),
        url = new URL(req.url());
      const response = await fixture.app.inject({
        method: req.method(),
        url: url.pathname + url.search,
        payload: req.postData() ?? undefined,
        headers: await req.allHeaders(),
      });
      await route.fulfill({
        status: response.statusCode,
        headers: { "content-type": "application/json" },
        body: response.body,
      });
    });
    await page.goto("/tests/browser/harness/commerce.html?admin=1");
    await expect(
      page.getByText(fixture.orderId, { exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "选择此订单的调整来源" }).click();
    // Choose the first visible discovered source (credits), without any fixture grant ID.
    await page
      .getByRole("combobox", { name: "来源授权", exact: true })
      .selectOption({ index: 1 });
    await expect(
      page
        .getByRole("combobox", { name: "来源授权", exact: true })
        .locator("option:checked"),
    ).toHaveText(/点数/);
    await page.getByLabel("原因", { exact: true }).fill("可见订单来源复核");
    await page
      .getByLabel("工单号", { exact: true })
      .fill("ticket-visible-order");
    await page.getByRole("button", { name: "提交财务调整" }).click();
    await expect(page.getByRole("dialog", { name: "身份验证" })).toBeVisible();
    const code = [...fixture.smsCodes.values()][0];
    await page.getByLabel("验证码", { exact: true }).fill(code);
    await page.getByRole("button", { name: "验证并继续" }).click();
    await expect(page.getByRole("status")).toContainText("已记录调整");
    const adjustments = await fixture.db.database.transaction(
      async (tx) =>
        (
          await tx.query(
            "SELECT a.source_grant_id,g.source_order_id,a.reason FROM financial_adjustments a JOIN entitlement_grants g ON g.id=a.source_grant_id WHERE a.workspace_id=$1",
            [fixture.wid],
          )
        ).rows,
    );
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0].source_order_id).toBe(fixture.orderId);
    expect(adjustments[0].reason).toBe("可见订单来源复核");
    await fixture.db.database.transaction((tx) =>
      tx.query(
        "UPDATE admin_role_assignments SET revoked_at=clock_timestamp() WHERE user_id=$1",
        [fixture.session.actor.userId],
      ),
    );
    expect(
      (
        await fixture.call(
          "GET",
          `/v1/admin/orders/${fixture.orderId}/source-grants`,
        )
      ).statusCode,
    ).toBe(403);
  } finally {
    await fixture.close();
  }
});
