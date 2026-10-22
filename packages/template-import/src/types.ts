import type { Layer } from "@album/document";
import type { ResourceManifest } from "@album/assets";
export interface FileRef {
  path: string;
  sha256: string;
  sizeBytes: number;
  mime?: string;
}
export interface MjtplAsset extends FileRef {
  assetKey: string;
  kind: string;
}
export interface MjtplPage {
  pageId: string;
  name: string;
  width: number;
  height: number;
  unit: string;
  scenePath: string;
  sceneHash: string;
  preview: FileRef;
  assetKeys?: string[];
  photoSlotCount?: number;
}
export interface MjtplManifest {
  format: "MJTPL";
  formatVersion: 1;
  schemaVersion: 3;
  name: string;
  pages: MjtplPage[];
  assets: MjtplAsset[];
  preview: FileRef;
  requiredCapabilities?: string[];
}
export interface MjtplNode {
  id: string;
  type: string;
  name?: string;
  parentId?: string | null;
  siblingIndex?: number;
  visible?: boolean;
  locked?: boolean;
  transform: {
    x: number;
    y: number;
    width: number;
    height: number;
    rotationDeg?: number;
    scaleX?: number;
    scaleY?: number;
    [key: string]: unknown;
  };
  assetRef?: { assetId: string; relativePath: string; sha256: string };
  effects?: { opacity?: number; blendMode?: string; [key: string]: unknown };
  slotId?: string;
  slotRequired?: boolean;
  convertedFrom?: string;
  photoMask?: { type: string };
  maskRef?: unknown;
  crop?: { left: number; top: number; right: number; bottom: number };
  cropTransform?: {
    coordinateSpace: string;
    centerX: number;
    centerY: number;
    width: number;
    height: number;
    rotationDeg: number;
  };
  text?: string;
  textStyle?: Record<string, unknown>;
  [key: string]: unknown;
}
export interface MjtplScene {
  ppi?: number;
  schemaVersion: 3;
  pageId: string;
  width: number;
  height: number;
  unit: string;
  background: string;
  nodes: MjtplNode[];
}
export interface ImportIssue {
  code: string;
  severity: "warning" | "blocker";
  pageId?: string;
  nodeId?: string;
  message: string;
}
export interface ImportLimits {
  compressedBytes: number;
  expandedBytes: number;
  entryBytes: number;
  entries: number;
  pages: number;
  layers?: number;
  fonts?: number;
}
export interface ParsedMjtpl {
  sourceHash: string;
  manifest: MjtplManifest;
  scenes: readonly MjtplScene[];
  files: ReadonlyMap<string, Uint8Array>;
}
export interface ImportedPage {
  id: string;
  name: string;
  width: number;
  height: number;
  previewPath: string;
  background: string;
  layers: Layer[];
  photoSlots: { slotId: string; layerId: string; required: boolean }[];
  issues: ImportIssue[];
}
export interface ImportedTheme {
  version: 1;
  id: string;
  sourceHash: string;
  name: string;
  pages: ImportedPage[];
  resources: ResourceManifest;
  issues: ImportIssue[];
}
export interface ConvertedTheme {
  theme: ImportedTheme;
  files: ReadonlyMap<string, Uint8Array>;
}
