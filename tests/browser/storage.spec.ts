import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
const fixture = JSON.parse(
  readFileSync(
    new URL("../fixtures/documents/minimal.json", import.meta.url),
    "utf8",
  ),
);
test("two tabs use atomic CAS; quota failure preserves saved revision and recovery draft", async ({
  page,
  context,
}) => {
  await page.goto("/tests/browser/harness/storage.html");
  const db = "cas_" + Date.now();
  const initial = await page.evaluate(
    async ({ db, fixture }) => {
      const url = "/packages/storage/src/index.ts";
      const { IndexedDbRevisionStore } = await import(url);
      const store = new IndexedDbRevisionStore(db);
      return store.create(fixture, { assets: [], fonts: [] });
    },
    { db, fixture },
  );
  expect(initial.doc.revision).toBe(1);
  const tab = await context.newPage();
  await tab.goto("/tests/browser/harness/storage.html");
  const first = await page.evaluate(async (db) => {
    const url = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(url);
    const s = new IndexedDbRevisionStore(db);
    const v = await s.load("project_test");
    v.doc.title = "A";
    return s.save(v.doc, 1, v.resources);
  }, db);
  const second = await tab.evaluate(async (db) => {
    const url = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(url);
    const s = new IndexedDbRevisionStore(db);
    const v = await s.load("project_test");
    v.doc.title = "B";
    return s.save(v.doc, 1, v.resources);
  }, db);
  expect(first.ok).toBe(true);
  expect(second.code).toBe("REVISION_CONFLICT");
  expect(second.recoveryDraft.title).toBe("B");
  const quota = await page.evaluate(async (db) => {
    const url = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(url);
    const s = new IndexedDbRevisionStore(db);
    const v = await s.load("project_test");
    v.doc.title = "UNSAVED";
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (this.name === "revisions")
        throw new DOMException("Injected quota", "QuotaExceededError");
      return original.apply(this, args as any);
    };
    let result;
    try {
      result = await s.save(v.doc, 2, v.resources);
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    return { result, saved: await s.load("project_test") };
  }, db);
  expect(quota.result.code).toBe("STORAGE_FULL");
  expect(quota.result.recoveryDraft.title).toBe("UNSAVED");
  expect(quota.saved.doc.revision).toBe(2);
  expect(quota.saved.doc.title).toBe("A");
});
test("project ZIP round trips unknown extensions and rejects malformed and tampered input", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/storage.html");
  const result = await page.evaluate(async (fixture) => {
    const url = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore, exportProject, importProject } =
      await import(url);
    const s = new IndexedDbRevisionStore("bundle_" + crypto.randomUUID());
    fixture.extra = { future: { keep: 4 } } as any;
    await s.create(fixture, { assets: [], fonts: [] });
    const bytes = await exportProject(fixture.projectId, s);
    const imported = await importProject(bytes, s);
    let bad = false;
    try {
      await importProject(new Uint8Array([0, 1, 2]), s);
    } catch {
      bad = true;
    }
    return { imported, bad, size: bytes.length };
  }, fixture as any);
  expect(result.imported.doc.extra).toEqual({ future: { keep: 4 } });
  expect(result.imported.doc.projectId).not.toBe(fixture.projectId);
  expect(result.imported.doc.sourceProjectId).toBe(fixture.projectId);
  expect(result.bad).toBe(true);
  expect(result.size).toBeGreaterThan(100);
});
test("asset bytes are immutable and project imports verify hashes and roll back atomically on quota", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/storage.html");
  const result = await page.evaluate(async (fixture) => {
    const storageUrl = "/packages/storage/src/index.ts",
      assetsUrl = "/packages/assets/src/index.ts",
      zipUrl = "/node_modules/fflate/esm/browser.js";
    const { IndexedDbRevisionStore, exportProject, importProject } =
        await import(storageUrl),
      { importImage } = await import(assetsUrl),
      { unzipSync, zipSync, strToU8 } = await import(zipUrl);
    const bytes = await (
      await fetch("/tests/fixtures/images/landscape.png")
    ).arrayBuffer();
    const image = await importImage(
      new File([bytes], "landscape.png", { type: "image/png" }),
      new AbortController().signal,
    );
    const store = new IndexedDbRevisionStore(
      "resources_" + crypto.randomUUID(),
    );
    await store.putAsset(image.record, image);
    const resources = { assets: [image.record], fonts: [] };
    await store.create(fixture, resources);
    const read = await store.read(image.record.id, "original");
    let immutable = false;
    try {
      await store.putAsset({ ...image.record, version: 2 }, image);
    } catch {
      immutable = true;
    }
    const bundle = await exportProject(fixture.projectId, store);
    const files = unzipSync(bundle);
    files["document.json"] = strToU8('{"tampered":true}');
    let mismatch = false;
    try {
      await importProject(zipSync(files), store);
    } catch {
      mismatch = true;
    }
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (this.name === "projects")
        throw new DOMException("quota", "QuotaExceededError");
      return original.apply(this, args as any);
    };
    let quota = false;
    try {
      await importProject(bundle, store);
    } catch {
      quota = true;
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    const count = (await store.listProjects()).length;
    const valid = await importProject(bundle, store);
    return {
      same: read.every((n: number, i: number) => n === image.original[i]),
      immutable,
      mismatch,
      quota,
      count,
      importedResources: valid.resources.assets.length,
      readable:
        (await store.read(image.record.id, "original")).length === read.length,
    };
  }, fixture);
  expect(result).toEqual({
    same: true,
    immutable: true,
    mismatch: true,
    quota: true,
    count: 1,
    importedResources: 1,
    readable: true,
  });
});
test("history retention protects active export pins then releases old revisions", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/storage.html");
  const result = await page.evaluate(async (fixture) => {
    const url = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(url);
    const s = new IndexedDbRevisionStore("pins_" + crypto.randomUUID());
    const resources = { assets: [], fonts: [] };
    await s.create(fixture, resources);
    await s.pinResources("export_1", resources);
    for (let n = 1; n <= 21; n++) await s.save(fixture, n, resources);
    const pinned = (await s.load(fixture.projectId, 1)).doc.revision;
    await s.releaseResources("export_1");
    await s.save(fixture, 22, resources);
    let gone = false;
    try {
      await s.load(fixture.projectId, 1);
    } catch {
      gone = true;
    }
    return {
      pinned,
      gone,
      current: (await s.load(fixture.projectId)).doc.revision,
    };
  }, fixture);
  expect(result).toEqual({ pinned: 1, gone: true, current: 23 });
});
test("rejects mismatched aggregate font identity before storing any font bytes", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/storage.html");
  const code = await page.evaluate(async () => {
    const url = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(url);
    const catalog = await (await fetch("/fonts/manifest.json")).json();
    const store = new IndexedDbRevisionStore(
      "font_identity_" + crypto.randomUUID(),
    );
    try {
      await store.putFont(
        { ...catalog.fonts[0], sha256: "0".repeat(64) },
        new Map(),
      );
      return "ACCEPTED";
    } catch (error) {
      return (error as any).code;
    }
  });
  expect(code).toBe("HASH_MISMATCH");
});
test("recovers a bundle when identical image content was previously imported under another name", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/storage.html");
  const result = await page.evaluate(async (fixture) => {
    const su = "/packages/storage/src/index.ts",
      au = "/packages/assets/src/index.ts";
    const { IndexedDbRevisionStore, exportProject, importProject } =
        await import(su),
      { importImage } = await import(au);
    const bytes = await (
      await fetch("/tests/fixtures/images/landscape.png")
    ).arrayBuffer();
    const first = await importImage(
        new File([bytes], "original.png", { type: "image/png" }),
        new AbortController().signal,
      ),
      second = await importImage(
        new File([bytes], "renamed.png", { type: "image/png" }),
        new AbortController().signal,
      );
    const source = new IndexedDbRevisionStore(
        "name_source_" + crypto.randomUUID(),
      ),
      target = new IndexedDbRevisionStore("name_target_" + crypto.randomUUID());
    await source.putAsset(first.record, first);
    await source.create(fixture, { assets: [first.record], fonts: [] });
    await target.putAsset(second.record, second);
    const recovered = await importProject(
      await exportProject(fixture.projectId, source),
      target,
    );
    return {
      idSame: first.record.id === second.record.id,
      sourceName: recovered.resources.assets[0].source.name,
      bytes: (await target.read(first.record.id, "original")).length,
    };
  }, fixture);
  expect(result.idSame).toBe(true);
  expect(result.sourceName).toBe("original.png");
  expect(result.bytes).toBeGreaterThan(0);
});
test("captures caller-owned asset bytes before verification so later mutation cannot corrupt an original", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/storage.html");
  const result = await page.evaluate(async () => {
    const su = "/packages/storage/src/index.ts",
      au = "/packages/assets/src/index.ts";
    const { IndexedDbRevisionStore } = await import(su),
      { importImage } = await import(au);
    const bytes = await (
        await fetch("/tests/fixtures/images/orientation-6.jpg")
      ).arrayBuffer(),
      image = await importImage(
        new File([bytes], "original.png", { type: "image/jpeg" }),
        new AbortController().signal,
      );
    const store = new IndexedDbRevisionStore("owned_" + crypto.randomUUID());
    await store.putAsset(image.record, image);
    const mutable = {
      original: new Uint8Array(image.original),
      normalized: new Uint8Array(image.normalized),
      preview: new Uint8Array(image.preview),
    };
    const pending = store.putAsset(image.record, mutable);
    mutable.original.fill(0);
    await pending;
    return Array.from(await store.read(image.record.id, "original"));
  });
  expect(result.some((n) => n !== 0)).toBe(true);
});
test("captures document and manifest values before async revision hashing", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/storage.html");
  const result = await page.evaluate(async (fixture) => {
    const su = "/packages/storage/src/index.ts";
    const { IndexedDbRevisionStore } = await import(su);
    const s = new IndexedDbRevisionStore(
      "draft_capture_" + crypto.randomUUID(),
    );
    const draft = structuredClone(fixture),
      manifest = { assets: [], fonts: [] } as any;
    const creating = s.create(draft, manifest);
    draft.projectId = "changed_by_caller";
    manifest.assets.push({ invalid: true });
    const created = await creating;
    const next = structuredClone(created.doc);
    const saving = s.save(next, 1, created.resources);
    next.projectId = "changed_again";
    const saved = await saving;
    return {
      createdId: created.doc.projectId,
      resourceCount: created.resources.assets.length,
      saved: saved.ok,
      loaded: (await s.load(fixture.projectId)).doc.revision,
    };
  }, fixture);
  expect(result).toEqual({
    createdId: fixture.projectId,
    resourceCount: 0,
    saved: true,
    loaded: 2,
  });
});
