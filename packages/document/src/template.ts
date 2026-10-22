import themes from "../templates/themes-v1.json";
import styles from "../templates/styles-v1.json";
import wedding from "../templates/wedding-v1.json";
import travel from "../templates/travel-v1.json";
import family from "../templates/family-v1.json";
import portrait from "../templates/portrait-v1.json";
import ink from "../templates/ink-v1.json";
import { canonicalJson } from "./canonical";
import type { Layer, Rect, TemplateRef } from "./model";
import type { DocumentCommand } from "./commands";
export interface TemplateSlot {
  slotId: string;
  kind: "image" | "text" | "shape";
  shapeKind?: "rectangle" | "ellipse" | "line";
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  rotation?: number;
  opacity?: number;
  frame: Rect;
  fitMode?: "cover" | "contain";
  bindingRequired?: boolean;
  defaultText?: string;
  fontAssetId?: string;
  fontWeight?: number;
  fontSize?: number;
  editableFields?: string[];
  fill?: string;
  letterSpacing?: number;
  textAlign?: "left" | "center" | "right";
}
export interface TemplateVersion {
  id: string;
  version: number;
  sha256: string;
  category: string;
  themeId?: string;
  collectionName?: string;
  pageRole?: "opening" | "two-photo" | "three-photo" | "four-photo" | "closing";
  pageOrder?: number;
  name: string;
  unit: "px96";
  pageSize: { width: number; height: number };
  view: "spread";
  background: string;
  origin: string;
  state: "registered";
  licenseRef: string;
  licenseText: string;
  source: string;
  slots: TemplateSlot[];
}
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}
export const templateVersions: readonly TemplateVersion[] = freeze([
  wedding,
  travel,
  family,
  portrait,
  ink,
  ...styles,
  ...themes,
] as TemplateVersion[]);
export const templateRefs: readonly TemplateRef[] = freeze(
  templateVersions.map(({ id, version, sha256 }) => ({ id, version, sha256 })),
);
function registered(template: TemplateVersion): void {
  if (
    !templateVersions.some(
      (t) =>
        t.id === template.id &&
        t.version === template.version &&
        canonicalJson(t) === canonicalJson(template),
    )
  )
    throw new Error("TEMPLATE_UNAVAILABLE");
}
function validateBindings(
  template: TemplateVersion,
  bindings: Record<string, string>,
) {
  registered(template);
  const ids = template.slots
    .filter((s) => s.kind === "image")
    .map((s) => s.slotId);
  if (Object.keys(bindings).some((k) => !ids.includes(k)))
    throw new Error("UNKNOWN_TEMPLATE_BINDING");
  if (ids.some((k) => typeof bindings[k] !== "string" || !bindings[k].trim()))
    throw new Error("TEMPLATE_BINDING_REQUIRED");
}
/** Resource membership is checked at the application boundary, before emitting a command. */
export function validateTemplateBindings(
  template: TemplateVersion,
  bindings: Record<string, string>,
  resources: { assetIds: readonly string[]; fontIds: readonly string[] },
): void {
  validateBindings(template, bindings);
  if (Object.values(bindings).some((id) => !resources.assetIds.includes(id)))
    throw new Error("ASSET_MISSING");
  if (
    template.slots.some(
      (s) => s.kind === "text" && !resources.fontIds.includes(s.fontAssetId!),
    )
  )
    throw new Error("FONT_UNAVAILABLE");
}
export function instantiateTemplate(
  template: TemplateVersion,
  bindings: Record<string, string>,
  idFactory: () => string,
): Layer[] {
  validateBindings(template, bindings);
  const ids = new Set<string>();
  return template.slots.map((slot) => {
    const id = idFactory();
    if (typeof id !== "string" || !id || ids.has(id))
      throw new Error("DUPLICATE_LAYER_ID");
    ids.add(id);
    const base = {
      id,
      ...slot.frame,
      rotation: slot.rotation ?? 0,
      opacity: slot.opacity ?? 1,
      visible: true,
      locked: false,
    };
    return slot.kind === "image"
      ? {
          ...base,
          type: "image",
          assetId: bindings[slot.slotId],
          crop: { x: 0, y: 0, width: 1, height: 1 },
          fitMode: slot.fitMode ?? "cover",
          role: "photo",
        }
      : slot.kind === "shape"
        ? {
            ...base,
            type: "shape",
            shapeKind: slot.shapeKind ?? "rectangle",
            fill: slot.fill ?? "transparent",
            stroke: slot.stroke ?? "transparent",
            strokeWidth: slot.strokeWidth ?? 0,
            ...(slot.radius === undefined ? {} : { radius: slot.radius }),
          }
        : {
            ...base,
            type: "text",
            text: slot.defaultText ?? "",
            fontAssetId: slot.fontAssetId!,
            fontSize: slot.fontSize!,
            fontWeight: slot.fontWeight!,
            lineHeight: 1.3,
            letterSpacing: slot.letterSpacing ?? 0,
            fill: slot.fill ?? "#253d3b",
            textAlign: slot.textAlign ?? "left",
            critical: true,
          };
  });
}
export function applyTemplateCommand(
  spreadId: string,
  layers: Layer[],
  templateRef: TemplateRef,
  background?: string,
): DocumentCommand {
  return {
    ...(background ? { background } : {}),
    type: "apply-template",
    spreadId,
    layers: structuredClone(layers),
    templateRef: structuredClone(templateRef),
  };
}
