import type { DocumentModel } from "../../../packages/document/src/model";
import { type MiniRuntime, getMiniRuntime } from "./runtime";
import type { Schema } from "./api";
import { chooseWxPhotos, transferWxPhoto } from "./wx";
import {
  createMiniAlbum,
  selectPhotos,
  uploadPhotos,
  loadMiniAlbum,
  submitMiniEdits,
  queueMiniPatch,
  copyRecovery,
  reloadMiniAlbum,
  createMiniProject,
  listMiniFolders,
  createMiniFolder,
  requestMiniLayout,
  listMiniCandidates,
  applyMiniLayout,
  type MiniAlbumState,
} from "./album";
import { buildMiniPreview, editableMiniSlots } from "./preview";
type Event = {
  detail: { value: string };
  currentTarget: { dataset: { index?: number; field?: string; id?: string } };
};
interface PageHost {
  setData(data: object): void;
  sync(): void;
  run(work: () => Promise<void>): Promise<void>;
  refreshFolders(): Promise<void>;
  data: { newFolderName: string };
}
export function createAlbumPage(
  resolveRuntime: () => Promise<MiniRuntime> = getMiniRuntime,
) {
  let runtime: MiniRuntime;
  let state: MiniAlbumState = createMiniAlbum();
  let templates: Schema<"Template">[] = [];
  let folders: Schema<"Folder">[] = [];
  let candidates: Schema<"LayoutCandidate">[] = [];
  let jobId: string | null = null;
  let active = true;
  let busy = false;
  let themeIndex = 0;
  let name = "我的旅行相册";
  async function previewDocument(
    document: DocumentModel,
    urls: Record<string, string> = {},
  ) {
    for (const spread of document.spreads)
      for (const layer of spread.layers)
        if (
          layer.type === "image" &&
          typeof layer.assetId === "string" &&
          !urls[layer.assetId]
        ) {
          const token = await runtime.api.post<Schema<"DownloadToken">>(
            `/assets/${encodeURIComponent(layer.assetId)}/download-token?variant=preview`,
            undefined,
          );
          urls[layer.assetId] = token.url;
        }
    return buildMiniPreview(document, urls);
  }
  const page = {
    data: {
      state,
      templates: [],
      folders: [],
      folderOptions: ["全部照片"],
      candidates: [],
      preview: null,
      slots: [],
      busy: false,
      message: state.message,
      folderName: "全部照片",
      newFolderName: "",
      themeIndex: 0,
      spreadCount: 10,
      projectName: name,
      layoutAvailable: false,
      exportAvailable: false,
    },
    sync() {
      if (active)
        this.setData({
          state,
          busy,
          message: state.message,
          spreadCount: state.spreadCount,
          slots: state.document
            ? editableMiniSlots(state.document, templates, state.pendingPatches)
            : [],
        });
    },
    async run(work: () => Promise<void>) {
      if (busy) return;
      busy = true;
      this.sync();
      try {
        await work();
      } catch (error) {
        state.message =
          error instanceof Error ? error.message : "操作失败，请重试";
      } finally {
        busy = false;
        this.sync();
      }
    },
    async onLoad(options: { projectId?: string }) {
      active = true;
      await this.run(async () => {
        runtime = await resolveRuntime();
        this.setData({
          layoutAvailable: runtime.capabilities.layout,
          exportAvailable: runtime.capabilities.export,
        });
        if (options.projectId) state = await loadMiniAlbum(options.projectId);
        await this.refreshFolders();
        try {
          let cursor: string | null = null;
          const seen = new Set<string>();
          do {
            const result: Schema<"ListTemplatesResponse">["data"] =
              await runtime.api.get(
                `/templates?workspaceId=${encodeURIComponent(runtime.api.workspaceId)}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
              );
            templates.push(...result.items.filter((t) => t.allowed));
            cursor = result.hasMore ? result.nextCursor : null;
            if (cursor && seen.has(cursor)) throw new Error("模板分页异常");
            if (cursor) seen.add(cursor);
          } while (cursor);
          this.setData({ templates });
        } catch {
          state.message = "模板服务未配置；已保存的相册仍可查看";
        }
      });
    },
    onUnload() {
      active = false;
    },
    async refreshFolders() {
      const result = await listMiniFolders(null);
      folders = result.items;
      this.setData({
        folders,
        folderOptions: ["全部照片", ...folders.map((f) => f.name)],
      });
    },
    async select() {
      await this.run(async () => {
        if (!runtime) runtime = await resolveRuntime();
        selectPhotos(
          state,
          await chooseWxPhotos(runtime.wx, 500 - state.photos.length),
        );
        state.message = "照片已选择，点击上传；失败的照片可单独重试";
      });
    },
    async upload() {
      await this.run(async () => {
        await uploadPhotos(state, runtime.api, (ticket, photo) =>
          transferWxPhoto(runtime.wx, ticket, photo),
        );
        state.message =
          state.phase === "layout"
            ? "照片已上传，选择主题和页数即可成册"
            : "部分照片未完成，请点击重试上传";
      });
    },
    changeName(event: Event) {
      name = event.detail.value;
    },
    changeSpreadCount(event: Event) {
      const value = Number(event.detail.value);
      if (Number.isInteger(value) && value >= 1 && value <= 50) {
        state.spreadCount = value;
        this.sync();
      }
    },
    chooseTheme(event: Event) {
      themeIndex = Number(event.detail.value);
      this.setData({ themeIndex });
    },
    chooseFolder(event: Event) {
      const index = Number(event.detail.value) - 1;
      state.folderId = folders[index]?.id ?? null;
      this.setData({ folderName: folders[index]?.name ?? "全部照片" });
    },
    folderInput(event: Event) {
      this.setData({ newFolderName: event.detail.value });
    },
    async newFolder() {
      await this.run(async () => {
        const value = (this.data as { newFolderName: string }).newFolderName;
        const folder = await createMiniFolder(value, state.folderId);
        state.folderId = folder.id;
        await this.refreshFolders();
        this.setData({ folderName: folder.name, newFolderName: "" });
      });
    },
    async layout() {
      await this.run(async () => {
        if (!runtime.capabilities.layout) throw new Error("自动排版任务未配置");
        if (
          state.photos.some((p) => p.status !== "ready") ||
          !state.photos.length
        )
          throw new Error("请先完成照片上传");
        const theme = templates[themeIndex];
        if (!theme) throw new Error("请先选择已授权主题");
        const required = theme.slots.filter(
          (s) => s.kind === "image" && s.bindingRequired,
        );
        if (required.length > state.photos.length)
          throw new Error("所选主题需要更多照片，请继续选片");
        if (!state.projectId)
          state = await createMiniProject(state, {
            name,
            mode: "quick_album",
            scene: theme.scene,
            pageWidthMm: 210,
            pageHeightMm: 210,
            spreadCount: state.spreadCount,
            templateVersionId: theme.versionId,
            templateBindings: required.map((slot, i) => ({
              slotId: slot.slotId,
              assetId: state.photos[i].assetId!,
            })),
          });
        const templateRef = state.document?.spreads.find(
          (s) => s.templateRef,
        )?.templateRef;
        if (!templateRef)
          throw new Error("主题缺少经过验证的排版引用，请在网页继续");
        const job = await requestMiniLayout(state, {
          layoutSpec: {
            projectId: state.projectId!,
            baseRevision: state.revision!,
            photos: state.photos.map((p) => ({
              assetId: p.assetId!,
              width: p.width!,
              height: p.height!,
            })),
            constraints: {
              spreadCount: state.spreadCount,
              minPhotosPerSpread: 0,
              maxPhotosPerSpread: 100,
              selectionPolicy: "all",
              duplicatePolicy: "forbid",
              orderPolicy: "user",
            },
            templateRef,
            algorithmVersion: runtime.algorithmVersion,
            seed: 0,
          },
        });
        jobId = job.id;
        state.message = "排版任务已提交，请刷新查看候选";
        state.phase = "layout";
      });
    },
    async refreshCandidates() {
      await this.run(async () => {
        if (!jobId) throw new Error("请先提交排版任务");
        const result = await listMiniCandidates(jobId);
        candidates = result.items;
        this.setData({
          candidates: await Promise.all(
            candidates.map(async (c) => ({
              id: c.id,
              score: c.score,
              checks: c.constraintChecks,
              preview: await previewDocument(c.document as DocumentModel),
            })),
          ),
        });
        state.message = candidates.length
          ? "对比候选后，选择喜欢的一版"
          : "候选尚未就绪，请稍后刷新";
      });
    },
    async applyCandidate(event: Event) {
      await this.run(async () => {
        const candidate = candidates.find(
          (c) => c.id === event.currentTarget.dataset.id,
        );
        if (!candidate) throw new Error("候选不存在");
        state = await applyMiniLayout(state, candidate);
        state.message = "排版已应用，可以轻编辑";
      });
    },
    editText(event: Event) {
      const slot = (
        state.document
          ? editableMiniSlots(state.document, templates, state.pendingPatches)
          : []
      )[Number(event.currentTarget.dataset.index)];
      if (slot?.canText) {
        queueMiniPatch(state, {
          type: "setText",
          spreadId: slot.spreadId,
          layerId: slot.layerId,
          text: event.detail.value,
        });
        this.sync();
      }
    },
    editCrop(event: Event) {
      const slot = (
        state.document
          ? editableMiniSlots(state.document, templates, state.pendingPatches)
          : []
      )[Number(event.currentTarget.dataset.index)];
      if (!slot?.canCrop) return;
      try {
        const field = event.currentTarget.dataset.field;
        if (!["x", "y", "width", "height"].includes(field ?? "")) return;
        const previous = [...state.pendingPatches]
          .reverse()
          .find(
            (p) =>
              p.type === "setCrop" &&
              p.spreadId === slot.spreadId &&
              p.layerId === slot.layerId,
          );
        const crop = {
          ...(previous?.type === "setCrop" ? previous.crop : slot.crop),
          [field!]: Number(event.detail.value),
        };
        queueMiniPatch(state, {
          type: "setCrop",
          spreadId: slot.spreadId,
          layerId: slot.layerId,
          crop,
        });
        state.message = "裁剪已保留，等待保存";
      } catch (error) {
        state.message = error instanceof Error ? error.message : "裁剪无效";
      }
      this.sync();
    },
    async preview() {
      await this.run(async () => {
        if (!state.document) throw new Error("请先打开或创建相册");
        this.setData({ preview: await previewDocument(state.document) });
        state.phase = "preview";
        state.message = state.pendingPatches.length
          ? "这是云端已保存版本；请先保存修改以更新预览"
          : "简要预览；完整效果可在电脑网页查看";
      });
    },
    async refreshAlbum() {
      await this.run(async () => {
        if (state.projectId) state = await loadMiniAlbum(state.projectId);
      });
    },
    backToEdit() {
      state.phase = "edit";
      this.sync();
    },
    async save() {
      await this.run(async () => {
        await submitMiniEdits(state, runtime.api.key());
      });
    },
    copyDraft() {
      runtime.wx.setClipboardData({ data: copyRecovery(state) });
    },
    async reload() {
      await this.run(async () => {
        state = await reloadMiniAlbum(state);
      });
    },
    async tasks() {
      await this.run(async () => {
        runtime ??= await resolveRuntime();
        runtime.wx.navigateTo({ url: "/pages/tasks/index" });
      });
    },
    exportAlbum() {
      state.message = "导出任务未配置，可在电脑网页继续编辑";
      this.sync();
    },
  } satisfies ThisType<PageHost>;
  return page;
}
