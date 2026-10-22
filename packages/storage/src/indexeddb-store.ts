import { openDB, type IDBPDatabase, type IDBPTransaction } from "idb";
import {
  parseDocument,
  canonicalDocument,
  canonicalJson,
  hashDocument,
  sha256,
  type DocumentModel,
} from "@album/document";
import type {
  AssetRecord,
  AssetBytes,
  FontRecord,
  ResourceManifest,
  ResourcePort,
  ResourceWriter,
  ResourceVariant,
} from "@album/assets";
import { fontRecordHash } from "@album/assets";
export interface SavedRevision {
  doc: DocumentModel;
  docHash: string;
  resources: ResourceManifest;
  savedAt: string;
}
export type SaveResult =
  | { ok: true; value: SavedRevision }
  | {
      ok: false;
      code: "REVISION_CONFLICT" | "STORAGE_FULL" | "STORAGE_FAILED";
      recoveryDraft: DocumentModel;
    };
export interface RevisionStore {
  load(projectId: string, revision?: number): Promise<SavedRevision>;
  save(
    doc: DocumentModel,
    expectedRevision: number,
    resources: ResourceManifest,
  ): Promise<SaveResult>;
}
export class StorageError extends Error {
  constructor(
    readonly code: string,
    message = code,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
export const emptyResources: ResourceManifest = { assets: [], fonts: [] };
const names = [
  "projects",
  "revisions",
  "assets",
  "fonts",
  "blobs",
  "links",
  "pins",
];
type Tx = IDBPTransaction<unknown, string[], "readwrite">;
interface Entry {
  id: string;
  variant: ResourceVariant;
  hash: string;
  bytes: Uint8Array;
}
const hash = /^[0-9a-f]{64}$/,
  id = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
export function assertManifest(m: ResourceManifest): void {
  if (
    !m ||
    !Array.isArray(m.assets) ||
    !Array.isArray(m.fonts) ||
    m.assets.length > 2500 ||
    m.fonts.length > 20
  )
    throw new StorageError("INVALID_RESOURCE_MANIFEST");
  const photos = m.assets.filter(
    (a) => a.usage === undefined || a.usage === "photo",
  ).length;
  if (photos > 500 || m.assets.length - photos > 2000)
    throw new StorageError("INVALID_RESOURCE_MANIFEST");
  const seen = new Set<string>();
  const unique = (key: string) => {
    if (!id.test(key) || seen.has(key))
      throw new StorageError("INVALID_RESOURCE_ID");
    seen.add(key);
  };
  for (const r of [...m.assets, ...m.fonts]) {
    unique(r.id);
    if (
      !hash.test(r.sha256) ||
      !Number.isSafeInteger(r.version) ||
      r.version < 1 ||
      !["ready", "missing", "unlicensed"].includes(r.status) ||
      typeof r.license?.usable !== "boolean" ||
      typeof r.license.id !== "string" ||
      typeof r.source?.name !== "string"
    )
      throw new StorageError("INVALID_RESOURCE_RECORD");
  }
  for (const a of m.assets) {
    if (
      a.usage !== undefined &&
      !["photo", "decoration", "mask", "text-raster"].includes(a.usage)
    )
      throw new StorageError("INVALID_RESOURCE_USAGE");
    if (
      !Number.isSafeInteger(a.width) ||
      !Number.isSafeInteger(a.height) ||
      a.width <= 0 ||
      a.height <= 0 ||
      a.width * a.height > 80_000_000 ||
      !["image/jpeg", "image/png"].includes(a.mimeType)
    )
      throw new StorageError("INVALID_RESOURCE_DIMENSIONS");
    for (const kind of ["original", "normalized", "preview"] as const) {
      const v = a.variants?.[kind];
      if (
        !v ||
        !hash.test(v.sha256) ||
        !Number.isSafeInteger(v.byteLength) ||
        v.byteLength < 1 ||
        !["image/png", "image/jpeg"].includes(v.mimeType) ||
        !Number.isSafeInteger(v.width) ||
        !Number.isSafeInteger(v.height) ||
        v.width < 1 ||
        v.height < 1 ||
        v.width * v.height > 80_000_000
      )
        throw new StorageError("INVALID_RESOURCE_VARIANT");
    }
    if (
      a.variants.original.sha256 !== a.sha256 ||
      a.variants.original.byteLength > 25_000_000
    )
      throw new StorageError("INVALID_ORIGINAL");
  }
  for (const f of m.fonts) {
    if (!Array.isArray(f.faces) || !f.faces.length || f.faces.length > 2048)
      throw new StorageError("INVALID_FONT_RECORD");
    for (const face of f.faces) {
      unique(face.id);
      if (
        !hash.test(face.sha256) ||
        !Number.isSafeInteger(face.byteLength) ||
        face.byteLength < 1 ||
        face.byteLength > 25_000_000 ||
        ![400, 700].includes(face.weight) ||
        face.style !== "normal" ||
        typeof face.file !== "string" ||
        !Array.isArray(face.codePoints) ||
        face.codePoints.length > 100_000 ||
        face.codePoints.some(
          (cp: number) => !Number.isInteger(cp) || cp < 0 || cp > 0x10ffff,
        )
      )
        throw new StorageError("INVALID_FONT_FACE");
    }
  }
}
async function makeRevision(
  doc: DocumentModel,
  resources: ResourceManifest,
): Promise<SavedRevision> {
  const capturedResources = structuredClone(resources);
  assertManifest(capturedResources);
  const normalized = parseDocument(JSON.parse(canonicalDocument(doc)));
  return {
    doc: normalized,
    docHash: await hashDocument(normalized),
    resources: capturedResources,
    savedAt: new Date().toISOString(),
  };
}
/** Display filenames can differ per project; content, version, rights and provenance cannot. */
function sameAssetIdentity(a: AssetRecord, b: AssetRecord): boolean {
  const withoutDisplayName = (r: AssetRecord) => ({
    ...r,
    source: { ...r.source, name: "" },
  });
  return (
    canonicalJson(withoutDisplayName(a)) ===
    canonicalJson(withoutDisplayName(b))
  );
}
export class IndexedDbRevisionStore
  implements RevisionStore, ResourcePort, ResourceWriter
{
  private db: Promise<IDBPDatabase>;
  constructor(readonly dbName: string) {
    if (typeof indexedDB === "undefined")
      throw new StorageError(
        "INDEXEDDB_UNAVAILABLE",
        "本地存储不可用，请换用支持 IndexedDB 的浏览器并保留项目包。",
      );
    this.db = openDB(dbName, 1, {
      upgrade(db) {
        for (const name of names) db.createObjectStore(name);
      },
    });
  }
  private async transaction<T>(
    stores: string[],
    action: (tx: Tx) => Promise<T>,
  ): Promise<T> {
    const tx = (await this.db).transaction(stores, "readwrite");
    try {
      const value = await action(tx);
      await tx.done;
      return value;
    } catch (error) {
      try {
        tx.abort();
      } catch {}
      await tx.done.catch(() => {});
      throw error;
    }
  }
  async create(
    doc: DocumentModel,
    resources: ResourceManifest,
  ): Promise<SavedRevision> {
    const value = await makeRevision({ ...doc, revision: 1 }, resources);
    return this.transaction(["projects", "revisions"], async (tx) => {
      if (await tx.objectStore("projects").get(value.doc.projectId))
        throw new StorageError("PROJECT_EXISTS");
      await tx.objectStore("revisions").put(value, `${value.doc.projectId}:1`);
      await tx.objectStore("projects").put(
        {
          projectId: value.doc.projectId,
          revision: 1,
          savedAt: value.savedAt,
        },
        value.doc.projectId,
      );
      return value;
    });
  }
  async load(projectId: string, revision?: number): Promise<SavedRevision> {
    const db = await this.db,
      tx = db.transaction(["projects", "revisions"], "readonly");
    const current = await tx.objectStore("projects").get(projectId);
    if (!current) throw new StorageError("PROJECT_NOT_FOUND");
    const value = (await tx
      .objectStore("revisions")
      .get(`${projectId}:${revision ?? current.revision}`)) as
      SavedRevision | undefined;
    await tx.done;
    if (!value) throw new StorageError("REVISION_NOT_FOUND");
    if ((await hashDocument(value.doc)) !== value.docHash)
      throw new StorageError("STORAGE_CORRUPT");
    return value;
  }
  async listProjects(): Promise<
    { projectId: string; revision: number; savedAt: string }[]
  > {
    return (await (await this.db).getAll("projects")).sort((a, b) =>
      b.savedAt.localeCompare(a.savedAt),
    );
  }
  async save(
    doc: DocumentModel,
    expectedRevision: number,
    resources: ResourceManifest,
  ): Promise<SaveResult> {
    const recoveryDraft = parseDocument(doc);
    if (
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 1 ||
      expectedRevision >= Number.MAX_SAFE_INTEGER
    )
      throw new StorageError("INVALID_REVISION");
    const value = await makeRevision(
      { ...doc, revision: expectedRevision + 1 },
      resources,
    );
    try {
      return await this.transaction(
        ["projects", "revisions", "pins"],
        async (tx) => {
          const current = await tx
            .objectStore("projects")
            .get(value.doc.projectId);
          if (!current || current.revision !== expectedRevision)
            return {
              ok: false,
              code: "REVISION_CONFLICT",
              recoveryDraft,
            } as const;
          await tx
            .objectStore("revisions")
            .put(value, `${value.doc.projectId}:${value.doc.revision}`);
          await tx.objectStore("projects").put(
            {
              projectId: value.doc.projectId,
              revision: value.doc.revision,
              savedAt: value.savedAt,
            },
            value.doc.projectId,
          );
          const pins = (await tx.objectStore("pins").getAll()).map((p) =>
            canonicalJson(p),
          );
          for (const key of await tx.objectStore("revisions").getAllKeys()) {
            if (
              typeof key !== "string" ||
              !key.startsWith(value.doc.projectId + ":")
            )
              continue;
            const old = (await tx
              .objectStore("revisions")
              .get(key)) as SavedRevision;
            if (
              old.doc.revision <= value.doc.revision - 20 &&
              !pins.includes(canonicalJson(old.resources))
            )
              await tx.objectStore("revisions").delete(key);
          }
          return { ok: true, value } as const;
        },
      );
    } catch (error) {
      return {
        ok: false,
        code:
          error instanceof DOMException && error.name === "QuotaExceededError"
            ? "STORAGE_FULL"
            : "STORAGE_FAILED",
        recoveryDraft,
      };
    }
  }
  async read(
    resourceId: string,
    variant: ResourceVariant,
  ): Promise<Uint8Array> {
    const tx = (await this.db).transaction(["links", "blobs"], "readonly"),
      h = await tx.objectStore("links").get(`${resourceId}:${variant}`);
    if (!h)
      throw new StorageError(
        "RESOURCE_MISSING",
        `${resourceId}/${variant} 不存在，不能用预览代替原图。`,
      );
    const bytes = (await tx.objectStore("blobs").get(h)) as
      Uint8Array | undefined;
    await tx.done;
    if (!bytes) throw new StorageError("RESOURCE_MISSING");
    if ((await sha256(bytes)) !== h) throw new StorageError("HASH_MISMATCH");
    return new Uint8Array(bytes);
  }
  private async verify(entries: Entry[]): Promise<void> {
    for (const e of entries)
      if (
        !(e.bytes instanceof Uint8Array) ||
        (await sha256(e.bytes)) !== e.hash
      )
        throw new StorageError("HASH_MISMATCH");
  }
  private async writeEntries(tx: Tx, entries: Entry[]): Promise<void> {
    for (const e of entries) {
      const key = `${e.id}:${e.variant}`,
        old = await tx.objectStore("links").get(key);
      if (old && old !== e.hash) throw new StorageError("IMMUTABLE_RESOURCE");
      await tx.objectStore("blobs").put(new Uint8Array(e.bytes), e.hash);
      await tx.objectStore("links").put(e.hash, key);
    }
  }
  async putAsset(record: AssetRecord, data: AssetBytes): Promise<void> {
    record = structuredClone(record);
    assertManifest({ assets: [record], fonts: [] });
    const entries: Entry[] = (
      ["original", "normalized", "preview"] as const
    ).map((variant) => {
      const bytes =
          data[variant] instanceof Uint8Array
            ? new Uint8Array(data[variant])
            : undefined,
        v = record.variants[variant];
      if (!bytes || bytes.length !== v.byteLength)
        throw new StorageError("SIZE_MISMATCH");
      return { id: record.id, variant, hash: v.sha256, bytes };
    });
    await this.verify(entries);
    await this.transaction(["assets", "links", "blobs"], async (tx) => {
      const old = await tx.objectStore("assets").get(record.id);
      if (old && !sameAssetIdentity(old, record))
        throw new StorageError("IMMUTABLE_RESOURCE");
      await this.writeEntries(tx, entries);
      if (!old) await tx.objectStore("assets").put(record, record.id);
    });
  }
  async putFont(
    record: FontRecord,
    files: ReadonlyMap<string, Uint8Array>,
  ): Promise<void> {
    record = structuredClone(record);
    const capturedFiles = new Map<string, Uint8Array>();
    for (const face of record.faces) {
      const bytes = files.get(face.id);
      if (bytes) capturedFiles.set(face.id, new Uint8Array(bytes));
    }
    files = capturedFiles;
    assertManifest({ assets: [], fonts: [record] });
    if ((await fontRecordHash(record)) !== record.sha256)
      throw new StorageError("HASH_MISMATCH");
    const entries: Entry[] = record.faces.map((f) => {
      const bytes = files.get(f.id);
      if (!bytes || bytes.length !== f.byteLength)
        throw new StorageError("RESOURCE_MISSING");
      return { id: f.id, variant: "font", hash: f.sha256, bytes };
    });
    await this.verify(entries);
    await this.transaction(["fonts", "links", "blobs"], async (tx) => {
      const old = await tx.objectStore("fonts").get(record.id);
      if (old && canonicalJson(old) !== canonicalJson(record))
        throw new StorageError("IMMUTABLE_RESOURCE");
      await this.writeEntries(tx, entries);
      await tx.objectStore("fonts").put(record, record.id);
    });
  }
  async pinResources(
    ownerId: string,
    resources: ResourceManifest,
  ): Promise<void> {
    const captured = structuredClone(resources);
    assertManifest(captured);
    await (await this.db).put("pins", captured, ownerId);
  }
  async releaseResources(ownerId: string): Promise<void> {
    await (await this.db).delete("pins", ownerId);
  }
  async importVerified(
    doc: DocumentModel,
    resources: ResourceManifest,
    blobs: ReadonlyMap<string, Uint8Array>,
  ): Promise<SavedRevision> {
    doc = parseDocument(doc);
    resources = structuredClone(resources);
    assertManifest(resources);
    blobs = new Map(
      [...blobs].map(([hash, bytes]) => [hash, new Uint8Array(bytes)]),
    );
    const value = await makeRevision({ ...doc, revision: 1 }, resources),
      entries: Entry[] = [];
    for (const a of resources.assets)
      for (const variant of ["original", "normalized", "preview"] as const) {
        const v = a.variants[variant],
          bytes = blobs.get(v.sha256);
        if (!bytes || bytes.length !== v.byteLength)
          throw new StorageError("RESOURCE_MISSING");
        entries.push({ id: a.id, variant, hash: v.sha256, bytes });
      }
    for (const f of resources.fonts)
      if ((await fontRecordHash(f)) !== f.sha256)
        throw new StorageError("HASH_MISMATCH");
    for (const f of resources.fonts)
      for (const face of f.faces) {
        const bytes = blobs.get(face.sha256);
        if (!bytes || bytes.length !== face.byteLength)
          throw new StorageError("RESOURCE_MISSING");
        entries.push({
          id: face.id,
          variant: "font",
          hash: face.sha256,
          bytes,
        });
      }
    await this.verify(entries);
    return this.transaction(
      ["projects", "revisions", "assets", "fonts", "blobs", "links"],
      async (tx) => {
        if (await tx.objectStore("projects").get(value.doc.projectId))
          throw new StorageError("PROJECT_EXISTS");
        for (const [name, records] of [
          ["assets", resources.assets],
          ["fonts", resources.fonts],
        ] as const)
          for (const record of records) {
            const old = await tx.objectStore(name).get(record.id);
            if (
              old &&
              !(name === "assets"
                ? sameAssetIdentity(old, record as AssetRecord)
                : canonicalJson(old) === canonicalJson(record))
            )
              throw new StorageError("IMMUTABLE_RESOURCE");
            if (!old) await tx.objectStore(name).put(record, record.id);
          }
        await this.writeEntries(tx, entries);
        await tx
          .objectStore("revisions")
          .put(value, `${value.doc.projectId}:1`);
        await tx.objectStore("projects").put(
          {
            projectId: value.doc.projectId,
            revision: 1,
            savedAt: value.savedAt,
          },
          value.doc.projectId,
        );
        return value;
      },
    );
  }
  async close(): Promise<void> {
    (await this.db).close();
  }
}
