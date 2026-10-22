import type { DocumentModel, DocumentIssue, Rect } from "@album/document";
import type { ResourceManifest } from "@album/assets";
import type { RenderSurface } from "@album/render";
export interface ExportOptions {
  format: "png" | "jpeg" | "pdf";
  dpi: 72 | 150 | 300;
  view: "singlePage" | "spread";
  pageIds: string[];
  includeCover: boolean;
  bleedMm: number;
  jpegMatte: string;
}
/** C1 internal snapshot carries complete local resource records. C4 maps to the API's object-reference DTO. */
export interface ExportSnapshot {
  snapshotId: string;
  projectId: string;
  revision: number;
  doc: DocumentModel;
  docHash: string;
  resources: ResourceManifest;
  options: ExportOptions;
  optionsHash: string;
  snapshotHash: string;
  configReleaseId: "local_c1";
  createdAt: string;
}
export interface SurfaceSpec extends RenderSurface {
  fileStem: string;
  trimWidthMm: number;
  trimHeightMm: number;
  bleedMm: number;
  trimBoxMm: Rect;
}
export interface PreflightIssue extends DocumentIssue {
  id: string;
  surfaceId?: string;
  ppi?: number;
  level?: "normal" | "strong";
}
export interface PreflightReport {
  snapshotHash: string;
  blockers: PreflightIssue[];
  warnings: PreflightIssue[];
  surfaces: SurfaceSpec[];
  estimatedBytes: number;
}
export const MAX_SURFACE_PIXELS = 50_000_000;
export const BROWSER_MEMORY_BYTES = 768 * 1024 ** 2;
