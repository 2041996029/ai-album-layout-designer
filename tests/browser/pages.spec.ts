import { test, expect } from "@playwright/test";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
test("built app initializes licensed fonts and exports under a Pages project subdirectory", async ({
  page,
}) => {
  const root = resolve("apps/web/dist"),
    prefix = "/album-preview/",
    errors: string[] = [];
  const server = createServer(async (req, res) => {
    try {
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (!path.startsWith(prefix)) {
        res.writeHead(404).end();
        return;
      }
      const file = resolve(root, path.slice(prefix.length) || "index.html");
      if (!file.startsWith(root + sep)) {
        res.writeHead(404).end();
        return;
      }
      const types: Record<string, string> = {
        ".html": "text/html",
        ".js": "text/javascript",
        ".css": "text/css",
        ".json": "application/json",
        ".woff2": "font/woff2",
      };
      res.setHeader(
        "Content-Type",
        types[extname(file)] ?? "application/octet-stream",
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("host");
  try {
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
    });
    await page.goto(`http://127.0.0.1:${address.port}${prefix}`);
    await expect(
      page.getByRole("button", { name: "保存", exact: true }),
    ).toBeVisible({ timeout: 15000 });
    await page.getByRole("button", { name: "文字", exact: true }).click();
    await page.getByLabel("文字内容").fill("在线测试");
    await page.getByLabel("文字内容").press("Tab");
    await page.getByRole("button", { name: "导出作品", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "导出作品" });
    await dialog.getByLabel("导出DPI").selectOption("72");
    await dialog
      .getByRole("button", { name: "检查导出条件", exact: true })
      .click();
    await expect(dialog.getByText("检查通过。")).toBeVisible();
    await dialog.getByRole("button", { name: "开始导出", exact: true }).click();
    await expect(dialog.getByText("导出完成，可下载")).toBeVisible();
    await dialog.getByRole("button", { name: "关闭", exact: true }).click();
    await page
      .getByLabel("导入照片")
      .setInputFiles("tests/fixtures/images/landscape.png");
    await expect(
      page.getByRole("button", { name: "添加照片 landscape.png", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "智能排版", exact: true }).click();
    const layout = page.getByRole("dialog", { name: "整本智能排版" });
    await layout.getByLabel("每跨页最少照片").fill("1");
    await layout
      .getByRole("button", { name: "生成排版方案", exact: true })
      .click();
    await expect(layout.getByText("已使用 1 / 1 张")).toBeVisible({
      timeout: 30000,
    });
    await expect(
      layout.getByTestId("layout-preview-ready").first(),
    ).toBeVisible({ timeout: 30000 });
    await layout
      .getByRole("button", { name: "应用选中方案", exact: true })
      .click();
    await expect(layout).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
});
