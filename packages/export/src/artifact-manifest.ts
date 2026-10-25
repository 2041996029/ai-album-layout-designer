import { planSurfaces } from "./geometry";
import { sha256 } from "@album/document";
import type { ExportSnapshot, SurfaceSpec } from "./types";
export const RENDER_BUILD = "c1-cpu-fabric-v1";
export interface Artifact {
  filename: string;
  mime: string;
  bytes: Uint8Array;
  sha256: string;
  surfaceId?: string;
  pixelWidth?: number;
  pixelHeight?: number;
}
export async function artifact(
  filename: string,
  mime: string,
  bytes: Uint8Array,
  surface?: SurfaceSpec,
): Promise<Artifact> {
  return {
    filename,
    mime,
    bytes,
    sha256: await sha256(bytes),
    ...(surface
      ? {
          surfaceId: surface.id,
          pixelWidth: surface.pixelWidth,
          pixelHeight: surface.pixelHeight,
        }
      : {}),
  };
}
export function artifactManifest(
  snapshot: ExportSnapshot,
  artifacts: Artifact[],
) {
  return {
    schemaVersion: 1,
    renderBuild: RENDER_BUILD,
    projectId: snapshot.projectId,
    revision: snapshot.revision,
    snapshotHash: snapshot.snapshotHash,
    docHash: snapshot.docHash,
    options: snapshot.options,
    createdAt: snapshot.createdAt,
    surfaces: planSurfaces(snapshot),
    resources: {
      assets: snapshot.resources.assets.map((a) => ({
        id: a.id,
        version: a.version,
        sha256: a.sha256,
        normalizedSha256: a.variants.normalized.sha256,
      })),
      fonts: snapshot.resources.fonts.map((f) => ({
        id: f.id,
        version: f.version,
        sha256: f.sha256,
      })),
    },
    files: artifacts.map(({ bytes, ...metadata }) => ({
      ...metadata,
      byteLength: bytes.length,
    })),
  };
}
