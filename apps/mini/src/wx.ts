import { ApiError, MiniApi, type Schema, type Transport } from "./api";
import { sha256 } from "./sha256";
import type { Photo, RecoveryStore } from "../pages/album/index";
type CallOptions<T> = {
  success: (result: T) => void;
  fail: (error: unknown) => void;
};
export interface WxApi {
  request(
    options: {
      url: string;
      method: string;
      header: Record<string, string>;
      data?: unknown;
    } & CallOptions<{ statusCode: number; data: unknown }>,
  ): void;
  uploadFile(
    options: {
      url: string;
      filePath: string;
      name: string;
      header: Record<string, string>;
      formData: Record<string, string>;
    } & CallOptions<{ statusCode: number; data: string }>,
  ): void;
  login(options: CallOptions<{ code: string }>): void;
  chooseMedia(
    options: {
      count: number;
      mediaType: string[];
      sizeType: string[];
    } & CallOptions<{
      tempFiles: Array<{ tempFilePath: string; size: number }>;
    }>,
  ): void;
  getFileSystemManager(): {
    readFile(
      options: { filePath: string } & CallOptions<{ data: ArrayBuffer }>,
    ): void;
  };
  getStorageSync(key: string): unknown;
  setStorageSync(key: string, value: unknown): void;
  removeStorageSync(key: string): void;
  setClipboardData(options: { data: string }): void;
  navigateTo(options: { url: string }): void;
  getRandomValues(
    options: { length: number } & CallOptions<{ randomValues: ArrayBuffer }>,
  ): void;
}
export const readPhotoBytes = (wx: WxApi, path: string) =>
  new Promise<ArrayBuffer>((resolve, reject) =>
    wx.getFileSystemManager().readFile({
      filePath: path,
      success: (r) => resolve(r.data),
      fail: reject,
    }),
  );
export function createWxTransport(wx: WxApi, baseUrl: string): Transport {
  if (!/^https:\/\/[^/]+(?:\/.*)?$/.test(baseUrl))
    throw new ApiError(503, "UNCONFIGURED", "请先配置安全的API地址");
  return (request) =>
    new Promise((resolve, reject) => {
      if (!request.path.startsWith("/") || request.path.startsWith("//")) {
        reject(new Error("无效的API路径"));
        return;
      }
      wx.request({
        url: baseUrl.replace(/\/$/, "") + request.path,
        method: request.method,
        header: { "Content-Type": "application/json", ...request.headers },
        data: request.body,
        success: (r) => resolve({ status: r.statusCode, body: r.data }),
        fail: () => reject(new Error("网络连接失败")),
      });
    });
}
export async function transferWxPhoto(
  wx: WxApi,
  ticket: Schema<"UploadTicket">,
  photo: Photo,
): Promise<void> {
  const header = Object.fromEntries(
    ticket.headers.map((h) => [h.name, h.value]),
  );
  // Storage sees only ticket headers; API bearer never leaves the API adapter.
  if (ticket.method === "POST") {
    await new Promise<void>((resolve, reject) =>
      wx.uploadFile({
        url: ticket.url,
        filePath: photo.path,
        name: "file",
        header,
        formData: Object.fromEntries(
          ticket.formFields.map((f) => [f.name, f.value]),
        ),
        success: (r) =>
          r.statusCode >= 200 && r.statusCode < 300
            ? resolve()
            : reject(new Error("照片上传失败")),
        fail: () => reject(new Error("照片上传失败")),
      }),
    );
  } else {
    const data = await readPhotoBytes(wx, photo.path);
    await new Promise<void>((resolve, reject) =>
      wx.request({
        url: ticket.url,
        method: "PUT",
        header,
        data,
        success: (r) =>
          r.statusCode >= 200 && r.statusCode < 300
            ? resolve()
            : reject(new Error("照片上传失败")),
        fail: () => reject(new Error("照片上传失败")),
      }),
    );
  }
}
export async function chooseWxPhotos(
  wx: WxApi,
  remaining: number,
): Promise<Photo[]> {
  const selected = await new Promise<{
    tempFiles: Array<{ tempFilePath: string; size: number }>;
  }>((resolve, reject) =>
    wx.chooseMedia({
      count: Math.min(20, remaining),
      mediaType: ["image"],
      sizeType: ["original"],
      success: resolve,
      fail: reject,
    }),
  );
  const photos: Photo[] = [];
  for (const file of selected.tempFiles) {
    if (file.size > 25_000_000) throw new Error("原片须小于25MB");
    const bytes = new Uint8Array(await readPhotoBytes(wx, file.tempFilePath));
    const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    const png =
      bytes[0] === 137 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71;
    if (!jpeg && !png) throw new Error("请选择JPEG或PNG原片");
    photos.push({
      path: file.tempFilePath,
      filename:
        file.tempFilePath.split("/").pop() ??
        (jpeg ? "photo.jpg" : "photo.png"),
      sizeBytes: bytes.length,
      declaredMime: jpeg ? "image/jpeg" : "image/png",
      sha256: sha256(bytes),
    });
  }
  return photos;
}
export function wxRecoveryStore(wx: WxApi): RecoveryStore {
  return {
    get: (k) => wx.getStorageSync(k),
    set: (k, v) => wx.setStorageSync(k, v),
    remove: (k) => wx.removeStorageSync(k),
  };
}
export async function createWxApi(
  wx: WxApi,
  baseUrl: string,
  workspaceId: string,
): Promise<MiniApi> {
  // A per-runtime random nonce plus monotonic counter prevents idempotency collisions across launches.
  let sequence = 0;
  let nonce: string | null = null;
  const initialize = new Promise<void>((resolve, reject) =>
    wx.getRandomValues({
      length: 16,
      success: (r) => {
        nonce = Array.from(new Uint8Array(r.randomValues), (n) =>
          n.toString(16).padStart(2, "0"),
        ).join("");
        resolve();
      },
      fail: reject,
    }),
  );
  await initialize;
  return new MiniApi({
    baseUrl,
    workspaceId,
    transport: createWxTransport(wx, baseUrl),
    key: () => {
      if (!nonce) throw new ApiError(503, "INITIALIZING", "请稍后重试");
      return `${nonce}-${++sequence}`;
    },
    loginCode: () =>
      new Promise((resolve, reject) =>
        wx.login({
          success: (r) => resolve(r.code),
          fail: () => reject(new Error("微信登录未就绪，请重试")),
        }),
      ),
  });
}
