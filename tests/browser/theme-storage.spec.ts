import { test, expect } from "@playwright/test";
test("theme imports are atomic, deduplicate by source hash, and survive reopen independently", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/storage.html");
  const result = await page.evaluate(async () => {
    const url = "/packages/storage/src/index.ts";
    const { IndexedDbThemeLibrary } = await import(url);
    const db = "themes_" + crypto.randomUUID();
    let library = new IndexedDbThemeLibrary(db);
    const converted = {
      theme: {
        version: 1,
        id: "theme_1",
        name: "Same name",
        sourceHash: "a".repeat(64),
        pages: [
          {
            id: "p1",
            name: "Page",
            width: 100,
            height: 100,
            previewPath: "preview.png",
            background: "#fff",
            layers: [],
            photoSlots: [],
            issues: [],
          },
        ],
        resources: { assets: [], fonts: [] },
        issues: [],
      },
      files: new Map([["preview.png", new Uint8Array([1, 2, 3])]]),
    };
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) {
      if (this.name === "themes")
        throw new DOMException("Injected quota", "QuotaExceededError");
      return original.apply(this, args as any);
    };
    let quota = false;
    try {
      await library.put(converted);
    } catch {
      quota = true;
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    const afterQuota = (await library.list()).length;
    const cancelled = new AbortController();
    cancelled.abort();
    let abort = false;
    try {
      await library.put(converted, cancelled.signal);
    } catch {
      abort = true;
    }
    const afterAbort = (await library.list()).length;
    const first = await library.put(converted);
    const duplicate = await library.put({
      ...converted,
      theme: { ...converted.theme, id: "duplicate", name: "Different" },
    });
    const second = await library.put({
      ...converted,
      theme: { ...converted.theme, id: "theme_2", sourceHash: "b".repeat(64) },
    });
    await library.close();
    library = new IndexedDbThemeLibrary(db);
    const loaded = await library.get(first.id);
    const count = (await library.list()).length;
    // Copy out bytes, as project staging does; removing the source cannot mutate copies.
    const copied = new Uint8Array(loaded.files.get("preview.png")!);
    await library.remove(first.id);
    const remaining = (await library.list()).map((t: any) => t.id);
    let missing = false;
    try {
      await library.get(first.id);
    } catch {
      missing = true;
    }
    await library.close();
    return {
      quota,
      afterQuota,
      abort,
      afterAbort,
      first,
      duplicate,
      second,
      count,
      bytes: [...loaded.files.get("preview.png")!],
      copied: [...copied],
      remaining,
      missing,
    };
  });
  expect(result).toEqual({
    quota: true,
    afterQuota: 0,
    abort: true,
    afterAbort: 0,
    first: { id: "theme_1", existing: false },
    duplicate: { id: "theme_1", existing: true },
    second: { id: "theme_2", existing: false },
    count: 2,
    bytes: [1, 2, 3],
    copied: [1, 2, 3],
    remaining: ["theme_2"],
    missing: true,
  });
});

test("abort after files write rolls back metadata and payload together", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/storage.html");
  const result = await page.evaluate(async () => {
    const url = "/packages/storage/src/index.ts";
    const { IndexedDbThemeLibrary } = await import(url);
    const db = "theme_abort_" + crypto.randomUUID();
    const library = new IndexedDbThemeLibrary(db);
    const controller = new AbortController();
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args: any[]) {
      const request = original.apply(this, args as any);
      if (this.name === "files")
        request.addEventListener("success", () => controller.abort());
      return request;
    };
    let aborted = false;
    try {
      await library.put(
        {
          theme: {
            version: 1,
            id: "theme",
            name: "Abort",
            sourceHash: "a".repeat(64),
            pages: [
              {
                id: "p",
                name: "Page",
                width: 1,
                height: 1,
                previewPath: "preview",
                background: "#fff",
                layers: [],
                photoSlots: [],
                issues: [],
              },
            ],
            resources: { assets: [], fonts: [] },
            issues: [],
          },
          files: new Map([["preview", new Uint8Array([1])]]),
        },
        controller.signal,
      );
    } catch {
      aborted = true;
    } finally {
      IDBObjectStore.prototype.put = original;
    }
    const count = (await library.list()).length;
    await library.close();
    const connection = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = indexedDB.open(db);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const payloads = await new Promise<number>((resolve, reject) => {
      const req = connection.transaction("files").objectStore("files").count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    connection.close();
    return { aborted, count, payloads };
  });
  expect(result).toEqual({ aborted: true, count: 0, payloads: 0 });
});

test("deleting a theme preserves resources copied into the project database", async ({
  page,
}) => {
  await page.goto("/tests/browser/harness/storage.html");
  const result = await page.evaluate(async () => {
    const url = "/packages/storage/src/index.ts";
    const { IndexedDbThemeLibrary, IndexedDbRevisionStore } = await import(url);
    const bytes = new Uint8Array([1, 2, 3]);
    const sha = [
      ...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    ]
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
    const variant = {
      sha256: sha,
      byteLength: bytes.length,
      width: 1,
      height: 1,
      mimeType: "image/png",
    };
    const asset = {
      id: "imported_mask",
      version: 1,
      status: "ready",
      usage: "mask",
      sha256: sha,
      license: { id: "private", usable: true },
      source: { name: "Mask" },
      width: 1,
      height: 1,
      mimeType: "image/png",
      variants: { original: variant, normalized: variant, preview: variant },
    };
    const library = new IndexedDbThemeLibrary(
      "delete_theme_" + crypto.randomUUID(),
    );
    const project = new IndexedDbRevisionStore(
      "copied_project_" + crypto.randomUUID(),
    );
    await library.put({
      theme: {
        version: 1,
        id: "theme",
        name: "Private",
        sourceHash: "a".repeat(64),
        pages: [
          {
            id: "page",
            name: "Page",
            width: 1,
            height: 1,
            previewPath: "preview",
            background: "#fff",
            layers: [],
            photoSlots: [],
            issues: [],
          },
        ],
        resources: { assets: [asset], fonts: [] },
        issues: [],
      },
      files: new Map([
        ["preview", bytes],
        ...(["original", "normalized", "preview"] as const).map(
          (v) => [`imported_mask:${v}`, bytes] as const,
        ),
      ]),
    });
    const loaded = await library.get("theme");
    await project.putAsset(
      loaded.theme.resources.assets[0],
      Object.fromEntries(
        ["original", "normalized", "preview"].map((v) => [
          v,
          loaded.files.get(`imported_mask:${v}`),
        ]),
      ),
    );
    await library.remove("theme");
    const remaining = [...(await project.read("imported_mask", "normalized"))];
    await library.close();
    await project.close();
    return remaining;
  });
  expect(result).toEqual([1, 2, 3]);
});
