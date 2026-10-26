import { it, expect } from "vitest";
import { MiniApi } from "./api";
import { createAccountPage } from "./account-page";
it("links an existing mailbox before automatic mini login and retains returned session", async () => {
  const calls: string[] = [];
  const api = new MiniApi({
    baseUrl: "https://album.test/v1",
    workspaceId: "w",
    key: () => "key",
    loginCode: async () => "wx-code",
    transport: async (r) => {
      calls.push(r.path);
      if (r.path.includes("email-challenges"))
        return {
          status: 200,
          body: {
            data: {
              id: "q",
              expiresAt: new Date().toISOString(),
              retryAfterSeconds: 60,
              destinationHint: "a***@example.com",
            },
          },
        };
      if (r.path.includes("link-email"))
        return {
          status: 200,
          body: {
            data: { accessToken: "linked-token", refreshToken: "refresh" },
          },
        };
      expect(r.headers.Authorization).toBe("Bearer linked-token");
      return { status: 200, body: { data: { id: "linked-user" } } };
    },
  });
  const p = createAccountPage(async () => ({
    api,
    wx: {} as any,
    capabilities: { layout: false, tasks: false, export: false },
    algorithmVersion: "test",
  }));
  await p.onLoad();
  p.changeEmail({ detail: { value: "a@example.com" } });
  await p.send();
  p.changeCode({ detail: { value: "123456" } });
  await p.bind();
  await api.request("GET", "/me");
  expect(calls).toEqual([
    "/auth/wechat/mini/email-challenges",
    "/auth/wechat/mini/link-email",
    "/me",
  ]);
  expect(p.data.message).toContain("已绑定");
});
