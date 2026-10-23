import { test, expect, type Page } from "@playwright/test";
const now = "2026-10-23T00:00:00Z";
const ws = (id: string) => ({
  id,
  name: id === "a" ? "个人空间" : "影楼空间",
  role: "owner",
  kind: "personal",
  revision: 1,
  createdAt: now,
});
async function mock(
  page: Page,
  {
    authenticated = true,
    conflict = false,
  }: { authenticated?: boolean; conflict?: boolean } = {},
) {
  const writes: { path: string; body: unknown; csrf: string | undefined }[] =
    [];
  await page.route("**/v1/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      path = url.pathname;
    let data: unknown = {};
    if (req.method() !== "GET")
      writes.push({
        path,
        body: req.postDataJSON(),
        csrf: req.headers()["x-csrf-token"],
      });
    if (path.endsWith("/capabilities"))
      data = { configReleaseId: null, capabilities: [], serverTime: now };
    else if (path.endsWith("/auth/session")) {
      if (!authenticated)
        return route.fulfill({
          status: 401,
          json: { error: { message: "未登录" } },
        });
      data = {
        user: {
          id: "u",
          displayName: "小林",
          status: "active",
          createdAt: now,
        },
        csrfToken: "csrf-bound",
        expiresAt: "2099-01-01T00:00:00Z",
      };
    } else if (path === "/v1/workspaces")
      data = { items: [ws("a"), ws("b")], nextCursor: null, hasMore: false };
    else if (/\/workspaces\/[ab]$/.test(path)) data = ws(path.slice(-1));
    else if (path.endsWith("/usage"))
      data = {
        storageBytes: 0,
        reservedUploadBytes: 0,
        recycleBinBytes: 0,
        storageLimitBytes: 1000,
        projectCount: 0,
        projectLimit: 10,
        seatCount: 1,
        seatLimit: 1,
        measuredAt: now,
      };
    else if (path.endsWith("/preferences"))
      data = {
        revision: 1,
        language: "zh-CN",
        timezone: "Asia/Shanghai",
        emailNotifications: false,
        inAppNotifications: true,
      };
    else if (path.endsWith("/projects") && req.method() === "GET")
      data = { items: [], nextCursor: null, hasMore: false };
    else if (path.endsWith("/projects"))
      data = { project: { id: "cloud-" + path.split("/")[3], revision: 1 } };
    else if (/\/projects\/[^/]+$/.test(path))
      return route.fulfill({
        status: conflict ? 409 : 503,
        json: { error: { message: "失败" } },
      });
    else if (path.endsWith("/folders") && req.method() === "POST")
      data = {
        id: "folder-new",
        name: "旅行",
        parentId: null,
        workspaceId: "a",
        revision: 1,
        depth: 1,
        state: "active",
        createdAt: now,
      };
    else data = { items: [], nextCursor: null, hasMore: false };
    return route.fulfill({ json: { data, requestId: "test" } });
  });
  return writes;
}
async function boot(page: Page) {
  await page.goto("/tests/browser/harness/index.html");
  await page.evaluate(async () => {
    const moduleUrl = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(moduleUrl);
    const store = new IndexedDbRevisionStore("album-local-v1");
    await store.create(
      {
        schemaVersion: 1,
        projectId: "prj_cloud_test",
        revision: 1,
        unit: "px96",
        colorSpace: "srgb",
        pageSize: { width: 600, height: 600 },
        printProfile: { bleedMm: 3, safeMm: 5 },
        cover: { front: [], back: [] },
        spreads: [{ id: "spread_1", background: "#ffffff", layers: [] }],
      },
      { assets: [], fonts: [] },
    );
    localStorage.setItem("album-active", "prj_cloud_test");
  });
  await page.goto("/apps/web/index.html");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await page.getByRole("button", { name: "云工作区", exact: true }).click();
}
test("unavailable backend leaves local editor and recovery usable", async ({
  page,
}) => {
  await page.route("**/v1/**", (r) =>
    r.fulfill({ status: 503, json: { error: { message: "unavailable" } } }),
  );
  await boot(page);
  await expect(
    page.getByText(
      "当前部署未连接云服务。可继续本地编辑，并导出可恢复项目包。",
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "云工作区", exact: true }).click();
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已保存至此浏览器");
});
test("unconfigured identity does not offer fake SMS or invitations", async ({
  page,
}) => {
  await mock(page, { authenticated: false });
  await boot(page);
  await expect(page.getByText("短信登录未开通")).toBeVisible();
  await expect(page.getByRole("button", { name: "邀请成员" })).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "微信登录", exact: true }),
  ).toHaveCount(0);
});
test("workspace folders use cookie CSRF requests and cloud failure keeps recovery draft", async ({
  page,
}) => {
  const writes = await mock(page);
  await boot(page);
  await expect(page.getByRole("heading", { name: "云素材" })).toBeVisible();
  await page.getByLabel("文件夹名称").fill("旅行");
  await page.getByRole("button", { name: "新建文件夹" }).click();
  await expect
    .poll(() =>
      writes.some(
        (w) => w.path.endsWith("/folders") && w.csrf === "csrf-bound",
      ),
    )
    .toBe(true);
  await page.getByRole("button", { name: "保存当前相册到云端" }).click();
  await expect(page.getByText("云端保存失败，本地草稿已保留")).toBeVisible();
  await expect(page.getByText("移入回收站，不会立即删除云对象")).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).some((k) => /token|session/i.test(k)),
    ),
  ).toBe(false);
});
test("409 explains conflict and does not silently rebase", async ({ page }) => {
  const writes = await mock(page, { conflict: true });
  await boot(page);
  await expect(page.getByRole("heading", { name: "云素材" })).toBeVisible();
  await page.getByRole("button", { name: "保存当前相册到云端" }).click();
  await expect(
    page.getByText("该版本已由其他设备修改，本地草稿已保留"),
  ).toBeVisible();
  expect(writes.filter((w) => /\/projects\/[^/]+$/.test(w.path))).toHaveLength(
    1,
  );
});
test("late save response cannot overwrite new workspace context", async ({
  page,
}) => {
  await mock(page);
  let release: () => void = () => {};
  let started = false;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/v1/projects/*", async (route) => {
    started = true;
    await gate;
    await route.fulfill({
      status: 409,
      json: { error: { message: "conflict" } },
    });
  });
  await boot(page);
  await expect(page.getByRole("heading", { name: "云素材" })).toBeVisible();
  await page.getByRole("button", { name: "保存当前相册到云端" }).click();
  await expect.poll(() => started).toBe(true);
  await page.getByLabel("工作区", { exact: true }).selectOption("b");
  release();
  await expect(page.getByLabel("工作区", { exact: true })).toHaveValue("b");
  await expect(
    page.getByText("该版本已由其他设备修改，本地草稿已保留"),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "保存当前相册到云端" }),
  ).toBeEnabled();
});
test("successful cloud save verifies document hash without rewriting local document", async ({
  page,
}) => {
  await mock(page);
  await page.route("**/v1/projects/*", async (route) => {
    const input = route.request().postDataJSON();
    const document = { ...input.commands[0].document, revision: 2 };
    const response = await page.evaluate(async (doc) => {
      const moduleUrl = "/packages/document/src/index.ts";
      const { hashDocument } = await import(moduleUrl);
      const storageUrl = "/packages/storage/src/index.ts";
      const { IndexedDbRevisionStore } = await import(storageUrl);
      const store = new IndexedDbRevisionStore("album-local-v1");
      const projects = await store.listProjects();
      return {
        document: doc,
        documentSha256: await hashDocument(doc),
        project: {
          id: doc.projectId,
          revision: doc.revision,
          updatedAt: new Date().toISOString(),
        },
        resources: (await store.load(projects[0].projectId)).resources,
        manifest: [],
      };
    }, document);
    await route.fulfill({ json: { data: response, requestId: "test" } });
  });
  await boot(page);
  await expect(page.getByRole("heading", { name: "云素材" })).toBeVisible();
  const before = await page.evaluate(() =>
    localStorage.getItem("album-active"),
  );
  await page.getByRole("button", { name: "保存当前相册到云端" }).click();
  await expect(page.getByText("已保存到云端", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("album-active"))).toBe(
    before,
  );
});
test("QR login renders actual payload and consumes with original nonce and poll proof", async ({
  page,
}) => {
  await mock(page, { authenticated: false });
  let originalNonce = "";
  let consumed = false;
  await page.route("**/v1/capabilities?platform=web", (route) =>
    route.fulfill({
      json: {
        data: {
          configReleaseId: "cfg",
          serverTime: now,
          capabilities: [
            {
              key: "wechatWebLogin",
              status: "available",
              action: "none",
              platforms: ["web"],
            },
          ],
        },
        requestId: "qr",
      },
    }),
  );
  await page.route("**/v1/auth/web/qr-sessions**", async (route) => {
    const req = route.request(),
      path = new URL(req.url()).pathname;
    if (path.endsWith("/consume")) {
      const body = req.postDataJSON();
      expect(body.browserNonce).toBe(originalNonce);
      expect(body.consumeProof).toBe("one-use-proof");
      expect(req.headers()["x-qr-poll-token"]).toBe("poll-secret");
      consumed = true;
      return route.fulfill({
        json: {
          data: {
            user: {
              id: "u",
              displayName: "扫码用户",
              status: "active",
              createdAt: now,
            },
            csrfToken: "new-csrf",
            expiresAt: "2099-01-01T00:00:00Z",
          },
          requestId: "consume",
        },
      });
    }
    if (req.method() === "POST") {
      originalNonce = req.postDataJSON().browserNonce;
      return route.fulfill({
        json: {
          data: {
            id: "qr-1",
            qrPayload: "https://example.invalid/wechat/scene",
            pollToken: "poll-secret",
            expiresAt: "2099-01-01T00:00:00Z",
            pollAfterSeconds: 1,
          },
          requestId: "create",
        },
      });
    }
    expect(req.headers()["x-qr-poll-token"]).toBe("poll-secret");
    return route.fulfill({
      json: {
        data: {
          id: "qr-1",
          state: "confirmed",
          expiresAt: "2099-01-01T00:00:00Z",
          consumeProof: "one-use-proof",
        },
        requestId: "poll",
      },
    });
  });
  await boot(page);
  await page.getByRole("button", { name: "微信登录", exact: true }).click();
  await expect(page.getByAltText("微信登录二维码")).toBeVisible();
  await expect.poll(() => consumed).toBe(true);
  await expect(page.getByText("扫码用户 · 本地创作可继续")).toBeVisible();
});
test("opening another project isolates delayed saves and overlapping opens", async ({
  page,
}) => {
  await mock(page);
  await page.route("**/v1/workspaces/a/projects", (route) =>
    route.fulfill({
      json: {
        data: {
          items: [
            { id: "project-a", name: "相册A" },
            { id: "project-b", name: "相册B" },
          ],
          nextCursor: null,
          hasMore: false,
        },
        requestId: "list",
      },
    }),
  );
  await boot(page);
  const fixtures = await page.evaluate(async () => {
    const url = "/packages/document/src/index.ts";
    const { hashDocument } = await import(url);
    return Promise.all(
      ["project-a", "project-b"].map(async (projectId, i) => {
        const document = {
          schemaVersion: 1,
          projectId,
          revision: 1,
          unit: "px96",
          colorSpace: "srgb",
          pageSize: { width: 600, height: 600 },
          printProfile: { bleedMm: 3, safeMm: 5 },
          cover: { front: [], back: [] },
          spreads: [
            {
              id: "spread_1",
              background: i ? "#000000" : "#ffffff",
              layers: [],
            },
          ],
        };
        return {
          document,
          documentSha256: await hashDocument(document),
          project: {
            id: projectId,
            revision: 1,
            updatedAt: new Date().toISOString(),
          },
          resources: { assets: [], fonts: [] },
          manifest: [],
        };
      }),
    );
  });
  let releaseSave = () => {},
    releaseOpen = () => {},
    saving = false,
    opening = false,
    delayOpen = false;
  const saveGate = new Promise<void>((r) => {
      releaseSave = r;
    }),
    openGate = new Promise<void>((r) => {
      releaseOpen = r;
    });
  const mutations: string[] = [];
  await page.route("**/v1/projects/*", async (route) => {
    const projectId = new URL(route.request().url()).pathname.split("/").at(-1);
    if (route.request().method() === "PATCH") {
      mutations.push(projectId!);
      if (projectId === "project-a") {
        saving = true;
        await saveGate;
      }
      return route.fulfill({
        status: 409,
        json: { error: { message: "conflict" } },
      });
    }
    if (projectId === "project-a" && delayOpen) {
      opening = true;
      await openGate;
    }
    return route.fulfill({
      json: {
        data: fixtures[projectId === "project-a" ? 0 : 1],
        requestId: "open",
      },
    });
  });
  await page
    .getByLabel("打开云相册", { exact: true })
    .selectOption("project-a");
  await expect(page.getByText("云相册已打开；本地原项目仍保留")).toBeVisible();
  await page.getByRole("button", { name: "保存当前相册到云端" }).click();
  await expect.poll(() => saving).toBe(true);
  await page
    .getByLabel("打开云相册", { exact: true })
    .selectOption("project-b");
  await expect(
    page.getByRole("button", { name: "保存当前相册到云端" }),
  ).toBeEnabled();
  releaseSave();
  await page.getByRole("button", { name: "保存当前相册到云端" }).click();
  await expect.poll(() => mutations).toEqual(["project-a", "project-b"]);
  delayOpen = true;
  await page
    .getByLabel("打开云相册", { exact: true })
    .selectOption("project-a");
  await expect.poll(() => opening).toBe(true);
  await page
    .getByLabel("打开云相册", { exact: true })
    .selectOption("project-b");
  await expect(
    page.getByRole("button", { name: "保存当前相册到云端" }),
  ).toBeEnabled();
  releaseOpen();
  await page.getByRole("button", { name: "保存当前相册到云端" }).click();
  await expect.poll(() => mutations.at(-1)).toBe("project-b");
});
test("preferences mutation sends a quoted revision validator", async ({
  page,
}) => {
  await mock(page);
  let validator = "";
  await page.route("**/v1/me/preferences", (route) => {
    if (route.request().method() === "PATCH")
      validator = route.request().headers()["if-match"];
    return route.fulfill({
      json: {
        data: {
          revision: 2,
          language: "en-US",
          timezone: "Asia/Shanghai",
          emailNotifications: false,
          inAppNotifications: true,
        },
        requestId: "pref",
      },
    });
  });
  await boot(page);
  await expect(
    page.getByRole("button", { name: "云工作区", exact: true }),
  ).toHaveAttribute("aria-expanded", "true");
  await page
    .getByRole("combobox", { name: "语言", exact: true })
    .selectOption("zh-CN", { timeout: 10000 });
  await expect.poll(() => validator).toBe('"2"');
  await expect(page.getByText("设置已保存")).toBeVisible();
});

test("cloud photo click downloads verified original into local photo library", async ({
  page,
}) => {
  const { readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const bytes = await readFile("tests/fixtures/images/landscape.png");
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  await mock(page);
  await page.route("**/v1/workspaces/a/assets?**", (r) =>
    r.fulfill({
      json: {
        data: {
          items: [
            {
              id: "cloud-photo",
              workspaceId: "a",
              originalFilename: "cloud-photo.png",
              revision: 1,
              state: "ready",
            },
          ],
          nextCursor: null,
          hasMore: false,
        },
      },
    }),
  );
  await page.route(
    "**/v1/assets/cloud-photo/download-token?variant=original",
    (r) =>
      r.fulfill({
        json: {
          data: {
            url: "http://127.0.0.1:4175/cloud-original.png",
            expiresAt: "2099-01-01T00:00:00Z",
            filename: "cloud-photo.png",
            mime: "image/png",
            sizeBytes: bytes.length,
            sha256,
          },
        },
      }),
  );
  await page.route("**/cloud-original.png", (r) =>
    r.fulfill({ contentType: "image/png", body: bytes }),
  );
  await boot(page);
  await page
    .getByRole("button", { name: "cloud-photo.png", exact: true })
    .click();
  await expect(
    page.getByText("云素材已导入照片库，可直接用于模板"),
  ).toBeVisible();
  await page.getByRole("button", { name: "云工作区", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "添加照片 cloud-photo.png", exact: true }),
  ).toBeVisible();
});

test("workspace defaults save with CAS and existing shares can be revoked", async ({
  page,
}) => {
  await mock(page);
  let dimensions: unknown,
    validator = "";
  await page.route("**/v1/workspaces/a", (r) => {
    if (r.request().method() === "PATCH") {
      dimensions = r.request().postDataJSON();
      validator = r.request().headers()["if-match"];
    }
    return r.fulfill({
      json: {
        data: {
          ...ws("a"),
          revision: r.request().method() === "PATCH" ? 2 : 1,
          defaults: {
            pageWidthMm: 210,
            pageHeightMm: 297,
            notificationsEnabled: true,
          },
        },
      },
    });
  });
  await page.route("**/v1/workspaces/a/shares", (r) =>
    r.fulfill({
      json: {
        data: {
          items: [
            {
              id: "share-a",
              revision: 1,
              state: "active",
              expiresAt: "2099-01-01T00:00:00Z",
              outputIds: ["preview-a"],
              allowDownload: true,
              accessMode: "link",
            },
          ],
          nextCursor: null,
          hasMore: false,
        },
      },
    }),
  );
  let revoked = false;
  await page.route("**/v1/shares/share-a", (r) => {
    revoked =
      r.request().method() === "DELETE" &&
      r.request().headers()["if-match"] === '"1"';
    return r.fulfill({
      json: {
        data: {
          id: "share-a",
          revision: 2,
          state: "revoked",
          expiresAt: "2099-01-01T00:00:00Z",
          outputIds: ["preview-a"],
          allowDownload: true,
          accessMode: "link",
        },
      },
    });
  });
  await boot(page);
  await page
    .getByRole("button", { name: "保存工作区默认设置", exact: true })
    .click();
  await expect(
    page.getByText("工作区设置已保存，仅用于新建相册"),
  ).toBeVisible();
  expect(validator).toBe('"1"');
  expect(dimensions).toMatchObject({
    defaultPageWidthMm: 210,
    defaultPageHeightMm: 297,
  });
  await page.getByRole("button", { name: "撤销分享", exact: true }).click();
  await expect.poll(() => revoked).toBe(true);
  await expect(page.getByText(/预览分享 · 已撤销/)).toBeVisible();
});
