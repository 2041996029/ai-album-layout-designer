import { test, expect, type Page } from "@playwright/test";
import { tsImport } from "tsx/esm/api";
import { commerceHttpOrigin } from "./harness/commerce-http";
async function finalUiFixture() {
  const transport = await commerceHttpOrigin();
  let fixture:
    | Awaited<
        ReturnType<
          (typeof import("../../apps/api/test/final-ui-fixture"))["finalUiFixture"]
        >
      >
    | undefined;
  try {
    const module = await tsImport(
      "../../apps/api/test/final-ui-fixture.ts",
      import.meta.url,
    );
    fixture = await module.finalUiFixture(transport.origin);
    await fixture!.app.listen(0, "127.0.0.1");
    transport.bindApi(await fixture!.app.getUrl());
    return { ...fixture!, transport };
  } catch (error) {
    await transport.stop();
    await fixture?.close();
    throw error;
  }
}
async function closeLiveFixture(
  page: Page,
  fixture: Awaited<ReturnType<typeof finalUiFixture>>,
) {
  try {
    // Drain genuine HTTP responses before stopping the page and API. No
    // Playwright interception/route ownership survives the test boundary.
    await fixture.transport.stop();
    await page.close();
  } finally {
    await fixture.close();
  }
}

test("saved project cloud export reaches real server warning acknowledgement and durable job", async ({
  page,
}) => {
  test.skip(
    !process.env.C3_TEST_DATABASE_URL,
    "Disposable PostgreSQL required",
  );
  const fixture = await finalUiFixture();
  let probeScheduled = false;
  try {
    await page.context().addCookies([
      {
        name: "album_session",
        value: fixture.session.accessToken,
        url: fixture.transport.origin,
      },
    ]);

    await page.goto(
      `${fixture.transport.origin}/commerce.html?workspace=${fixture.wid}`,
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
    // Hold a genuine loopback TaskCenter request while HTTP shutdown begins.
    // The API must remain open until the delayed request has returned HTTP 200.
    await page.evaluate((wid) => {
      void fetch(`/v1/workspaces/${wid}/jobs`, {
        headers: { "X-Teardown-Probe": "1" },
      });
    }, fixture.wid);
    await fixture.transport.probe.entered;
    probeScheduled = true;
    setTimeout(fixture.transport.probe.release, 50);
  } finally {
    if (!probeScheduled) fixture.transport.probe.release();
    await closeLiveFixture(page, fixture);
    if (probeScheduled) expect(fixture.transport.probe.forwarded()).toBe(true);
  }
});

test("finance selects a visible paid order and discovered grant before a real source-bound adjustment", async ({
  page,
}) => {
  test.skip(
    !process.env.C3_TEST_DATABASE_URL,
    "Disposable PostgreSQL required",
  );
  const fixture = await finalUiFixture();
  try {
    await page.context().addCookies([
      {
        name: "album_session",
        value: fixture.session.accessToken,
        url: fixture.transport.origin,
      },
    ]);

    await page.goto(`${fixture.transport.origin}/commerce.html?admin=1`);
    await page.getByRole("button", { name: "订单管理", exact: true }).click();
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
    await closeLiveFixture(page, fixture);
  }
});
