import { sha256 } from "@album/document";
import { readMjtplZip, DEFAULT_IMPORT_LIMITS } from "./zip";
import type {
  ParsedMjtpl,
  ImportLimits,
  MjtplManifest,
  MjtplScene,
  FileRef,
} from "./types";
const positive = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;
export async function parseMjtpl(
  bytes: Uint8Array,
  signal: AbortSignal,
  limits: ImportLimits = DEFAULT_IMPORT_LIMITS,
): Promise<ParsedMjtpl> {
  const files = readMjtplZip(bytes, limits, signal),
    decode = (path: string): unknown => {
      const b = files.get(path);
      if (!b) throw Error(`Missing file: ${path}`);
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(b));
    };
  const manifest = decode("manifest.json") as MjtplManifest;
  if (
    manifest.format !== "MJTPL" ||
    manifest.formatVersion !== 1 ||
    manifest.schemaVersion !== 3 ||
    typeof manifest.name !== "string" ||
    !Array.isArray(manifest.pages) ||
    !manifest.pages.length ||
    manifest.pages.length > limits.pages ||
    !Array.isArray(manifest.assets)
  )
    throw Error("Unsupported MJTPL manifest");
  if (manifest.requiredCapabilities?.length)
    throw Error(
      `Unsupported required capabilities: ${manifest.requiredCapabilities.join(", ")}`,
    );
  if (
    manifest.assets.filter((a) => a.kind === "font").length >
    (limits.fonts ?? 20)
  )
    throw Error("Too many fonts");
  const check = async (ref: FileRef) => {
    signal.throwIfAborted();
    const b = files.get(ref.path);
    if (
      !b ||
      !Number.isSafeInteger(ref.sizeBytes) ||
      ref.sizeBytes !== b.length ||
      !/^([a-f0-9]{64})$/.test(ref.sha256) ||
      (await sha256(b)) !== ref.sha256
    )
      throw Error(`Resource hash/size mismatch: ${ref.path}`);
  };
  await check(manifest.preview);
  const keys = new Set<string>();
  for (const a of manifest.assets) {
    if (keys.has(a.assetKey)) throw Error("Duplicate asset key");
    keys.add(a.assetKey);
    await check(a);
  }
  const pageIds = new Set<string>(),
    scenes: MjtplScene[] = [];
  for (const page of manifest.pages) {
    if (
      pageIds.has(page.pageId) ||
      !positive(page.width) ||
      !positive(page.height) ||
      !["cm", "px"].includes(page.unit)
    )
      throw Error("Invalid page");
    pageIds.add(page.pageId);
    await check(page.preview);
    const b = files.get(page.scenePath);
    if (!b || (await sha256(b)) !== page.sceneHash)
      throw Error("Scene hash mismatch");
    const scene = decode(page.scenePath) as MjtplScene;
    if (
      scene.schemaVersion !== 3 ||
      scene.pageId !== page.pageId ||
      scene.width !== page.width ||
      scene.height !== page.height ||
      scene.unit !== page.unit ||
      !Array.isArray(scene.nodes) ||
      scene.nodes.length > (limits.layers ?? 100)
    )
      throw Error("Invalid scene");
    const ids = new Set<string>(),
      slots = new Set<string>();
    for (const n of scene.nodes) {
      if (
        typeof n.id !== "string" ||
        ids.has(n.id) ||
        !n.transform ||
        ![
          n.transform.x,
          n.transform.y,
          n.transform.width,
          n.transform.height,
          n.transform.rotationDeg ?? 0,
          n.transform.scaleX ?? 1,
          n.transform.scaleY ?? 1,
        ].every(Number.isFinite) ||
        !positive(n.transform.width) ||
        !positive(n.transform.height)
      )
        throw Error("Invalid node");
      ids.add(n.id);
      if (n.slotId) {
        if (slots.has(n.slotId)) throw Error("Duplicate slot");
        slots.add(n.slotId);
      }
      if (n.assetRef) {
        const a = manifest.assets.find(
          (a) => a.assetKey === n.assetRef!.assetId,
        );
        if (
          !a ||
          a.path !== n.assetRef.relativePath ||
          a.sha256 !== n.assetRef.sha256
        )
          throw Error("Invalid node resource reference");
      }
    }
    for (const key of page.assetKeys ?? [])
      if (!keys.has(key)) throw Error("Missing page asset");
    scenes.push(scene);
  }
  signal.throwIfAborted();
  return { sourceHash: await sha256(bytes), manifest, scenes, files };
}
