import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { buildMjtpl } from "../fixtures/mjtpl/build";
test("imports local MJTPL, binds user photo, applies and undoes without exposing sample as photo", async ({
  page,
}) => {
  await page.goto("/apps/web/index.html");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible({ timeout: 120000 });
  const image = readFileSync(
    new URL("../fixtures/images/transparent.png", import.meta.url),
  );
  await page.getByLabel("导入照片", { exact: true }).setInputFiles({
    name: "my-photo.png",
    mimeType: "image/png",
    buffer: image,
  });
  await expect(
    page.getByRole("button", { name: "添加照片 my-photo.png" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page.getByRole("button", { name: "我的模板", exact: true }).click();
  const fixture = await buildMjtpl();
  await page.getByLabel("导入 MJTPL 模板").setInputFiles({
    name: "synthetic.mjtpl",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(fixture.bytes),
  });
  await expect(
    page.getByText("已导入「Synthetic」，共 1 个版式。"),
  ).toBeVisible({ timeout: 60000 });
  await page
    .getByLabel("导入模板照片 1")
    .selectOption({ label: "my-photo.png" });
  await page.getByRole("button", { name: "替换当前跨页", exact: true }).click();
  await expect(page.getByText("已应用当前跨页，可以一次撤销。")).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").first()).toHaveText("已保存至此浏览器");
  const read = () =>
    page.evaluate(async () => {
      const path = "/packages/storage/src/index.ts";
      const { IndexedDbRevisionStore } = await import(path);
      const s = new IndexedDbRevisionStore("album-local-v1");
      const ps = await s.listProjects();
      return s.load(ps[0].projectId);
    });
  const after = await read();
  expect(after.doc.spreads[0].layers[0]).toMatchObject({
    type: "image",
    layoutPhotoRole: "selection",
    alphaMask: { version: 1 },
  });
  expect(
    after.resources.assets.filter((a: any) => !a.usage || a.usage === "photo"),
  ).toHaveLength(1);
  await page.getByRole("button", { name: "撤销", exact: true }).click();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").first()).toHaveText("已保存至此浏览器");
  expect((await read()).doc.spreads[0].layers).toHaveLength(0);
  await page.reload();
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page.getByRole("button", { name: "我的模板", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Synthetic 1 个跨页/ }),
  ).toBeVisible();
});
test("serializes photo changes during slow theme application and offers no fake cancellation", async ({
  page,
}) => {
  await page.goto("/apps/web/index.html");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await page.getByLabel("导入照片", { exact: true }).setInputFiles({
    name: "one.png",
    mimeType: "image/png",
    buffer: readFileSync(
      new URL("../fixtures/images/transparent.png", import.meta.url),
    ),
  });
  await expect(
    page.getByRole("button", { name: "添加照片 one.png" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page.getByRole("button", { name: "我的模板", exact: true }).click();
  const f = await buildMjtpl();
  await page.getByLabel("导入 MJTPL 模板").setInputFiles({
    name: "t.mjtpl",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(f.bytes),
  });
  await expect(
    page.getByText("已导入「Synthetic」，共 1 个版式。"),
  ).toBeVisible({ timeout: 30000 });
  await page.getByLabel("导入模板照片 1").selectOption({ label: "one.png" });
  await page.evaluate(async () => {
    const p = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(p);
    const old = IndexedDbRevisionStore.prototype.putAsset;
    IndexedDbRevisionStore.prototype.putAsset = async function (
      record: any,
      data: any,
    ) {
      if (record.id.startsWith("mj-")) {
        (window as any).staging = true;
        await new Promise<void>((r) => ((window as any).releaseStage = r));
      }
      return old.call(this, record, data);
    };
  });
  await page.getByRole("button", { name: "替换当前跨页", exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as any).staging))
    .toBe(true);
  await expect(
    page.getByRole("button", { name: "取消导入", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "照片", exact: true }).click();
  await page.getByLabel("导入照片", { exact: true }).setInputFiles({
    name: "two.jpg",
    mimeType: "image/jpeg",
    buffer: readFileSync(
      new URL("../fixtures/images/orientation-6.jpg", import.meta.url),
    ),
  });
  await expect(page.getByText("请等待当前资源操作完成")).toBeVisible({
    timeout: 3000,
  });
  await page.evaluate(() => (window as any).releaseStage());
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").first()).toHaveText("已保存至此浏览器");
  const saved = await page.evaluate(async () => {
    const p = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(p);
    const s = new IndexedDbRevisionStore("album-local-v1");
    return s.load((await s.listProjects())[0].projectId);
  });
  expect(
    saved.resources.assets.filter((a: any) => !a.usage || a.usage === "photo"),
  ).toHaveLength(1);
  expect(saved.doc.spreads[0].layers).toHaveLength(1);
  expect(
    saved.resources.assets.some(
      (a: any) => a.id === saved.doc.spreads[0].layers[0].alphaMask.assetId,
    ),
  ).toBe(true);
});
test("whole-book imported layout exports real PNG JPEG and PDF with its pinned mask", async ({
  page,
}) => {
  await page.goto("/apps/web/index.html");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await page.getByLabel("导入照片", { exact: true }).setInputFiles({
    name: "photo.png",
    mimeType: "image/png",
    buffer: readFileSync(
      new URL("../fixtures/images/transparent.png", import.meta.url),
    ),
  });
  await expect(
    page.getByRole("button", { name: "添加照片 photo.png" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page.getByRole("button", { name: "我的模板", exact: true }).click();
  const f = await buildMjtpl(0);
  await page.getByLabel("导入 MJTPL 模板").setInputFiles({
    name: "book.mjtpl",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(f.bytes),
  });
  await expect(
    page.getByText("已导入「Synthetic」，共 1 个版式。"),
  ).toBeVisible({ timeout: 30000 });
  await page.getByText("使用此主题排整本", { exact: true }).click();
  await page.getByLabel("加入整本 Page", { exact: true }).check();
  await page.getByRole("button", { name: "预备整本排版", exact: true }).click();
  await page
    .getByRole("button", { name: "确认应用整本主题", exact: true })
    .click();
  await expect(page.getByText("已应用整本主题，可以一次撤销。")).toBeVisible();
  await page.getByRole("button", { name: "保存", exact: true }).click();
  await expect(page.getByRole("status").first()).toHaveText("已保存至此浏览器");
  const results = await page.evaluate(async () => {
    const sp = "/packages/storage/src/index.ts",
      ep = "/packages/export/src/index.ts";
    const { IndexedDbRevisionStore } = await import(sp),
      e = await import(ep);
    const store = new IndexedDbRevisionStore("album-local-v1"),
      saved = await store.load((await store.listProjects())[0].projectId),
      signal = new AbortController().signal;
    const results = [];
    for (const format of ["png", "jpeg", "pdf"]) {
      const snap = await e.freezeSnapshot(
        saved,
        {
          format,
          dpi: 72,
          view: "spread",
          pageIds: [saved.doc.spreads[0].id],
          includeCover: false,
          bleedMm: 0,
          jpegMatte: "#ffffff",
        },
        new Date().toISOString(),
      );
      const report = await e.preflight(snap, store, signal);
      if (report.blockers.length) throw Error(JSON.stringify(report.blockers));
      const files = [];
      for await (const f of e.runExport(
        snap,
        report,
        report.warnings.map((i: any) => i.id),
        store,
        signal,
      ))
        files.push({
          name: f.filename,
          bytes: f.bytes.length,
          signature: Array.from(f.bytes.slice(0, 5)),
        });
      results.push({ format, files });
    }
    return results;
  });
  expect(results).toHaveLength(3);
  for (const r of results) {
    expect(r.files).toHaveLength(1);
    expect(r.files[0].bytes).toBeGreaterThan(100);
  }
  expect(results[0].files[0].signature.slice(0, 4)).toEqual([137, 80, 78, 71]);
  expect(results[1].files[0].signature.slice(0, 2)).toEqual([255, 216]);
  expect(results[2].files[0].signature.slice(0, 4)).toEqual([37, 80, 68, 70]);
});
test("creates matching-aspect project while retaining the prior project and private theme", async ({
  page,
}) => {
  await page.goto("/apps/web/index.html");
  await expect(
    page.getByRole("button", { name: "保存", exact: true }),
  ).toBeVisible({ timeout: 120000 });
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page.getByRole("button", { name: "我的模板", exact: true }).click();
  const f = await buildMjtpl(0, 40, 30);
  await page.getByLabel("导入 MJTPL 模板").setInputFiles({
    name: "forest.mjtpl",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(f.bytes),
  });
  await expect(
    page.getByText("已导入「Synthetic」，共 1 个版式。"),
  ).toBeVisible({ timeout: 30000 });
  page.once("dialog", (d) => d.accept());
  await page
    .getByRole("button", { name: "新建匹配尺寸作品", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "照片", exact: true }),
  ).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("album-active")))
    .not.toBeNull();
  const result = await page.evaluate(async () => {
    const p = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(p);
    const s = new IndexedDbRevisionStore("album-local-v1"),
      projects = await s.listProjects(),
      active = localStorage.getItem("album-active")!,
      saved = await s.load(active);
    return {
      count: projects.length,
      ratio: (saved.doc.pageSize.width * 2) / saved.doc.pageSize.height,
    };
  });
  expect(result.count).toBe(2);
  expect(result.ratio).toBeCloseTo(4 / 3, 6);
  await page.getByRole("button", { name: "模板与滤镜", exact: true }).click();
  await page.getByRole("button", { name: "我的模板", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Synthetic 1 个跨页/ }),
  ).toBeVisible();
});
test("loads genuine imported single-weight fonts without synthetic bold", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/preflight.html");
  const result = await page.evaluate(async () => {
    const p = "/packages/assets/src/index.ts";
    const a = await import(p),
      manifest = await (await fetch("/fonts/manifest.json")).json(),
      font = manifest.fonts[0];
    const record = {
      ...font,
      id: "import_single",
      source: { kind: "import", name: "single400" },
      faces: font.faces.filter((f: any) => f.weight === 400),
    };
    record.sha256 = await a.fontRecordHash(record);
    const signal = new AbortController().signal;
    const loaded = await a.loadFont(
      record,
      {
        async read(id: string) {
          const f = record.faces.find((f: any) => f.id === id);
          const response = await fetch(f.file);
          return new Uint8Array(await response.arrayBuffer());
        },
      },
      signal,
      "A",
    );
    const result = {
      faces: loaded.faces.map((f: any) => f.weight),
      unsupported: a.unsupportedGlyphs("A", loaded),
    };
    loaded.dispose();
    return result;
  });
  expect(result.faces.every((w: number) => w === 400)).toBe(true);
  expect(result.unsupported).toEqual([]);
});
