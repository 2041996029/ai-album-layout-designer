import { writeFile } from "node:fs/promises";
import { test, expect, type Page } from "@playwright/test";
async function boot(page: Page, count = 12) {
  await page.goto("/apps/web/index.html");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await page.evaluate(async (count) => {
    const transfer = new DataTransfer();
    for (let n = 0; n < count; n++) {
      const canvas = document.createElement("canvas");
      canvas.width = 160;
      canvas.height = 100;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = `hsl(${n * 29},60%,70%)`;
      ctx.fillRect(0, 0, 160, 100);
      ctx.fillStyle = "#234";
      ctx.fillText(String(n), 10, 40);
      const blob = await new Promise<Blob>((r) =>
        canvas.toBlob((b) => r(b!), "image/png"),
      );
      transfer.items.add(
        new File([blob], `photo-${n + 1}.png`, { type: "image/png" }),
      );
    }
    const input = document.querySelector<HTMLInputElement>(
      'input[aria-label="导入照片"]',
    )!;
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, count);
  await expect(
    page.getByRole("button", { name: /添加照片 photo-/ }),
  ).toHaveCount(count, { timeout: 120000 });
}
async function savedDoc(page: Page) {
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已保存至此浏览器");
  return page.evaluate(async () => {
    const url = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(url);
    const store = new IndexedDbRevisionStore("album-local-v1");
    const projects = await store.listProjects();
    return (await store.load(projects[0].projectId)).doc;
  });
}
test("whole-book layout previews twelve photos, applies atomically and undoes", async ({
  page,
}, info) => {
  await boot(page);
  await expect(
    page.getByRole("button", { name: "智能排版", exact: true }),
  ).toBeVisible({ timeout: 2000 });
  await page.getByRole("button", { name: "智能排版", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "整本智能排版" });
  await expect(modal).toBeVisible();
  await modal.getByLabel("跨页数量").fill("4");
  await modal
    .getByRole("button", { name: "生成排版方案", exact: true })
    .click();
  await expect(modal.getByText("已使用 12 / 12 张")).toBeVisible({
    timeout: 120000,
  });
  await expect(modal.getByTestId("layout-preview-ready").first()).toBeVisible({
    timeout: 120000,
  });
  await page.screenshot({ path: info.outputPath("c2-candidates.png") });
  await modal
    .getByRole("button", { name: "应用选中方案", exact: true })
    .click();
  await expect(modal).toHaveCount(0);
  const result = await savedDoc(page);
  expect(result.spreads).toHaveLength(4);
  expect(result.assignmentManifest.placements).toHaveLength(12);
  expect(result.assignmentManifest.unusedAssetIds).toEqual([]);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  const original = await savedDoc(page);
  expect(original.spreads).toHaveLength(1);
  expect(original.assignmentManifest).toBeUndefined();
});
test("capacity conflict is actionable and cancelling leaves the project unchanged", async ({
  page,
}) => {
  await boot(page, 5);
  const before = await savedDoc(page);
  await page.getByRole("button", { name: "智能排版", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "整本智能排版" });
  await modal.getByLabel("跨页数量").fill("1");
  await modal.getByLabel("每跨页最多照片").fill("2");
  await modal
    .getByRole("button", { name: "生成排版方案", exact: true })
    .click();
  await expect(modal.getByRole("alert")).toContainText("至少需要 3 个跨页");
  await modal.getByRole("button", { name: "关闭", exact: true }).click();
  const after = await savedDoc(page);
  expect(after.spreads).toEqual(before.spreads);
  expect(after.assignmentManifest).toBeUndefined();
});
test("saved revision changes invalidate a previously generated candidate", async ({
  page,
}) => {
  await boot(page, 3);
  await page.getByRole("button", { name: "智能排版", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "整本智能排版" });
  await modal
    .getByRole("button", { name: "生成排版方案", exact: true })
    .click();
  await expect(
    modal.getByRole("button", { name: "应用选中方案", exact: true }),
  ).toBeEnabled({ timeout: 120000 });
  await page.evaluate(() =>
    document.querySelector<HTMLButtonElement>(".save-button")!.click(),
  );
  await expect(modal.getByRole("alert")).toContainText("项目已有更新");
  await expect(
    modal.getByRole("button", { name: "应用选中方案", exact: true }),
  ).toBeDisabled();
});
test("cancelling worker computation rejects without producing candidates", async ({
  page,
}) => {
  await boot(page, 1);
  const result = await page.evaluate(async () => {
    const controller = new AbortController();
    const url = "/apps/web/src/layout/layout-controller.ts";
    const { computeLayouts } = await import(url);
    const documentUrl = "/packages/document/src/index.ts";
    const { templateVersions } = await import(documentUrl);
    const t = templateVersions[0];
    const d = {
      schemaVersion: 1,
      projectId: "p",
      revision: 1,
      unit: "px96",
      colorSpace: "srgb",
      pageSize: { width: 600, height: 600 },
      printProfile: { bleedMm: 0, safeMm: 0 },
      cover: { front: [], back: [] },
      spreads: [{ id: "s", background: "#ffffff", layers: [] }],
    };
    const input = {
      projectId: "p",
      baseRevision: 1,
      photos: [{ assetId: "a", width: 100, height: 100 }],
      constraints: {
        spreadCount: 1,
        minPhotosPerSpread: 1,
        maxPhotosPerSpread: 4,
        selectionPolicy: "all",
        duplicatePolicy: "forbid",
        orderPolicy: "user",
      },
      templateRef: { id: t.id, version: t.version, sha256: t.sha256 },
      algorithmVersion: "local-layout-v1",
      seed: 1,
    };
    const task = computeLayouts(input, d, t, controller.signal);
    setTimeout(() => controller.abort(), 0);
    try {
      await task;
      return "resolved";
    } catch (e) {
      return (e as Error).name;
    }
  });
  expect(result).toBe("AbortError");
});
test("observes fifty-photo and two-hundred-photo locked-layout responsiveness", async ({
  browser,
  baseURL,
}, info) => {
  test.setTimeout(240000);
  const observations = [];
  for (const count of [50, 200]) {
    const context = await browser.newContext({ baseURL });
    const page = await context.newPage();
    await boot(page, count);
    if (count === 200) {
      await page
        .getByRole("button", { name: "添加照片 photo-1.png", exact: true })
        .click();
      await page
        .getByRole("button", { name: /切换锁定/ })
        .first()
        .click();
    }
    await page.getByRole("button", { name: "智能排版", exact: true }).click();
    const modal = page.getByRole("dialog", { name: "整本智能排版" });
    await modal.getByLabel("跨页数量").fill(String(count === 200 ? 50 : 17));
    const start = Date.now();
    await modal
      .getByRole("button", { name: "生成排版方案", exact: true })
      .click();
    await expect(modal.getByText(`已使用 ${count} / ${count} 张`)).toBeVisible({
      timeout: 120000,
    });
    const computeAndUiMs = Date.now() - start;
    await expect(modal.getByTestId("layout-preview-ready").first()).toBeVisible(
      { timeout: 120000 },
    );
    observations.push({
      photos: count,
      spreads: count === 200 ? 50 : 17,
      lockedImageLayers: count === 200 ? 1 : 0,
      computeAndUiMs,
      firstPreviewMs: Date.now() - start,
    });
    await modal.getByRole("button", { name: "关闭", exact: true }).click();
    await context.close();
  }
  await writeFile(
    info.outputPath("performance.json"),
    JSON.stringify(observations, null, 2),
  );
  await info.attach("layout-performance-observations", {
    body: JSON.stringify(observations, null, 2),
    contentType: "application/json",
  });
});
test("C2 project backups restore repeatedly with valid assignments and input hashes", async ({
  page,
}) => {
  await boot(page, 3);
  await page.getByRole("button", { name: "智能排版", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "整本智能排版" });
  await modal
    .getByRole("button", { name: "生成排版方案", exact: true })
    .click();
  await expect(
    modal.getByRole("button", { name: "应用选中方案", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await modal
    .getByRole("button", { name: "应用选中方案", exact: true })
    .click();
  await savedDoc(page);
  const checks = await page.evaluate(async () => {
    const storageUrl = "/packages/storage/src/index.ts",
      layoutUrl = "/packages/layout/src/index.ts";
    const { IndexedDbRevisionStore, exportDraftProject, importProject } =
      await import(storageUrl);
    const { validateDocumentAssignment, validateLayoutContextHash } =
      await import(layoutUrl);
    const store = new IndexedDbRevisionStore("album-local-v1");
    let saved = await store.load((await store.listProjects())[0].projectId);
    const checks = [];
    for (let n = 0; n < 2; n++) {
      const zip = await exportDraftProject(saved.doc, saved.resources, store);
      saved = await importProject(zip, store);
      checks.push({
        errors: validateDocumentAssignment(saved.doc),
        hash: await validateLayoutContextHash(saved.doc),
        placements: saved.doc.assignmentManifest.placements.length,
      });
    }
    store.close();
    return checks;
  });
  expect(checks).toEqual([
    { errors: [], hash: true, placements: 3 },
    { errors: [], hash: true, placements: 3 },
  ]);
});
test("a C2 candidate exports a real PNG after photo-integrity preflight", async ({
  page,
}, info) => {
  await boot(page, 3);
  await page.getByRole("button", { name: "智能排版", exact: true }).click();
  const wizard = page.getByRole("dialog", { name: "整本智能排版" });
  await wizard
    .getByRole("button", { name: "生成排版方案", exact: true })
    .click();
  await expect(
    wizard.getByRole("button", { name: "应用选中方案", exact: true }),
  ).toBeEnabled({ timeout: 30000 });
  await wizard
    .getByRole("button", { name: "应用选中方案", exact: true })
    .click();
  await page.getByRole("button", { name: "导出作品", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "导出作品" });
  await dialog.getByLabel("导出DPI").selectOption("72");
  await dialog
    .getByRole("button", { name: "检查导出条件", exact: true })
    .click();
  await expect(dialog.locator(".preflight-panel")).toBeVisible();
  await expect(dialog.locator(".preflight-blocker")).toHaveCount(0);
  const confirmWarnings = dialog.getByRole("button", {
    name: "确认全部已检查的预警",
    exact: true,
  });
  if (await confirmWarnings.isVisible()) await confirmWarnings.click();
  await dialog.getByRole("button", { name: "开始导出", exact: true }).click();
  await expect(dialog.getByText("导出完成，可下载")).toBeVisible({
    timeout: 60000,
  });
  const firstDownload = dialog.getByRole("button", { name: /下载 0001/ });
  if (!(await firstDownload.isVisible()))
    await dialog.getByText(/^单独下载文件/).click();
  const downloaded = page.waitForEvent("download");
  await firstDownload.click();
  const file = await downloaded;
  await file.saveAs(info.outputPath("c2-layout-export.png"));
  const zipEvent = page.waitForEvent("download");
  await dialog
    .getByRole("button", { name: "下载文件与清单 ZIP", exact: true })
    .click();
  await (await zipEvent).saveAs(info.outputPath("c2-layout-export.zip"));
});
