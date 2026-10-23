import { IndexedDbRevisionStore, type SavedRevision } from "@album/storage";
import type { DocumentModel } from "@album/document";
import type { ResourceManifest, AssetRecord } from "@album/assets";
import { api, id, type DTO } from "./api";
const uploaded = new Map<string, AssetRecord>();
const local = new IndexedDbRevisionStore("album-local-v1");
export async function syncAssets(
  workspaceId: string,
  doc: DocumentModel,
  resources: ResourceManifest,
) {
  const records: AssetRecord[] = [],
    mapping = new Map<string, string>();
  for (const record of resources.assets) {
    const cacheKey = workspaceId + ":" + record.id + ":" + record.sha256;
    const cached = uploaded.get(cacheKey);
    if (cached) {
      records.push(cached);
      mapping.set(record.id, cached.id);
      continue;
    }
    try {
      const existing = await api<DTO<"Asset">>(`/assets/${id(record.id)}`);
      if (
        existing.workspaceId === workspaceId &&
        existing.state === "ready" &&
        existing.sha256 === record.sha256 &&
        existing.editorResource
      ) {
        const canonical = existing.editorResource as AssetRecord;
        uploaded.set(cacheKey, canonical);
        records.push(canonical);
        mapping.set(record.id, canonical.id);
        continue;
      }
    } catch {
      /* A local-only asset has no cloud identifier yet. */
    }
    const bytes = await local.read(record.id, "original");
    const ticket = await api<DTO<"UploadTicket">>(
      `/workspaces/${id(workspaceId)}/uploads`,
      "POST",
      {
        filename: record.source.name,
        sizeBytes: bytes.byteLength,
        declaredMime: record.variants.original.mimeType,
        sha256: record.sha256,
        folderId: null,
      },
    );
    let body: Uint8Array<ArrayBuffer> | FormData = new Uint8Array(bytes);
    if (ticket.method === "POST") {
      const form = new FormData();
      for (const h of ticket.formFields) form.append(h.name, h.value);
      form.append(
        "file",
        new Blob([new Uint8Array(bytes)], {
          type: record.variants.original.mimeType,
        }),
        record.source.name,
      );
      body = form;
    }
    const response = await fetch(ticket.url, {
      method: ticket.method,
      headers: Object.fromEntries(ticket.headers.map((h) => [h.name, h.value])),
      body,
      credentials: "omit",
    });
    if (!response.ok) throw Error("云素材上传失败");
    await api(`/assets/${id(ticket.assetId)}/complete`, "POST", {
      uploadId: ticket.uploadId,
      sha256: record.sha256,
      sizeBytes: bytes.byteLength,
    });
    const asset = await api<DTO<"Asset">>(`/assets/${id(ticket.assetId)}`);
    if (asset.state !== "ready" || !asset.editorResource)
      throw Error("云素材仍在校验，请稍后重试");
    records.push(asset.editorResource as AssetRecord);
    uploaded.set(cacheKey, asset.editorResource as AssetRecord);
    mapping.set(record.id, asset.id);
  }
  function map(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(map);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [
          key,
          key === "assetId" && typeof v === "string"
            ? (mapping.get(v) ?? v)
            : map(v),
        ]),
      );
    return value;
  }
  return {
    doc: map(doc) as DocumentModel,
    resources: {
      assets: records,
      fonts: resources.fonts,
    } satisfies ResourceManifest,
  };
}
export async function cacheCloudProject(saved: SavedRevision) {
  for (const font of saved.resources.fonts) {
    for (const face of font.faces) {
      const bytes = await local.read(face.id, "font");
      const hash = Array.from(
        new Uint8Array(
          await crypto.subtle.digest("SHA-256", new Uint8Array(bytes)),
        ),
        (b) => b.toString(16).padStart(2, "0"),
      ).join("");
      if (hash !== face.sha256) throw Error("此云相册字体版本尚未在本机提供");
    }
  }
  for (const asset of saved.resources.assets) {
    const variants = {} as Record<
      "original" | "normalized" | "preview",
      Uint8Array
    >;
    for (const variant of ["original", "normalized", "preview"] as const) {
      const token = await api<DTO<"DownloadToken">>(
        `/assets/${id(asset.id)}/download-token?variant=${variant}`,
        "POST",
      );
      const r = await fetch(token.url, { credentials: "omit" });
      if (!r.ok) throw Error("无法下载云素材，原本地项目仍保留");
      variants[variant] = new Uint8Array(await r.arrayBuffer());
    }
    await local.putAsset(asset, variants);
  }
  return local.create(
    {
      ...saved.doc,
      projectId: "prj_" + crypto.randomUUID().replaceAll("-", ""),
      revision: 1,
    },
    saved.resources,
  );
}
