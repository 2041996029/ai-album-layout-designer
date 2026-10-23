import type { DocumentModel } from "../../../packages/document/src/model";
import { ApiError, MiniApi, type Schema } from "./api";
export type MiniPatch = Exclude<
  Schema<"DocumentCommand">,
  { type: "replaceDocument" }
>;
export interface RecoveryStore {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  remove(key: string): void;
}
export interface Photo {
  path: string;
  filename: string;
  sizeBytes: number;
  declaredMime: "image/jpeg" | "image/png";
  sha256: string;
  status?: "pending" | "uploading" | "failed" | "ready";
  assetId?: string;
  error?: string;
  ticket?: Schema<"UploadTicket">;
  uploadKey?: string;
  completeKey?: string;
  objectUploaded?: boolean;
  completed?: boolean;
  width?: number;
  height?: number;
}
export interface MiniAlbumState {
  projectId: string | null;
  revision: number | null;
  phase: "select" | "upload" | "layout" | "edit" | "preview";
  pendingPatches: MiniPatch[];
  recoverable: boolean;
  conflict: boolean;
  message: string;
  photos: Photo[];
  selectedPhotoCount: number;
  spreadCount: number;
  document?: DocumentModel;
  folderId: string | null;
}
let api: MiniApi;
let recovery: RecoveryStore;
type Context = { api: MiniApi; recovery: RecoveryStore };
const contexts = new WeakMap<MiniAlbumState, Context>();
const saves = new WeakMap<MiniAlbumState, Promise<MiniAlbumState>>();
const frozenPrefixes = new WeakMap<MiniAlbumState, number>();
function contextFor(state: MiniAlbumState) {
  let context = contexts.get(state);
  if (!context) {
    context = { api, recovery };
    contexts.set(state, context);
  }
  return context;
}

export function configureMiniAlbum(client: MiniApi, store: RecoveryStore) {
  api = client;
  recovery = store;
}
export function createMiniAlbum(): MiniAlbumState {
  return {
    projectId: null,
    revision: null,
    phase: "select",
    pendingPatches: [],
    recoverable: false,
    conflict: false,
    message: "选择照片，开始成册",
    photos: [],
    selectedPhotoCount: 0,
    spreadCount: 10,
    folderId: null,
  };
}
const recoveryKey = (id: string, workspaceId = api.workspaceId) =>
  `mini:${workspaceId}:${id}`;
function persist(state: MiniAlbumState) {
  const context = contextFor(state);
  if (state.projectId)
    context.recovery.set(
      recoveryKey(state.projectId, context.api.workspaceId),
      { revision: state.revision, pendingPatches: state.pendingPatches },
    );
}
export function selectPhotos(
  state: MiniAlbumState,
  photos: Photo[],
): MiniAlbumState {
  if (photos.length + state.photos.length > 500)
    throw new Error("最多选择500张照片");
  for (const photo of photos)
    if (
      photo.sizeBytes <= 0 ||
      photo.sizeBytes > 25_000_000 ||
      !/^([0-9a-f]{64})$/.test(photo.sha256)
    )
      throw new Error("照片大小或校验值不正确");
  state.photos.push(
    ...photos.map((p) => ({ ...p, status: "pending" as const })),
  );
  state.selectedPhotoCount = state.photos.length;
  state.phase = "upload";
  return state;
}
function whitelist(patch: MiniPatch): MiniPatch {
  switch (patch.type) {
    case "setText":
      if (patch.text.length > 20000) throw new Error("文字过长");
      return {
        type: patch.type,
        spreadId: patch.spreadId,
        layerId: patch.layerId,
        text: patch.text,
      };
    case "setCrop": {
      const { x, y, width, height } = patch.crop;
      if (
        ![x, y, width, height].every(Number.isFinite) ||
        x < 0 ||
        y < 0 ||
        width <= 0 ||
        height <= 0 ||
        x + width > 1 ||
        y + height > 1
      )
        throw new Error("裁剪区域无效");
      return {
        type: patch.type,
        spreadId: patch.spreadId,
        layerId: patch.layerId,
        crop: { x, y, width, height },
      };
    }
    case "replaceAsset":
      return {
        type: patch.type,
        spreadId: patch.spreadId,
        layerId: patch.layerId,
        assetId: patch.assetId,
      };
    case "reorderSpreads":
      return { type: patch.type, spreadIds: [...patch.spreadIds] };
    default:
      throw new Error("可在电脑网页继续编辑");
  }
}
export function queueMiniPatch(
  state: MiniAlbumState,
  patch: MiniPatch,
): MiniAlbumState {
  const clean = whitelist(patch),
    frozen = frozenPrefixes.get(state) ?? 0;
  const index = state.pendingPatches.findIndex(
    (previous, i) =>
      i >= frozen &&
      previous.type === clean.type &&
      (previous.type === "reorderSpreads" ||
        (clean.type !== "reorderSpreads" &&
          previous.spreadId === clean.spreadId &&
          previous.layerId === clean.layerId)),
  );
  if (index >= 0) state.pendingPatches[index] = clean;
  else {
    if (state.pendingPatches.length >= 100)
      throw new Error("修改较多，请先保存后继续编辑");
    state.pendingPatches.push(clean);
  }
  state.recoverable = true;
  persist(state);
  return state;
}
export async function loadMiniAlbum(
  projectId: string,
): Promise<MiniAlbumState> {
  const context = { api, recovery };
  return loadFromContext(projectId, context);
}
async function loadFromContext(
  projectId: string,
  context: Context,
): Promise<MiniAlbumState> {
  let remote: Schema<"ProjectDocument">;
  try {
    remote = await context.api.get<Schema<"ProjectDocument">>(
      `/projects/${encodeURIComponent(projectId)}`,
    );
  } catch (error) {
    if (error instanceof ApiError && error.status < 500) throw error;
    const local = context.recovery.get(
      recoveryKey(projectId, context.api.workspaceId),
    ) as { revision?: number; pendingPatches?: MiniPatch[] } | undefined;
    if (!local?.pendingPatches?.length || !Number.isSafeInteger(local.revision))
      throw error;
    const offline: MiniAlbumState = {
      ...createMiniAlbum(),
      projectId,
      revision: local.revision!,
      pendingPatches: local.pendingPatches.map(whitelist),
      recoverable: true,
      phase: "edit",
      message: "当前离线，本地草稿已恢复；联网后请重新载入云端版本",
    };
    contexts.set(offline, context);
    return offline;
  }
  const state = {
    ...createMiniAlbum(),
    projectId,
    revision: remote.project.revision,
    document: remote.document as DocumentModel,
    phase: "edit" as const,
  };
  contexts.set(state, context);
  const local = context.recovery.get(
    recoveryKey(projectId, context.api.workspaceId),
  ) as { revision?: number; pendingPatches?: MiniPatch[] } | undefined;
  if (local?.pendingPatches?.length && Number.isSafeInteger(local.revision)) {
    state.pendingPatches = local.pendingPatches.map(whitelist);
    state.revision = local.revision!;
    state.recoverable = true;
    state.conflict = state.revision !== remote.project.revision;
    state.message = state.conflict
      ? "该版本已由其他设备修改，本地草稿已保留。请复制恢复或重新加载。"
      : "本地草稿已恢复，等待保存";
  }
  return state;
}
export function submitMiniEdits(
  state: MiniAlbumState,
  key: string,
): Promise<MiniAlbumState> {
  const pending = saves.get(state);
  if (pending) return pending;
  const save = performSubmitMiniEdits(state, key).finally(() => {
    saves.delete(state);
    frozenPrefixes.delete(state);
  });
  saves.set(state, save);
  return save;
}
async function performSubmitMiniEdits(
  state: MiniAlbumState,
  key: string,
): Promise<MiniAlbumState> {
  if (
    !state.projectId ||
    state.revision === null ||
    !state.pendingPatches.length
  )
    return state;
  if (state.conflict) {
    state.message =
      "该版本已由其他设备修改，本地草稿已保留。请复制恢复或重新加载。";
    return state;
  }
  const batch = state.pendingPatches.map(whitelist);
  const count = batch.length;
  frozenPrefixes.set(state, count);
  const revision = state.revision;
  persist(state);
  try {
    const result = await contextFor(state).api.request<
      Schema<"ProjectDocument">
    >(
      "PATCH",
      `/projects/${encodeURIComponent(state.projectId)}`,
      {
        commandId: key,
        commands: batch,
        clientPlatform: "mini",
      } satisfies Schema<"ProjectPatch">,
      { "If-Match": `"${revision}"`, "Idempotency-Key": key },
    );
    state.pendingPatches.splice(0, count);
    state.revision = result.project.revision;
    state.document = result.document as DocumentModel;
    state.recoverable = state.pendingPatches.length > 0;
    state.message = state.recoverable ? "仍有未保存修改" : "已保存到云端";
    persist(state);
  } catch (error) {
    state.recoverable = true;
    state.conflict = error instanceof ApiError && error.status === 409;
    state.message = state.conflict
      ? "该版本已由其他设备修改，本地草稿已保留。请复制恢复或重新加载。"
      : "云端保存失败，本地草稿已保留";
    persist(state);
  }
  return state;
}
export function copyRecovery(state: MiniAlbumState): string {
  return JSON.stringify({
    projectId: state.projectId,
    revision: state.revision,
    pendingPatches: state.pendingPatches.map(whitelist),
  });
}
export async function reloadMiniAlbum(
  state: MiniAlbumState,
): Promise<MiniAlbumState> {
  if (!state.projectId) return state;
  const context = contextFor(state);
  context.recovery.remove(
    recoveryKey(state.projectId, context.api.workspaceId),
  );
  return loadFromContext(state.projectId, context);
}
export type UploadTransfer = (
  ticket: Schema<"UploadTicket">,
  photo: Photo,
) => Promise<void>;
export async function uploadPhotos(
  state: MiniAlbumState,
  client: MiniApi,
  transfer: UploadTransfer,
): Promise<MiniAlbumState> {
  for (const photo of state.photos) {
    if (photo.status === "ready") continue;
    photo.status = "uploading";
    photo.error = undefined;
    try {
      photo.uploadKey ??= client.key();
      photo.completeKey ??= client.key();
      if (
        photo.ticket &&
        !photo.completed &&
        Date.parse(photo.ticket.expiresAt) <= Date.now()
      ) {
        // The server expires incomplete sessions even when their bytes reached storage.
        // Reset both operations so retained photo bytes can start a fresh session.
        photo.ticket = undefined;
        photo.uploadKey = client.key();
        photo.completeKey = client.key();
        photo.objectUploaded = false;
        photo.completed = false;
        photo.assetId = undefined;
        photo.width = undefined;
        photo.height = undefined;
      }
      if (!photo.ticket) {
        photo.ticket = await client.post<Schema<"UploadTicket">>(
          `/workspaces/${encodeURIComponent(client.workspaceId)}/uploads`,
          {
            filename: photo.filename,
            sizeBytes: photo.sizeBytes,
            declaredMime: photo.declaredMime,
            sha256: photo.sha256,
            folderId: state.folderId,
          } satisfies Schema<"UploadCreate">,
          photo.uploadKey,
        );
      }
      if (!photo.objectUploaded) {
        await transfer(photo.ticket, photo);
        photo.objectUploaded = true;
      }
      const asset = photo.completed
        ? await client.get<Schema<"Asset">>(
            `/assets/${encodeURIComponent(photo.ticket.assetId)}`,
          )
        : await client.post<Schema<"Asset">>(
            `/assets/${encodeURIComponent(photo.ticket.assetId)}/complete`,
            {
              uploadId: photo.ticket.uploadId,
              sha256: photo.sha256,
              sizeBytes: photo.sizeBytes,
            } satisfies Schema<"UploadComplete">,
            photo.completeKey,
          );
      photo.completed = true;
      photo.assetId = asset.id;
      photo.width = asset.width;
      photo.height = asset.height;
      photo.status = asset.state === "ready" ? "ready" : "failed";
      if (photo.status !== "ready") photo.error = "素材验证尚未完成，请重试";
    } catch (error) {
      photo.status = "failed";
      photo.error = error instanceof Error ? error.message : "上传失败，请重试";
    }
  }
  state.phase =
    state.photos.length && state.photos.every((p) => p.status === "ready")
      ? "layout"
      : "upload";
  return state;
}
export async function createMiniProject(
  state: MiniAlbumState,
  input: Schema<"ProjectCreate">,
): Promise<MiniAlbumState> {
  const project = await api.post<Schema<"ProjectDocument">>(
    `/workspaces/${encodeURIComponent(api.workspaceId)}/projects`,
    input,
  );
  const loaded = await loadMiniAlbum(project.project.id);
  return {
    ...loaded,
    photos: state.photos,
    selectedPhotoCount: state.selectedPhotoCount,
    spreadCount: input.spreadCount,
    folderId: state.folderId,
    phase: "layout",
  };
}
export async function listMiniFolders(parentId: string | null) {
  return api.get<Schema<"ListFoldersResponse">["data"]>(
    `/workspaces/${encodeURIComponent(api.workspaceId)}/folders${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ""}`,
  );
}
export async function createMiniFolder(name: string, parentId: string | null) {
  return api.post<Schema<"Folder">>(
    `/workspaces/${encodeURIComponent(api.workspaceId)}/folders`,
    { name, parentId } satisfies Schema<"FolderCreate">,
  );
}
export async function requestMiniLayout(
  state: MiniAlbumState,
  input: Schema<"LayoutJobCreate">,
) {
  if (!state.projectId) throw new Error("请先创建相册");
  return api.post<Schema<"Job">>(
    `/projects/${encodeURIComponent(state.projectId)}/layout-jobs`,
    input,
  );
}
export async function listMiniCandidates(jobId: string) {
  return api.get<Schema<"ListLayoutCandidatesResponse">["data"]>(
    `/jobs/${encodeURIComponent(jobId)}/layout-candidates`,
  );
}
export async function applyMiniLayout(
  state: MiniAlbumState,
  candidate: Schema<"LayoutCandidate">,
) {
  if (
    !state.projectId ||
    state.revision === null ||
    state.pendingPatches.length
  )
    throw new Error("请先保存修改");
  await api.request(
    "POST",
    `/projects/${encodeURIComponent(state.projectId)}/apply-layout`,
    {
      candidateId: candidate.id,
      baseRevision: state.revision,
      commandId: api.key(),
    } satisfies Schema<"ApplyLayout">,
    { "If-Match": `"${state.revision}"`, "Idempotency-Key": api.key() },
  );
  return loadMiniAlbum(state.projectId);
}
