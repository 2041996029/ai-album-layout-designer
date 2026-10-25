import { templateRefs } from "@album/document";
import {
  freezeSnapshot,
  preflight,
  authorizeExport,
  type ExportSnapshot,
} from "@album/export";
import type { ResourcePort } from "@album/assets";
export async function checkSnapshot(request: {
  snapshot: ExportSnapshot;
  ack?: string[];
}) {
  const raw = request.snapshot;
  const snapshot = await freezeSnapshot(
    {
      doc: raw.doc,
      docHash: raw.docHash,
      resources: raw.resources,
      savedAt: raw.createdAt,
    },
    raw.options,
    raw.createdAt,
  );
  if (snapshot.snapshotHash !== raw.snapshotHash)
    throw Error("SNAPSHOT_HASH_MISMATCH");
  const allowed = new Set([
    ...snapshot.resources.assets.flatMap((a) =>
      Object.keys(a.variants).map((v) => a.id + "|" + v),
    ),
    ...snapshot.resources.fonts.flatMap((f) =>
      f.faces.map((face) => face.id + "|font"),
    ),
  ]);
  const port: ResourcePort = {
    read: async (id, variant) => {
      if (!allowed.has(id + "|" + variant))
        throw Error("RESOURCE_NOT_IN_SNAPSHOT");
      const url = new URL("resource", location.href);
      url.searchParams.set("id", id);
      url.searchParams.set("variant", variant);
      const response = await fetch(url);
      if (!response.ok) throw Error("RESOURCE_UNAVAILABLE");
      return new Uint8Array(await response.arrayBuffer());
    },
  };
  const report = await preflight(snapshot, port, new AbortController().signal, {
    templateRefs,
    memoryBudgetBytes: 2 * 1024 ** 3,
  });
  if (request.ack !== undefined) authorizeExport(snapshot, report, request.ack);
  return report;
}
declare global {
  interface Window {
    albumCheckSnapshot: typeof checkSnapshot;
  }
}
window.albumCheckSnapshot = checkSnapshot;
