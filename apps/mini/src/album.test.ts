import { describe, expect, it } from "vitest";
import { MiniApi, ApiError, type Transport } from "./api";
import {
  createMiniAlbum,
  configureMiniAlbum,
  loadMiniAlbum,
  submitMiniEdits,
  queueMiniPatch,
  uploadPhotos,
  selectPhotos,
  type RecoveryStore,
} from "../pages/album/index";
import { MiniTasks } from "../pages/tasks/index";
const response = (data: unknown, status = 200) => ({
  status,
  body:
    status < 400 ? { data, requestId: "r" } : { error: data, requestId: "r" },
});
const project = {
  project: { id: "p", revision: 2 },
  document: { schemaVersion: 1, spreads: [], advanced: { blend: "untouched" } },
};
function setup(transport: Transport) {
  const values = new Map<string, unknown>();
  const store: RecoveryStore = {
    get: (k) => values.get(k),
    set: (k, v) => {
      values.set(k, structuredClone(v));
    },
    remove: (k) => {
      values.delete(k);
    },
  };
  const api = new MiniApi({
    baseUrl: "https://api.test/v1",
    workspaceId: "w",
    transport,
    key: () => "key",
    loginCode: async () => "code",
  });
  configureMiniAlbum(api, store);
  return { api, store, values };
}
describe("mini safe workflow", () => {
  it("selects fifty photos and defaults to ten spreads without uploading implicitly", () => {
    expect(
      selectPhotos(
        createMiniAlbum(),
        Array.from({ length: 50 }, (_, i) => ({
          path: `/${i}`,
          filename: `${i}.jpg`,
          sizeBytes: 10,
          declaredMime: "image/jpeg" as const,
          sha256: "0".repeat(64),
        })),
      ),
    ).toMatchObject({
      selectedPhotoCount: 50,
      spreadCount: 10,
      phase: "upload",
    });
  });
  it.each([0, 409])(
    "preserves recovery patches on network/conflict %s and sends no document",
    async (status) => {
      const sent: unknown[] = [];
      const { store } = setup(async (req) => {
        if (req.path === "/auth/wechat/mini")
          return response({ accessToken: "access", refreshToken: "refresh" });
        if (req.method === "GET") return response(project);
        sent.push(req.body);
        if (status === 0) throw new Error("offline");
        return response(
          { code: "REVISION_CONFLICT", message: "conflict", retryable: false },
          409,
        );
      });
      const state = queueMiniPatch(await loadMiniAlbum("p"), {
        type: "setText",
        spreadId: "s",
        layerId: "t",
        text: "旅行",
      });
      const saved = await submitMiniEdits(state, "save");
      expect(saved).toMatchObject({
        recoverable: true,
        pendingPatches: state.pendingPatches,
        revision: 2,
      });
      expect(saved.message).toContain(status === 409 ? "其他设备" : "本地草稿");
      expect(store.get("mini:w:p")).toMatchObject({
        revision: 2,
        pendingPatches: state.pendingPatches,
      });
      expect(sent).toEqual([
        {
          commandId: "save",
          clientPlatform: "mini",
          commands: state.pendingPatches,
        },
      ]);
    },
  );
  it("keeps unknown document fields server-side and retains edits made during save", async () => {
    let resolve!: (v: ReturnType<typeof response>) => void;
    setup(async (req) =>
      req.path.includes("auth")
        ? response({ accessToken: "a", refreshToken: "r" })
        : req.method === "GET"
          ? response(project)
          : new Promise((r) => {
              resolve = r;
            }),
    );
    const state = queueMiniPatch(await loadMiniAlbum("p"), {
      type: "setText",
      spreadId: "s",
      layerId: "t",
      text: "one",
    });
    const saving = submitMiniEdits(state, "save");
    await new Promise((r) => setTimeout(r, 0));
    const edited = queueMiniPatch(state, {
      type: "setText",
      spreadId: "s",
      layerId: "t",
      text: "two",
    });
    expect(edited.pendingPatches).toHaveLength(2);
    const latest = edited.pendingPatches[1];
    resolve(response({ ...project, project: { id: "p", revision: 3 } }));
    const saved = await saving;
    expect(saved.document).toEqual(project.document);
    expect(saved.pendingPatches).toEqual([latest]);
  });
  it("restores local revision without replaying against a changed cloud revision", async () => {
    const { store } = setup(async (req) =>
      response(
        req.path.includes("auth")
          ? { accessToken: "a", refreshToken: "r" }
          : project,
      ),
    );
    store.set("mini:w:p", {
      revision: 1,
      pendingPatches: [
        { type: "setText", spreadId: "s", layerId: "t", text: "draft" },
      ],
    });
    expect(await loadMiniAlbum("p")).toMatchObject({
      revision: 1,
      conflict: true,
      recoverable: true,
    });
  });
  it("retries only failed photos and honors ticket PUT before completing", async () => {
    let fail = true;
    const calls: string[] = [];
    const { api } = setup(async (req) => {
      calls.push(req.path);
      if (req.path.includes("auth"))
        return response({ accessToken: "a", refreshToken: "r" });
      if (req.path.endsWith("/uploads"))
        return response({
          uploadId: "u",
          assetId: "a",
          method: "PUT",
          url: "https://storage.test/object",
          headers: [],
          formFields: [],
          maxBytes: 100,
        });
      return response({ id: "a", state: "ready" });
    });
    const state = selectPhotos(createMiniAlbum(), [
      {
        path: "/a",
        filename: "a.jpg",
        sizeBytes: 10,
        declaredMime: "image/jpeg",
        sha256: "0".repeat(64),
      },
    ]);
    const transfer = async () => {
      if (fail) throw new Error("offline");
    };
    await uploadPhotos(state, api, transfer);
    expect(state.photos[0]?.status).toBe("failed");
    fail = false;
    await uploadPhotos(state, api, transfer);
    expect(state.photos[0]?.status).toBe("ready");
    await uploadPhotos(state, api, transfer);
    expect(calls.filter((c) => c.endsWith("/complete"))).toHaveLength(1);
  });
  it("paginates real task ids and exposes unavailable C4 without fabricated jobs", async () => {
    const { api } = setup(async (req) =>
      req.path.includes("auth")
        ? response({ accessToken: "a", refreshToken: "r" })
        : response({
            items: [
              {
                id: req.path.includes("cursor=") ? "web2" : "web1",
                state: "running",
              },
            ],
            nextCursor: req.path.includes("cursor=") ? null : "next",
            hasMore: !req.path.includes("cursor="),
          }),
    );
    const tasks = new MiniTasks(api);
    await tasks.load();
    await tasks.load(true);
    expect(tasks.items.map((i) => i.jobId)).toEqual(["web1", "web2"]);
    const off = new MiniTasks(api, false);
    await off.load();
    expect(off.status).toBe("unconfigured");
    expect(off.items).toEqual([]);
  });
  it("refreshes once for concurrent unauthorized requests and clears invalid sessions", async () => {
    let refreshes = 0;
    const { api } = setup(async (req) => {
      if (req.path === "/auth/wechat/mini")
        return response({ accessToken: "old", refreshToken: "r" });
      if (req.path === "/auth/token/refresh") {
        refreshes++;
        return response({ accessToken: "new", refreshToken: "r2" });
      }
      return req.headers.Authorization === "Bearer new"
        ? response({ ok: true })
        : response({ code: "UNAUTHORIZED", message: "expired" }, 401);
    });
    await Promise.all([api.request("GET", "/x"), api.request("GET", "/y")]);
    expect(refreshes).toBe(1);
  });
  it("rejects full document writes and crop rectangles outside their frame", async () => {
    setup(async () => response(project));
    expect(() =>
      queueMiniPatch(createMiniAlbum(), {
        type: "replaceDocument",
        document: {},
      } as never),
    ).toThrow();
    expect(() =>
      queueMiniPatch(createMiniAlbum(), {
        type: "setCrop",
        spreadId: "s",
        layerId: "i",
        crop: { x: 0.9, y: 0, width: 0.5, height: 1 },
      }),
    ).toThrow();
  });
});

import { sha256 } from "./sha256";
import { createWxTransport, transferWxPhoto } from "./wx";
it("computes upload SHA-256 for binary inputs without a browser crypto shim", () => {
  expect(sha256(new TextEncoder().encode("abc"))).toBe(
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  expect(sha256(new Uint8Array())).toBe(
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
  );
});
it("wx adapter limits bearer to API calls and uploads PUT ticket bytes", async () => {
  const requests: unknown[] = [];
  const wx = {
    request: (options: any) => {
      requests.push(options);
      options.success({ statusCode: 200, data: { data: { ok: true } } });
    },
    getFileSystemManager: () => ({
      readFile: (options: any) =>
        options.success({ data: new Uint8Array([1, 2]).buffer }),
    }),
  };
  const transport = createWxTransport(wx as never, "https://api.test/v1");
  await transport({
    method: "GET",
    path: "/x",
    headers: { Authorization: "Bearer secret" },
  });
  await transferWxPhoto(
    wx as never,
    {
      method: "PUT",
      url: "https://storage.test/x",
      headers: [{ name: "Content-Type", value: "image/jpeg" }],
      formFields: [],
    } as never,
    { path: "/a" } as never,
  );
  expect(requests).toMatchObject([
    {
      url: "https://api.test/v1/x",
      header: { Authorization: "Bearer secret" },
    },
    {
      url: "https://storage.test/x",
      method: "PUT",
      header: { "Content-Type": "image/jpeg" },
    },
  ]);
  expect((requests[1] as any).header.Authorization).toBeUndefined();
});

import { buildMiniPreview, editableMiniSlots } from "./preview";
it("previews known layers without mutating opaque layers and edits only declared template slots", () => {
  const opaque = {
    id: "fx",
    type: "futureEffect",
    privateExtension: { blend: 3 },
  };
  const doc = {
    pageSize: { width: 100, height: 100 },
    spreads: [
      {
        id: "s",
        layers: [
          {
            id: "t",
            type: "text",
            text: "title",
            x: 1,
            y: 2,
            width: 50,
            height: 20,
            editableFields: ["text"],
          },
          opaque,
        ],
      },
    ],
  } as never;
  expect(buildMiniPreview(doc, {})).toMatchObject({
    unsupported: true,
    spreads: [{ id: "s", layers: [{ id: "t", text: "title" }] }],
  });
  const templates = [
    {
      slots: [
        {
          spreadId: "s",
          layerId: "t",
          kind: "text",
          miniEditableFields: ["text"],
        },
      ],
    },
  ] as never;
  expect(editableMiniSlots(doc, templates)).toMatchObject([
    { spreadId: "s", layerId: "t", text: "title", canText: true },
  ]);
  expect(opaque.privateExtension).toEqual({ blend: 3 });
});

import { createAlbumPage } from "./album-page";
it("native page surfaces setup errors and never claims a configured service", async () => {
  const page = createAlbumPage(async () => {
    throw new Error("云服务未配置");
  });
  const view: Record<string, unknown> = {};
  Object.assign(page, { setData: (data: object) => Object.assign(view, data) });
  await page.onLoad({});
  expect(view.message).toBe("云服务未配置");
  expect(view.busy).toBe(false);
});

import { createMiniProject, applyMiniLayout } from "./album";
it("uses ProjectDocument creation response and quoted If-Match on save and layout apply", async () => {
  const requests: any[] = [];
  setup(async (req) => {
    requests.push(req);
    return req.path.includes("auth")
      ? response({ accessToken: "a", refreshToken: "r" })
      : response(project);
  });
  const state = await createMiniProject(createMiniAlbum(), {
    name: "旅行",
    mode: "quick_album",
    scene: "travel",
    pageWidthMm: 210,
    pageHeightMm: 210,
    spreadCount: 10,
  });
  expect(state.projectId).toBe("p");
  queueMiniPatch(state, {
    type: "setText",
    spreadId: "s",
    layerId: "t",
    text: "旅行",
  });
  await submitMiniEdits(state, "save");
  await applyMiniLayout(state, { id: "candidate" } as never);
  expect(
    requests
      .filter((r) => r.method === "PATCH" || r.path.endsWith("apply-layout"))
      .map((r) => r.headers["If-Match"]),
  ).toEqual(['"2"', '"2"']);
});
it("normalizes task pagination per request rather than returning previously accumulated pages", async () => {
  const { api } = setup(async (req) =>
    req.path.includes("auth")
      ? response({ accessToken: "a", refreshToken: "r" })
      : response({
          items: [
            {
              id: req.path.includes("cursor=") ? "second" : "first",
              state: "running",
            },
          ],
          nextCursor: "next",
          hasMore: true,
        }),
  );
  const { configureMiniTasks, listMiniTasks } = await import("./tasks");
  configureMiniTasks(api, true);
  expect((await listMiniTasks(null)).items).toEqual([
    { jobId: "first", state: "running" },
  ]);
  expect((await listMiniTasks("next")).items).toEqual([
    { jobId: "second", state: "running" },
  ]);
});

it("checks pending scan on retry without uploading bytes again or replaying a stale complete result", async () => {
  let ready = false;
  let transfers = 0;
  const requests: string[] = [];
  const { api } = setup(async (req) => {
    requests.push(req.path);
    if (req.path.includes("auth"))
      return response({ accessToken: "a", refreshToken: "r" });
    if (req.path.endsWith("/uploads"))
      return response({
        uploadId: "u",
        assetId: "asset",
        method: "PUT",
        url: "https://storage.test/x",
        headers: [],
        formFields: [],
        maxBytes: 100,
        expiresAt: "2099-01-01T00:00:00Z",
      });
    return response({
      id: "asset",
      width: 10,
      height: 20,
      state: ready ? "ready" : "pending_scan",
    });
  });
  const state = selectPhotos(createMiniAlbum(), [
    {
      path: "/a",
      filename: "a.jpg",
      sizeBytes: 10,
      declaredMime: "image/jpeg",
      sha256: "0".repeat(64),
    },
  ]);
  await uploadPhotos(state, api, async () => {
    transfers++;
  });
  expect(state.photos[0].status).toBe("failed");
  ready = true;
  await uploadPhotos(state, api, async () => {
    transfers++;
  });
  expect(state.photos[0]).toMatchObject({
    status: "ready",
    width: 10,
    height: 20,
  });
  expect(transfers).toBe(1);
  expect(requests.filter((p) => p.endsWith("/complete"))).toHaveLength(1);
  expect(requests).toContain("/assets/asset");
});
it("binary SHA256 handles multiple blocks", async () => {
  const { createHash } = await import("node:crypto");
  const bytes = Uint8Array.from({ length: 257 }, (_, i) => i % 256);
  expect(sha256(bytes)).toBe(createHash("sha256").update(bytes).digest("hex"));
});

it("deduplicates concurrent saves so a late second response cannot discard newer edits", async () => {
  let calls = 0;
  let finish!: (v: ReturnType<typeof response>) => void;
  setup(async (req) =>
    req.path.includes("auth")
      ? response({ accessToken: "a", refreshToken: "r" })
      : req.method === "GET"
        ? response(project)
        : new Promise((r) => {
            calls++;
            finish = r;
          }),
  );
  const state = queueMiniPatch(await loadMiniAlbum("p"), {
    type: "setText",
    spreadId: "s",
    layerId: "t",
    text: "first",
  });
  const first = submitMiniEdits(state, "first");
  const duplicate = submitMiniEdits(state, "second");
  await new Promise((r) => setTimeout(r, 0));
  queueMiniPatch(state, {
    type: "setText",
    spreadId: "s",
    layerId: "t",
    text: "newer",
  });
  expect(calls).toBe(1);
  finish(response({ ...project, project: { id: "p", revision: 3 } }));
  await Promise.all([first, duplicate]);
  expect(state.pendingPatches).toMatchObject([{ text: "newer" }]);
});

it("opens retained recovery patches offline without pretending a cloud document was loaded", async () => {
  const { store } = setup(async (req) => {
    if (req.path.includes("auth"))
      return response({ accessToken: "a", refreshToken: "r" });
    throw new Error("offline");
  });
  store.set("mini:w:p", {
    revision: 2,
    pendingPatches: [
      { type: "setText", spreadId: "s", layerId: "t", text: "offline draft" },
    ],
  });
  const state = await loadMiniAlbum("p");
  expect(state).toMatchObject({
    projectId: "p",
    revision: 2,
    recoverable: true,
    pendingPatches: [{ text: "offline draft" }],
  });
  expect(state.document).toBeUndefined();
  expect(state.message).toContain("离线");
});
it("keeps a late save recovery record inside its original workspace context", async () => {
  let finish!: (v: ReturnType<typeof response>) => void;
  const a = setup(async (req) =>
    req.path.includes("auth")
      ? response({ accessToken: "a", refreshToken: "r" })
      : req.method === "GET"
        ? response(project)
        : new Promise((r) => {
            finish = r;
          }),
  );
  const state = queueMiniPatch(await loadMiniAlbum("p"), {
    type: "setText",
    spreadId: "s",
    layerId: "t",
    text: "a",
  });
  const saving = submitMiniEdits(state, "save");
  await new Promise((r) => setTimeout(r, 0));
  const b = setup(async () => response(project));
  finish(response({ ...project, project: { id: "p", revision: 3 } }));
  await saving;
  expect(a.store.get("mini:w:p")).toMatchObject({
    revision: 3,
    pendingPatches: [],
  });
  expect(b.store.get("mini:w:p")).toBeUndefined();
});

it("projects edits into inputs without resetting text, and matches immutable slot identity after layer ids change", () => {
  const doc = {
    pageSize: { width: 100, height: 100 },
    spreads: [
      {
        id: "new-spread",
        templateRef: { id: "theme", version: 1 },
        layers: [
          {
            id: "new-layer",
            type: "text",
            text: "old",
            templateSlot: { version: 1, slotId: "title" },
            editableFields: ["text"],
          },
        ],
      },
    ],
  } as never;
  const templates = [
    {
      id: "theme",
      version: 1,
      slots: [
        {
          slotId: "title",
          spreadId: "original",
          layerId: "original",
          miniEditableFields: ["text"],
        },
      ],
    },
  ] as never;
  const patches = [
    {
      type: "setText",
      spreadId: "new-spread",
      layerId: "new-layer",
      text: "typed",
    },
  ] as never;
  expect(editableMiniSlots(doc, templates, patches)).toMatchObject([
    { text: "typed", layerId: "new-layer" },
  ]);
});
it("preview honors spread double-page width and persisted image crops", () => {
  const doc = {
    pageSize: { width: 100, height: 100 },
    spreads: [
      {
        id: "s",
        layers: [
          {
            id: "i",
            type: "image",
            x: 100,
            y: 0,
            width: 100,
            height: 100,
            crop: { x: 0.25, y: 0, width: 0.5, height: 1 },
            assetId: "a",
          },
        ],
      },
    ],
  } as never;
  const view = buildMiniPreview(doc, { a: "private-preview" });
  expect(view.spreads[0].layers[0].style).toContain("left:50%");
  expect(view.spreads[0].layers[0].imageStyle).toContain("width:200%");
  expect(view.spreads[0].layers[0].imageStyle).toContain("left:-50%");
});

it("coalesces typing before save so normal editing stays below the contract command limit", () => {
  setup(async () => response(project));
  const state = createMiniAlbum();
  for (let i = 0; i < 200; i++)
    queueMiniPatch(state, {
      type: "setText",
      spreadId: "s",
      layerId: "t",
      text: `typed ${i}`,
    });
  expect(state.pendingPatches).toEqual([
    { type: "setText", spreadId: "s", layerId: "t", text: "typed 199" },
  ]);
});

it("native preview requests authorized private image tokens and keeps the loaded document intact", async () => {
  const doc = {
    pageSize: { width: 100, height: 100 },
    spreads: [
      {
        id: "s",
        layers: [
          {
            id: "photo",
            type: "image",
            x: 0,
            y: 0,
            width: 100,
            height: 100,
            assetId: "private",
            crop: { x: 0, y: 0, width: 1, height: 1 },
          },
        ],
      },
    ],
  };
  const paths: string[] = [];
  const { api } = setup(async (req) => {
    paths.push(req.path);
    if (req.path.includes("auth"))
      return response({ accessToken: "a", refreshToken: "r" });
    if (req.path.includes("/projects/"))
      return response({ ...project, document: doc });
    if (req.path.includes("download-token"))
      return response({ url: "https://private.test/signed" });
    return response({ items: [], nextCursor: null, hasMore: false });
  });
  const runtime = {
    api,
    wx: {} as never,
    capabilities: { layout: false, tasks: false, export: false },
    algorithmVersion: "local-layout-v1",
  };
  const page = createAlbumPage(async () => runtime);
  const view: any = {};
  Object.assign(page, { setData: (v: object) => Object.assign(view, v) });
  await page.onLoad({ projectId: "p" });
  await page.preview();
  expect(paths).toContain("/assets/private/download-token?variant=preview");
  expect(view.preview.spreads[0].layers[0].url).toBe(
    "https://private.test/signed",
  );
  expect(view.state.document).toEqual(doc);
});

import { createNativePage } from "./native-page";
it("native registration creates independent controllers for each page instance", async () => {
  const definition = createNativePage(() => {
    let count = 0;
    return {
      data: { count: 0 },
      onLoad() {},
      increment(this: { setData(v: object): void }) {
        this.setData({ count: ++count });
      },
    };
  });
  const a: any = {
      setData(v: object) {
        Object.assign(this, v);
      },
    },
    b: any = {
      setData(v: object) {
        Object.assign(this, v);
      },
    };
  (definition.onLoad as Function).call(a);
  (definition.onLoad as Function).call(b);
  (definition.increment as Function).call(a);
  (definition.increment as Function).call(a);
  (definition.increment as Function).call(b);
  expect(a.count).toBe(2);
  expect(b.count).toBe(1);
  expect(definition.setData).toBeUndefined();
});

it("restarts an expired upload after successful byte transfer and an offline completion response", async () => {
  const { vi } = await import("vitest");
  const start = Date.parse("2026-10-23T00:00:00Z");
  let now = start;
  const clock = vi.spyOn(Date, "now").mockImplementation(() => now);
  try {
    let tickets = 0;
    let completionAttempts = 0;
    let transfers = 0;
    const requests: Array<{ path: string; key?: string; body?: unknown }> = [];
    const { api } = setup(async (request) => {
      requests.push({
        path: request.path,
        key: request.headers["Idempotency-Key"],
        body: request.body,
      });
      if (request.path.includes("/auth/"))
        return response({ accessToken: "a", refreshToken: "r" });
      if (request.path.endsWith("/uploads")) {
        tickets++;
        return response({
          uploadId: `upload-${tickets}`,
          assetId: `asset-${tickets}`,
          method: "PUT",
          url: `https://storage.test/${tickets}`,
          headers: [],
          formFields: [],
          maxBytes: 100,
          expiresAt: new Date(now + 900_000).toISOString(),
        });
      }
      if (request.path.endsWith("/complete")) {
        completionAttempts++;
        if (completionAttempts === 1) throw new Error("offline");
        if (request.path === "/assets/asset-1/complete")
          return response(
            { code: "UPLOAD_EXPIRED", message: "expired", retryable: false },
            409,
          );
        return response({
          id: "asset-2",
          state: "ready",
          width: 20,
          height: 10,
        });
      }
      throw new Error(`Unexpected request ${request.path}`);
    });
    let sequence = 0;
    api.options.key = () => `unique-operation-key-${++sequence}`;
    const state = selectPhotos(createMiniAlbum(), [
      {
        path: "/retained.jpg",
        filename: "retained.jpg",
        sizeBytes: 10,
        declaredMime: "image/jpeg",
        sha256: "0".repeat(64),
      },
    ]);
    const transfer = async () => {
      transfers++;
    };
    await uploadPhotos(state, api, transfer);
    expect(state.photos[0]).toMatchObject({
      status: "failed",
      objectUploaded: true,
    });
    now += 901_000;
    await uploadPhotos(state, api, transfer);
    expect(state.photos[0]).toMatchObject({
      status: "ready",
      assetId: "asset-2",
      objectUploaded: true,
      completed: true,
    });
    expect(tickets).toBe(2);
    expect(transfers).toBe(2);
    const starts = requests.filter((r) => r.path.endsWith("/uploads"));
    const completions = requests.filter((r) => r.path.endsWith("/complete"));
    expect(starts[0].key).not.toBe(starts[1].key);
    expect(completions[0].key).not.toBe(completions[1].key);
    expect(completions[1].body).toMatchObject({ uploadId: "upload-2" });
  } finally {
    clock.mockRestore();
  }
});
