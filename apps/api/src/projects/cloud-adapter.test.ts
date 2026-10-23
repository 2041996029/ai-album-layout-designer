import { afterEach, beforeEach, expect, it, vi } from "vitest";
import fixture from "../../../../tests/fixtures/documents/minimal.json";
import type { DocumentModel } from "@album/document";
const state = vi.hoisted(() => ({ drafts: new Map<string, unknown>() }));
vi.mock("idb", () => ({
  openDB: vi.fn(async () => ({
    put: async (_store: string, value: unknown, key: string) => {
      state.drafts.set(key, structuredClone(value));
    },
    getAll: async () => [...state.drafts.values()],
    close() {},
  })),
}));
import { CloudRevisionStore } from "@album/storage";
beforeEach(() => {
  state.drafts.clear();
  vi.stubGlobal("indexedDB", {});
});
afterEach(() => {
  vi.unstubAllGlobals();
});
it("awaits the IndexedDB recovery write before offline requests and preserves distinct drafts", async () => {
  const d = structuredClone(fixture) as DocumentModel;
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    expect(state.drafts.size).toBe(calls);
    throw Error("offline");
  }) as typeof fetch;
  const store = new CloudRevisionStore(
    "https://album.test",
    "workspace",
    fetcher,
  );
  const first = await store.save(d, 1, { assets: [], fonts: [] });
  d.unsavedChange = "new content";
  const second = await store.save(d, 1, { assets: [], fonts: [] });
  expect(first).toEqual({
    ok: false,
    code: "STORAGE_FAILED",
    recoveryDraft: fixture,
  });
  expect(second).toEqual({
    ok: false,
    code: "STORAGE_FAILED",
    recoveryDraft: d,
  });
  const drafts = await store.recoveryDrafts(d.projectId);
  expect(drafts).toHaveLength(2);
  expect(drafts.map((x) => x.doc.unsavedChange)).toContain("new content");
});
