import { templateRefs } from "@album/document";
import {
  freezeSnapshot,
  preflight,
  runExport,
  artifactManifest,
  authorizeExport,
  type ExportSnapshot,
} from "@album/export";
import type { ResourcePort, ResourceVariant } from "@album/assets";
export interface TrustedRenderRequest {
  snapshot: ExportSnapshot;
  acknowledgedWarningIds?: string[];
}
export interface ArtifactChunk {
  filename: string;
  base64: string;
  final: boolean;
  sha256: string;
}
export async function renderSnapshot(request: TrustedRenderRequest) {
  if (typeof window.__albumArtifactChunk !== "function")
    throw new Error("STREAM_SINK_REQUIRED");
  const raw = request.snapshot,
    snapshot = await freezeSnapshot(
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
    throw new Error("SNAPSHOT_HASH_MISMATCH");
  const allowed = new Set([
    ...snapshot.resources.assets.flatMap((a) =>
      Object.keys(a.variants).map((v) => a.id + "|" + v),
    ),
    ...snapshot.resources.fonts.flatMap((f) =>
      f.faces.map((face) => face.id + "|font"),
    ),
  ]);
  const port: ResourcePort = {
    read: async (id: string, variant: ResourceVariant) => {
      if (!allowed.has(id + "|" + variant))
        throw new Error("RESOURCE_NOT_IN_SNAPSHOT");
      const url = new URL("resource", location.href);
      url.searchParams.set("id", id);
      url.searchParams.set("variant", variant);
      const response = await fetch(url);
      if (!response.ok) throw new Error("RESOURCE_UNAVAILABLE");
      return new Uint8Array(await response.arrayBuffer());
    },
  };
  const signal = new AbortController().signal,
    report = await preflight(snapshot, port, signal, { templateRefs });
  if (report.blockers.length)
    throw new Error("PREFLIGHT_BLOCKED: " + JSON.stringify(report.blockers));
  try {
    authorizeExport(snapshot, report, request.acknowledgedWarningIds ?? []);
  } catch (error) {
    throw new Error(String(error) + ": " + JSON.stringify(report.warnings));
  }
  const metadata = [];
  for await (const file of runExport(
    snapshot,
    report,
    request.acknowledgedWarningIds ?? [],
    port,
    signal,
  )) {
    for (let offset = 0; offset < file.bytes.length; offset += 49152) {
      const slice = file.bytes.subarray(offset, offset + 49152);
      await window.__albumArtifactChunk({
        filename: file.filename,
        base64: btoa(String.fromCharCode(...slice)),
        final: offset + slice.length === file.bytes.length,
        sha256: file.sha256,
      });
    }
    metadata.push(artifactManifest(snapshot, [file]).files[0]);
  }
  const manifest = artifactManifest(snapshot, []);
  manifest.files = metadata;
  return { manifest, report };
}
declare global {
  interface Window {
    renderSnapshot: typeof renderSnapshot;
    __albumArtifactChunk?: (chunk: ArtifactChunk) => Promise<void>;
  }
}
window.renderSnapshot = renderSnapshot;
