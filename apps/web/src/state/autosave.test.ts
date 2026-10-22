import { History } from "./history";
import { it, expect, vi, afterEach } from "vitest";
import { Autosave } from "./autosave";
import fixture from "../../../../tests/fixtures/documents/minimal.json";
afterEach(() => vi.useRealTimers());
it("saves after2 seconds idle and updates revision only after committed success", async () => {
  vi.useFakeTimers();
  let doc: any = structuredClone(fixture);
  let calls = 0;
  const store: any = {
    save: async (d: any, revision: number, resources: any) => {
      calls++;
      return {
        ok: true,
        value: {
          doc: { ...d, revision: revision + 1 },
          resources,
          docHash: "x",
          savedAt: "now",
        },
      };
    },
  };
  const save = new Autosave(
    store,
    () => doc,
    () => ({ assets: [], fonts: [] }),
  );
  save.markDirty();
  await vi.advanceTimersByTimeAsync(1999);
  expect(calls).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(calls).toBe(1);
  expect(save.status).toBe("saved");
  expect(save.lastResult?.ok && save.lastResult.value.doc.revision).toBe(2);
  save.dispose();
});
it("saves at10 seconds under continuous edits and surfaces quota failure with recoverable draft", async () => {
  vi.useFakeTimers();
  let calls = 0;
  const doc: any = structuredClone(fixture);
  const store: any = {
    save: async () => {
      calls++;
      return { ok: false, code: "STORAGE_FULL", recoveryDraft: doc };
    },
  };
  const save = new Autosave(
    store,
    () => doc,
    () => ({ assets: [], fonts: [] }),
  );
  save.markDirty();
  for (let i = 0; i < 9; i++) {
    await vi.advanceTimersByTimeAsync(1000);
    save.markDirty();
  }
  expect(calls).toBe(0);
  await vi.advanceTimersByTimeAsync(1000);
  expect(calls).toBe(1);
  expect(save.status).toBe("error");
  expect(
    save.lastResult && !save.lastResult.ok && save.lastResult.recoveryDraft,
  ).toEqual(doc);
  save.dispose();
});
it("queues edits made during an in-flight save and uses the committed revision for the next save", async () => {
  let doc: any = structuredClone(fixture);
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  const revisions: number[] = [];
  let count = 0;
  const store: any = {
    save: async (d: any, revision: number, resources: any) => {
      revisions.push(revision);
      if (++count === 1) await gate;
      return {
        ok: true,
        value: {
          doc: { ...d, revision: revision + 1 },
          resources,
          docHash: "x",
          savedAt: "now",
        },
      };
    },
  };
  const save = new Autosave(
    store,
    () => doc,
    () => ({ assets: [], fonts: [] }),
  );
  save.markDirty();
  const first = save.flush();
  doc = { ...doc, title: "new edit" };
  save.markDirty();
  const next = save.flush();
  release();
  await first;
  const result = await next;
  expect(revisions).toEqual([1, 2]);
  expect(result.ok && result.value.doc.title).toBe("new edit");
  expect(save.status).toBe("saved");
  save.dispose();
});
it("keeps resource references from undo and redo drafts", () => {
  const doc = structuredClone(fixture) as any;
  doc.spreads[0].layers = [
    {
      id: "photo",
      type: "image",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      opacity: 1,
      visible: true,
      locked: false,
      assetId: "asset_1",
      crop: { x: 0, y: 0, width: 1, height: 1 },
      fitMode: "cover",
      role: "photo",
    },
  ];
  const h = new History(doc);
  h.execute({ type: "delete-layer", layerId: "photo" });
  expect(h.referencesAsset("asset_1")).toBe(true);
  h.undo();
  expect(h.referencesAsset("asset_1")).toBe(true);
  expect(h.referencesAsset("absent")).toBe(false);
});
