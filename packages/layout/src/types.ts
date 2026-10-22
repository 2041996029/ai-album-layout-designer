import type { TemplateRef } from "@album/document";
export type LayoutPhoto = {
  assetId: string;
  width: number;
  height: number;
  captureTime?: string | null;
  groupId?: string;
  weight?: number;
};
export type LayoutConstraints = {
  spreadCount: number;
  minPhotosPerSpread: number;
  maxPhotosPerSpread: number;
  selectionPolicy: "all" | "allowSelection";
  duplicatePolicy: "forbid" | "allowExplicit";
  orderPolicy: "user" | "captureTime";
  explicitRepeatAssetIds?: string[];
  requiredAssetIds?: string[];
  excludedAssetIds?: string[];
  lockedSpreadIds?: string[];
  lockedLayerIds?: string[];
  targetSpreadIds?: string[];
};
export type LayoutInput = {
  projectId: string;
  baseRevision: number;
  photos: LayoutPhoto[];
  constraints: LayoutConstraints;
  templateRef: TemplateRef;
  algorithmVersion: string;
  seed: number;
};
export type LayoutWeights = {
  subject: number;
  timeline: number;
  whitespace: number;
  variety: number;
  color: number;
};
export type LayoutPolicy = {
  algorithmVersion: string;
  candidateCount: 1 | 2 | 3;
  weights: LayoutWeights;
};
export type PreparedLayout = {
  input: LayoutInput;
  inputHash: string;
  orderedAssetIds: string[];
  policy: LayoutPolicy;
};
