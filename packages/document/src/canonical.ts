import type { DocumentModel, Layer, Rect } from "./model";
import { isGroupLayer, isKnownLayer, isImageLayer } from "./model";
import { parseDocument } from "./validate";

const rounded = (n: number) => Math.round(n * 1e6) / 1e6;
function roundCrop(crop: Rect): void {
  for (const [start, size] of [
    ["x", "width"],
    ["y", "height"],
  ] as const) {
    const position = Math.round(crop[start] * 1e6);
    // The schema's minimum extent is one micro-unit. Clamp in integer units
    // so independent half-up rounding cannot move the far edge past one.
    const extent = Math.min(Math.round(crop[size] * 1e6), 1e6 - position);
    crop[start] = position / 1e6;
    crop[size] = extent / 1e6;
  }
}
const order = (a: string, b: string) => {
  const aa = Array.from(a),
    bb = Array.from(b);
  for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
    const d = aa[i].codePointAt(0)! - bb[i].codePointAt(0)!;
    if (d) return d;
  }
  return aa.length - bb.length;
};
function serialize(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(serialize).join(",") + "]";
  if (value && typeof value === "object")
    return (
      "{" +
      Object.keys(value)
        .sort(order)
        .map(
          (k) =>
            JSON.stringify(k) +
            ":" +
            serialize((value as Record<string, unknown>)[k]),
        )
        .join(",") +
      "}"
    );
  return JSON.stringify(value);
}
export function canonicalDocument(value: DocumentModel): string {
  const doc = parseDocument(value);
  doc.pageSize.width = rounded(doc.pageSize.width);
  doc.pageSize.height = rounded(doc.pageSize.height);
  const geometry = (list: Layer[]) => {
    for (const layer of list) {
      if (!isKnownLayer(layer)) continue;
      for (const key of ["x", "y", "width", "height", "rotation"] as const)
        layer[key] = rounded(layer[key]);
      if (isImageLayer(layer)) roundCrop(layer.crop);
      if (isGroupLayer(layer)) geometry(layer.children);
    }
  };
  geometry(doc.cover.front);
  geometry(doc.cover.back);
  doc.spreads.forEach((s) => geometry(s.layers));
  return serialize(doc);
}
export async function sha256(bytes: Uint8Array | string): Promise<string> {
  const data =
    typeof bytes === "string"
      ? new TextEncoder().encode(bytes)
      : new Uint8Array(bytes);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export async function hashDocument(doc: DocumentModel): Promise<string> {
  return sha256(canonicalDocument(doc));
}
export function canonicalJson(value: unknown): string {
  return serialize(value);
}
