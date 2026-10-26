import { test, expect } from "@playwright/test";
test("email login sends one challenge, shows cooldown and exchanges a code for session", async ({
  page,
}) => {
  let login: any,
    sends = 0;
  await page.route("**/v1/auth/email/**", async (route) => {
    if (route.request().url().endsWith("challenges")) {
      sends++;
      return route.fulfill({
        json: {
          data: {
            id: "challenge",
            destinationHint: "a***@example.com",
            retryAfterSeconds: 60,
            expiresAt: new Date(Date.now() + 300000).toISOString(),
          },
          requestId: "test",
        },
      });
    }
    login = route.request().postDataJSON();
    return route.fulfill({
      json: {
        data: {
          user: { id: "u" },
          csrfToken: "csrf",
          expiresAt: "2099-01-01T00:00:00Z",
        },
        requestId: "test",
      },
    });
  });
  await page.goto("/tests/browser/harness/identity.html");
  await page.getByLabel("邮箱地址").fill("a@example.com");
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect(page.getByRole("button", { name: /秒后可重发/ })).toBeDisabled();
  await page.getByLabel("邮箱验证码").fill("123456");
  await page.getByRole("button", { name: "登录 / 注册" }).click();
  await expect(page.getByRole("heading", { name: "已登录" })).toBeVisible();
  expect(sends).toBe(1);
  expect(login).toEqual({
    challengeId: "challenge",
    verificationCode: "123456",
  });
});
test("editing the mailbox invalidates the old challenge and prevents misdirected login", async ({
  page,
}) => {
  await page.route("**/v1/auth/email/challenges", (route) =>
    route.fulfill({
      json: {
        data: {
          id: "challenge",
          destinationHint: "a***@example.com",
          retryAfterSeconds: 60,
          expiresAt: new Date(Date.now() + 300000).toISOString(),
        },
        requestId: "test",
      },
    }),
  );
  await page.goto("/tests/browser/harness/identity.html");
  await page.getByLabel("邮箱地址").fill("a@example.com");
  await page.getByRole("button", { name: "发送验证码" }).click();
  await expect(page.getByLabel("邮箱验证码")).toBeVisible();
  await page.getByLabel("邮箱地址").fill("b@example.com");
  await expect(page.getByRole("button", { name: "登录 / 注册" })).toHaveCount(
    0,
  );
});
