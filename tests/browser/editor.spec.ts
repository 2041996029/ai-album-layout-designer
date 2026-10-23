import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
const secondPhoto = readFileSync(
  new URL("../fixtures/images/transparent.png", import.meta.url),
);
const photo = readFileSync(
  new URL("../fixtures/images/orientation-6.jpg", import.meta.url),
);
async function boot(page: Page) {
  await page.goto("/apps/web/index.html");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible({ timeout: 120000 });
}
async function model(page: Page) {
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
test("local editor supports real shapes, selection, geometry, history and saved reload", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.getByLabel("X 坐标").fill("120");
  await page.getByLabel("X 坐标").press("Tab");
  await page.getByLabel("旋转角度").fill("45");
  await page.getByLabel("旋转角度").press("Tab");
  let d = await model(page);
  expect(d.spreads[0].layers[0]).toMatchObject({
    type: "shape",
    x: 120,
    rotation: 45,
  });
  await page.getByRole("button", { name: "圆形", exact: true }).click();
  await page.getByRole("button", { name: "全选图层" }).click();
  await page.getByRole("button", { name: "组合", exact: true }).click();
  d = await model(page);
  expect(d.spreads[0].layers[0].type).toBe("group");
  expect(d.spreads[0].layers[0].children).toHaveLength(2);
  await page.getByLabel("组合缩放").fill("1.5");
  await page.getByLabel("组合缩放").press("Tab");
  await page.getByRole("button", { name: "取消组合" }).click();
  d = await model(page);
  expect(d.spreads[0].layers).toHaveLength(2);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  expect((await model(page)).spreads[0].layers[0].type).toBe("group");
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status")).toHaveText("已保存至此浏览器");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "跨页 1", exact: true }),
  ).toBeVisible();
  expect((await model(page)).spreads[0].layers).toHaveLength(2);
  await page.getByRole("button", { name: "添加跨页", exact: true }).click();
  await page.getByRole("button", { name: "复制跨页", exact: true }).click();
  expect((await model(page)).spreads).toHaveLength(3);
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "删除跨页", exact: true }).click();
  expect((await model(page)).spreads).toHaveLength(2);
});
test("imports images, blocks referenced deletion, edits crop/text, and keyboard respects inputs", async ({
  page,
}) => {
  await boot(page);
  await page.getByLabel("导入照片").setInputFiles([
    { name: "one.jpg", mimeType: "image/jpeg", buffer: photo },
    { name: "two.jpg", mimeType: "image/jpeg", buffer: photo },
  ]);
  await expect(page.getByText("重复照片已跳过")).toBeVisible({
    timeout: 30000,
  });
  await page.getByRole("button", { name: "添加照片 one.jpg" }).click();
  await page.getByRole("button", { name: "删除素材 one.jpg" }).click();
  await expect(page.getByRole("alert")).toContainText("1 处引用");
  await page.getByRole("button", { name: "裁剪照片" }).click();
  await page.getByLabel("裁剪宽度").fill("0.5");
  await page.getByRole("button", { name: "应用裁剪" }).click();
  expect((await model(page)).spreads[0].layers[0].crop.width).toBe(0.5);
  await page.getByRole("button", { name: "文字", exact: true }).click();
  await page.getByLabel("文字内容").fill("时光 你好");
  await page.getByLabel("文字内容").press("Tab");
  await page.getByLabel("字体").selectOption("noto-serif-sc");
  await page.getByLabel("字重").selectOption("700");
  await page.getByLabel("字号").fill("48");
  await page.getByLabel("字号").press("Tab");
  let d = await model(page);
  expect(d.spreads[0].layers[1]).toMatchObject({
    text: "时光 你好",
    fontAssetId: "noto-serif-sc",
    fontWeight: 700,
    fontSize: 48,
  });
  await page.getByLabel("文字内容").focus();
  await page.keyboard.press("Control+z");
  expect((await model(page)).spreads[0].layers).toHaveLength(2);
  await page.getByRole("button", { name: "全选图层" }).click();
  await page.keyboard.press("Delete");
  expect((await model(page)).spreads[0].layers).toHaveLength(0);
  await page.keyboard.press("Control+z");
  expect((await model(page)).spreads[0].layers).toHaveLength(2);
  await expect(page.getByTestId("scene-state")).toHaveAttribute(
    "data-active-listeners",
    "1",
  );
});
test("responsive workspace screenshots and pointer drag are operational", async ({
  page,
}, info) => {
  await boot(page);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await expect(page.getByTestId("scene-state")).toHaveAttribute(
    "data-render-status",
    "ready",
  );
  const hit = page.getByTestId("layer-hit").first();
  const box = await hit.boundingBox();
  expect(box).not.toBeNull();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    box!.x + box!.width / 2 + 30,
    box!.y + box!.height / 2 + 20,
    { steps: 5 },
  );
  await page.mouse.up();
  expect((await model(page)).spreads[0].layers[0].x).toBeGreaterThan(80);
  for (const width of [1024, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    await page.screenshot({
      path: info.outputPath(`editor-${width}.png`),
      fullPage: true,
    });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(width);
  }
});

test("snap threshold is six screen pixels with Alt bypass; sibling alignment, visibility, lock and image replace preserve model", async ({
  page,
}) => {
  await boot(page);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  const set = async (name: string, value: string) => {
    await page.getByLabel(name, { exact: true }).fill(value);
    await page.getByLabel(name, { exact: true }).press("Tab");
  };
  await set("X 坐标", "20");
  await set("Y 坐标", "50");
  const hit = page.getByTestId("layer-hit").first();
  const canvas = page.locator("canvas");
  const bounds = await canvas.boundingBox();
  const scale = bounds!.width / 1200;
  const rect = await hit.boundingBox();
  await page.mouse.move(rect!.x + 15, rect!.y + 15);
  await page.mouse.down();
  await page.mouse.move(rect!.x + 15 - 20 * scale + 4, rect!.y + 15, {
    steps: 4,
  });
  await page.mouse.up();
  expect((await model(page)).spreads[0].layers[0].x).toBeCloseTo(0);
  await set("X 坐标", "20");
  const b = await hit.boundingBox();
  await page.keyboard.down("Alt");
  await page.mouse.move(b!.x + 15, b!.y + 15);
  await page.mouse.down();
  await page.mouse.move(b!.x + 15 - 20 * scale + 4, b!.y + 15, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up("Alt");
  expect((await model(page)).spreads[0].layers[0].x).toBeGreaterThan(0);
  await page.getByRole("button", { name: "圆形", exact: true }).click();
  await set("X 坐标", "500");
  await page.getByRole("button", { name: "线条", exact: true }).click();
  await set("X 坐标", "900");
  await page.getByRole("button", { name: "全选图层" }).click();
  await page.getByRole("button", { name: "顶对齐", exact: true }).click();
  let d = await model(page);
  expect(new Set(d.spreads[0].layers.map((l: any) => l.y)).size).toBe(1);
  await page.getByRole("button", { name: "水平分布", exact: true }).click();
  d = await model(page);
  const layers = d.spreads[0].layers;
  expect(layers[1].x - layers[0].x - layers[0].width).toBeCloseTo(
    layers[2].x - layers[1].x - layers[1].width,
  );
  const id = layers[0].id;
  await page
    .getByRole("button", { name: `切换显隐 ${id}`, exact: true })
    .click();
  expect((await model(page)).spreads[0].layers[0].visible).toBe(false);
  await page
    .getByRole("button", { name: `切换锁定 ${id}`, exact: true })
    .click();
  await page
    .getByRole("button", { name: "选择图层 矩形", exact: true })
    .click();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("alert")).toContainText("锁定");
  expect((await model(page)).spreads[0].layers).toHaveLength(3);
  await page.getByLabel("导入照片").setInputFiles([
    { name: "one.jpg", mimeType: "image/jpeg", buffer: photo },
    { name: "alpha.png", mimeType: "image/png", buffer: secondPhoto },
  ]);
  await expect(
    page.getByRole("button", { name: "添加照片 alpha.png" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加照片 one.jpg" }).click();
  await set("旋转角度", "30");
  const before = (await model(page)).spreads[0].layers.at(-1);
  await page.getByRole("button", { name: "替换照片 alpha.png" }).click();
  const after = (await model(page)).spreads[0].layers.at(-1);
  expect(after.assetId).not.toBe(before.assetId);
  for (const k of ["x", "y", "width", "height", "rotation"])
    expect(after[k]).toBe(before[k]);
  expect(after.crop).toEqual({ x: 0, y: 0, width: 1, height: 1 });
});
test("project backup restores editable resources; late image loading cannot paint a newly selected spread", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await page
    .getByLabel("导入照片")
    .setInputFiles({ name: "one.jpg", mimeType: "image/jpeg", buffer: photo });
  await expect(
    page.getByRole("button", { name: "添加照片 one.jpg" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "添加照片 one.jpg" }).click();
  await expect(page.getByTestId("scene-state")).toHaveAttribute(
    "data-render-status",
    "ready",
  );
  const before = await model(page);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "备份项目包" }).click();
  const downloaded = await downloadEvent;
  const file = await downloaded.path();
  expect(file).toBeTruthy();
  await page.getByLabel("恢复项目包").setInputFiles(file!);
  await expect(
    page.getByRole("button", { name: "添加照片 one.jpg" }),
  ).toBeVisible();
  await expect
    .poll(async () => (await model(page)).projectId)
    .not.toBe(before.projectId);
  expect((await model(page)).spreads[0].layers[0].assetId).toBe(
    before.spreads[0].layers[0].assetId,
  );
  await page.getByRole("button", { name: "添加跨页", exact: true }).click();
  await expect(page.getByTestId("scene-state")).toHaveAttribute(
    "data-render-status",
    "ready",
  );
  await page.evaluate(async () => {
    const url = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(url);
    const original = IndexedDbRevisionStore.prototype.read;
    (window as any).releaseImages = () => {};
    let resolve: () => void = () => {};
    const gate = new Promise<void>((r) => (resolve = r));
    (window as any).releaseImages = resolve;
    IndexedDbRevisionStore.prototype.read = async function (
      id: string,
      variant: any,
    ) {
      if (variant === "normalized") await gate;
      return original.call(this, id, variant);
    };
  });
  await page.getByRole("button", { name: "跨页 1", exact: true }).click();
  await page.getByRole("button", { name: "跨页 2", exact: true }).click();
  await expect(page.getByTestId("scene-state")).toHaveAttribute(
    "data-render-status",
    "ready",
  );
  await page.evaluate(() => (window as any).releaseImages());
  await expect(page.getByTestId("scene-state")).toHaveAttribute(
    "data-active-listeners",
    "1",
  );
  const pixel = await page
    .locator("canvas")
    .evaluate((canvas: HTMLCanvasElement) =>
      Array.from(canvas.getContext("2d")!.getImageData(100, 100, 1, 1).data),
    );
  expect(pixel).toEqual([255, 255, 255, 255]);
  expect(errors).toEqual([]);
});
test("alignment uses the visible rotated frame bounds", async ({ page }) => {
  await boot(page);
  const set = async (name: string, value: string) => {
    await page.getByLabel(name, { exact: true }).fill(value);
    await page.getByLabel(name, { exact: true }).press("Tab");
  };
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await set("X 坐标", "300");
  await set("旋转角度", "90");
  await page.getByRole("button", { name: "圆形", exact: true }).click();
  await set("X 坐标", "800");
  await page.getByRole("button", { name: "全选图层" }).click();
  await page.getByRole("button", { name: "左对齐", exact: true }).click();
  const d = await model(page);
  expect(d.spreads[0].layers[1].x).toBeCloseTo(80);
});
test("moving all selected layers preserves their relative painter order at boundaries", async ({
  page,
}) => {
  await boot(page);
  for (const name of ["矩形", "圆形", "线条"])
    await page.getByRole("button", { name, exact: true }).click();
  const ids = (await model(page)).spreads[0].layers.map((l: any) => l.id);
  await page.getByRole("button", { name: "全选图层" }).click();
  await page.getByRole("button", { name: "图层上移" }).click();
  expect((await model(page)).spreads[0].layers.map((l: any) => l.id)).toEqual(
    ids,
  );
  await page.getByRole("button", { name: "图层下移" }).click();
  expect((await model(page)).spreads[0].layers.map((l: any) => l.id)).toEqual(
    ids,
  );
});
test("undo and redo after adding a spread keep a valid page selected", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await boot(page);
  await page.getByRole("button", { name: "添加跨页", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "跨页 2", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "重做", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "跨页 2", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("hidden groups leave no invisible hit targets", async ({ page }) => {
  await boot(page);
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.getByRole("button", { name: "圆形", exact: true }).click();
  await page.getByRole("button", { name: "全选图层", exact: true }).click();
  await page.getByRole("button", { name: "组合", exact: true }).click();
  await page
    .getByRole("button", { name: /切换显隐/ })
    .first()
    .click();
  await expect(page.getByTestId("layer-hit")).toHaveCount(0);
});
test("backup preserves unsaved draft when CAS save fails", async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    const path = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(path);
    IndexedDbRevisionStore.prototype.save = async () => ({
      ok: false,
      code: "REVISION_CONFLICT",
      recoveryDraft: {},
    });
  });
  await page.getByRole("button", { name: "矩形", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "备份项目包", exact: true }).click();
  const file = await download,
    path = await file.path();
  const { unzipSync, strFromU8 } = await import("fflate");
  const doc = JSON.parse(
    strFromU8(unzipSync(readFileSync(path!))["document.json"]),
  );
  expect(doc.spreads[0].layers[0].type).toBe("shape");
});
