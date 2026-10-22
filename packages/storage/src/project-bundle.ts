import { zipSync, Unzip, UnzipInflate, strToU8, strFromU8 } from "fflate";
import {
  parseDocument,
  canonicalDocument,
  canonicalJson,
  hashDocument,
  sha256,
} from "@album/document";
import type { ResourceManifest, ResourcePort } from "@album/assets";
import {
  IndexedDbRevisionStore,
  StorageError,
  assertManifest,
  type SavedRevision,
} from "./indexeddb-store";
const LIMIT = 1024 ** 3;
interface BundleManifest {
  version: 1;
  docHash: string;
  resources: ResourceManifest;
  files: { path: string; sha256: string; bytes: number }[];
}
const allowed = (name: string) =>
  /^(manifest\.json|document\.json|resources\/[0-9a-f]{64}\.bin|licenses\/[0-9a-f]{64}\.txt)$/.test(
    name,
  );
/** Inspect the ZIP32 central directory before any decompression. No encrypted/ZIP64/symlink entries. */
function directory(bytes: Uint8Array): Map<string, number> {
  if (bytes.length < 22 || bytes.length > LIMIT)
    throw new StorageError("INVALID_PROJECT_ZIP");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
    if (
      view.getUint32(p, true) === 0x06054b50 &&
      p + 22 + view.getUint16(p + 20, true) === bytes.length
    ) {
      end = p;
      break;
    }
  if (
    end < 0 ||
    view.getUint16(end + 4, true) !== 0 ||
    view.getUint16(end + 6, true) !== 0
  )
    throw new StorageError("INVALID_PROJECT_ZIP");
  const count = view.getUint16(end + 10, true),
    size = view.getUint32(end + 12, true),
    start = view.getUint32(end + 16, true);
  if (
    count < 2 ||
    count > 5000 ||
    count !== view.getUint16(end + 8, true) ||
    start + size !== end
  )
    throw new StorageError("INVALID_PROJECT_ZIP");
  const entries = new Map<string, number>();
  let p = start,
    total = 0;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (let i = 0; i < count; i++) {
    if (p + 46 > end || view.getUint32(p, true) !== 0x02014b50)
      throw new StorageError("INVALID_PROJECT_ZIP");
    const len = view.getUint16(p + 28, true),
      extra = view.getUint16(p + 30, true),
      comment = view.getUint16(p + 32, true),
      uncompressed = view.getUint32(p + 24, true);
    if (
      p + 46 + len + extra + comment > end ||
      view.getUint16(p + 8, true) & 1 ||
      ![0, 8].includes(view.getUint16(p + 10, true)) ||
      view.getUint32(p + 42, true) >= start ||
      ((view.getUint32(p + 38, true) >>> 16) & 0xf000) === 0xa000
    )
      throw new StorageError("INVALID_PROJECT_ZIP");
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + len));
    total += uncompressed;
    if (!allowed(name) || entries.has(name) || total > LIMIT)
      throw new StorageError("UNSAFE_PROJECT_ZIP");
    entries.set(name, uncompressed);
    p += 46 + len + extra + comment;
  }
  if (
    p !== end ||
    !entries.has("manifest.json") ||
    !entries.has("document.json")
  )
    throw new StorageError("INVALID_PROJECT_ZIP");
  return entries;
}
export function readProjectZip(bytes: Uint8Array): Map<string, Uint8Array> {
  const expected = directory(bytes),
    files = new Map<string, Uint8Array>(),
    seen = new Set<string>();
  let total = 0;
  const unzip = new Unzip((file) => {
    if (!expected.has(file.name) || seen.has(file.name))
      throw new StorageError("UNSAFE_PROJECT_ZIP");
    seen.add(file.name);
    const chunks: Uint8Array[] = [];
    let length = 0;
    file.ondata = (error, data, final) => {
      if (error) throw error;
      length += data.length;
      total += data.length;
      if (total > LIMIT || length > expected.get(file.name)!)
        throw new StorageError("PROJECT_ZIP_TOO_LARGE");
      chunks.push(data);
      if (final) {
        if (length !== expected.get(file.name))
          throw new StorageError("INVALID_PROJECT_ZIP");
        const output = new Uint8Array(length);
        let at = 0;
        for (const chunk of chunks) {
          output.set(chunk, at);
          at += chunk.length;
        }
        files.set(file.name, output);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let p = 0; p < bytes.length; p += 16384)
    unzip.push(
      bytes.subarray(p, Math.min(bytes.length, p + 16384)),
      p + 16384 >= bytes.length,
    );
  if (files.size !== expected.size)
    throw new StorageError("INVALID_PROJECT_ZIP");
  return files;
}
export async function exportProject(
  projectId: string,
  store: IndexedDbRevisionStore,
): Promise<Uint8Array> {
  return exportRevision(await store.load(projectId), store);
}
/** Recovery backup does not require or overwrite a successful CAS save. */
export async function exportDraftProject(
  doc: SavedRevision["doc"],
  resources: ResourceManifest,
  port: ResourcePort,
): Promise<Uint8Array> {
  const capturedDoc = parseDocument(doc),
    capturedResources = structuredClone(resources);
  assertManifest(capturedResources);
  return exportRevision(
    {
      doc: capturedDoc,
      resources: capturedResources,
      docHash: await hashDocument(capturedDoc),
      savedAt: new Date().toISOString(),
    },
    port,
  );
}
async function exportRevision(
  input: SavedRevision,
  store: ResourcePort,
): Promise<Uint8Array> {
  const saved = structuredClone(input),
    files: Record<string, Uint8Array> = {
      "document.json": strToU8(canonicalDocument(saved.doc)),
    };
  let total = files["document.json"].length;
  const add = (path: string, bytes: Uint8Array) => {
    if (!files[path]) {
      total += bytes.length;
      if (total > LIMIT) throw new StorageError("PROJECT_ZIP_TOO_LARGE");
      files[path] = bytes;
    }
  };
  for (const a of saved.resources.assets)
    for (const variant of ["original", "normalized", "preview"] as const)
      add(
        `resources/${a.variants[variant].sha256}.bin`,
        await store.read(a.id, variant),
      );
  for (const f of saved.resources.fonts) {
    for (const face of f.faces)
      add(`resources/${face.sha256}.bin`, await store.read(face.id, "font"));
    if (f.license.text)
      add(
        `licenses/${await sha256(f.license.text)}.txt`,
        strToU8(f.license.text),
      );
  }
  const manifest: BundleManifest = {
    version: 1,
    docHash: saved.docHash,
    resources: saved.resources,
    files: [],
  };
  for (const [path, bytes] of Object.entries(files))
    manifest.files.push({
      path,
      bytes: bytes.length,
      sha256: await sha256(bytes),
    });
  files["manifest.json"] = strToU8(canonicalJson(manifest));
  if (total + files["manifest.json"].length > LIMIT)
    throw new StorageError("PROJECT_ZIP_TOO_LARGE");
  return zipSync(files, { level: 0 });
}
export async function importProject(
  bytes: Uint8Array,
  store: IndexedDbRevisionStore,
): Promise<SavedRevision> {
  const files = readProjectZip(bytes);
  let manifest: BundleManifest;
  try {
    manifest = JSON.parse(strFromU8(files.get("manifest.json")!));
  } catch {
    throw new StorageError("INVALID_PROJECT_MANIFEST");
  }
  if (
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    manifest.files.length !== files.size - 1
  )
    throw new StorageError("INVALID_PROJECT_MANIFEST");
  assertManifest(manifest.resources);
  const seen = new Set<string>();
  for (const item of manifest.files) {
    if (
      seen.has(item.path) ||
      item.path === "manifest.json" ||
      !allowed(item.path)
    )
      throw new StorageError("INVALID_PROJECT_MANIFEST");
    seen.add(item.path);
    const content = files.get(item.path);
    if (
      !content ||
      content.length !== item.bytes ||
      (await sha256(content)) !== item.sha256
    )
      throw new StorageError("HASH_MISMATCH");
  }
  const doc = parseDocument(JSON.parse(strFromU8(files.get("document.json")!)));
  if ((await hashDocument(doc)) !== manifest.docHash)
    throw new StorageError("HASH_MISMATCH");
  const blobs = new Map<string, Uint8Array>();
  for (const [path, data] of files)
    if (path.startsWith("resources/")) {
      const expected = path.slice(10, -4);
      if ((await sha256(data)) !== expected)
        throw new StorageError("HASH_MISMATCH");
      blobs.set(expected, data);
    }
  for (const f of manifest.resources.fonts)
    if (f.license.text) {
      const path = `licenses/${await sha256(f.license.text)}.txt`;
      if (!files.has(path) || strFromU8(files.get(path)!) !== f.license.text)
        throw new StorageError("LICENSE_MISSING");
    }
  return store.importVerified(
    {
      ...doc,
      projectId: "prj_" + crypto.randomUUID().replaceAll("-", ""),
      revision: 1,
      sourceProjectId: doc.projectId,
      ...(doc.layoutContext != null
        ? { layoutSourceProjectId: doc.layoutSourceProjectId ?? doc.projectId }
        : {}),
      sourceRevision: doc.revision,
    },
    manifest.resources,
    blobs,
  );
}
