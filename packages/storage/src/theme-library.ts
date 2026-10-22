import { openDB, type IDBPDatabase } from "idb";
import { sha256 } from "@album/document";
import { fontRecordHash } from "@album/assets";
import type { ConvertedTheme, ImportedTheme } from "@album/template-import";
import { assertManifest, StorageError } from "./indexeddb-store";

/** Private imports have their own lifecycle; projects keep independent resource copies. */
export class IndexedDbThemeLibrary {
  private readonly db: Promise<IDBPDatabase>;
  constructor(readonly dbName = "album-themes-v1") {
    if (typeof indexedDB === "undefined")
      throw new StorageError("INDEXEDDB_UNAVAILABLE");
    this.db = openDB(dbName, 1, {
      upgrade(db) {
        const themes = db.createObjectStore("themes", { keyPath: "id" });
        themes.createIndex("sourceHash", "sourceHash", { unique: true });
        db.createObjectStore("files");
      },
    });
  }
  async put(
    converted: ConvertedTheme,
    signal?: AbortSignal,
  ): Promise<{ id: string; existing: boolean }> {
    signal?.throwIfAborted();
    const theme = structuredClone(converted.theme);
    const files = new Map(
      [...converted.files].map(([key, bytes]) => [key, new Uint8Array(bytes)]),
    );
    if (
      theme.version !== 1 ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(theme.id) ||
      !/^[0-9a-f]{64}$/.test(theme.sourceHash) ||
      !Array.isArray(theme.pages) ||
      !theme.pages.length ||
      theme.pages.length > 50
    )
      throw new StorageError("INVALID_THEME");
    assertManifest(theme.resources);
    const verify = async (key: string, hash: string, size: number) => {
      const bytes = files.get(key);
      if (!bytes || bytes.length !== size)
        throw new StorageError("RESOURCE_MISSING");
      if ((await sha256(bytes)) !== hash)
        throw new StorageError("HASH_MISMATCH");
      signal?.throwIfAborted();
    };
    for (const asset of theme.resources.assets)
      for (const variant of ["original", "normalized", "preview"] as const)
        await verify(
          `${asset.id}:${variant}`,
          asset.variants[variant].sha256,
          asset.variants[variant].byteLength,
        );
    for (const font of theme.resources.fonts) {
      if ((await fontRecordHash(font)) !== font.sha256)
        throw new StorageError("HASH_MISMATCH");
      for (const face of font.faces)
        await verify(`${face.id}:font`, face.sha256, face.byteLength);
    }
    for (const page of theme.pages)
      if (!files.get(page.previewPath)?.length)
        throw new StorageError("RESOURCE_MISSING");
    signal?.throwIfAborted();
    const tx = (await this.db).transaction(["themes", "files"], "readwrite");
    const abort = () => {
      try {
        tx.abort();
      } catch {}
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      signal?.throwIfAborted();
      const existing = (await tx
        .objectStore("themes")
        .index("sourceHash")
        .get(theme.sourceHash)) as ImportedTheme | undefined;
      if (existing) {
        await tx.done;
        return { id: existing.id, existing: true };
      }
      if (await tx.objectStore("themes").get(theme.id))
        throw new StorageError("THEME_ID_CONFLICT");
      await tx.objectStore("files").put(files, theme.id);
      await tx.objectStore("themes").put(theme);
      await tx.done;
      return { id: theme.id, existing: false };
    } catch (error) {
      abort();
      await tx.done.catch(() => {});
      if (signal?.aborted) signal.throwIfAborted();
      throw error;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  async list(): Promise<ImportedTheme[]> {
    return (await this.db).getAll("themes");
  }
  async get(id: string): Promise<ConvertedTheme> {
    const tx = (await this.db).transaction(["themes", "files"], "readonly");
    const theme = (await tx.objectStore("themes").get(id)) as
      ImportedTheme | undefined;
    const files = (await tx.objectStore("files").get(id)) as
      Map<string, Uint8Array> | undefined;
    await tx.done;
    if (!theme || !files) throw new StorageError("THEME_NOT_FOUND");
    return { theme, files };
  }
  async remove(id: string): Promise<void> {
    const tx = (await this.db).transaction(["themes", "files"], "readwrite");
    await tx.objectStore("themes").delete(id);
    await tx.objectStore("files").delete(id);
    await tx.done;
  }
  async close(): Promise<void> {
    (await this.db).close();
  }
}
