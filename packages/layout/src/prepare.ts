import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { canonicalJson, sha256 } from "@album/document";
import documentSchema from "../../../docs/release-v1.0/contracts/schemas/document.schema.json";
import layoutSchema from "../../../docs/release-v1.0/contracts/schemas/layout.schema.json";
import type { LayoutInput, LayoutPolicy, PreparedLayout } from "./types";
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(documentSchema, "document.schema.json");
ajv.addSchema(layoutSchema, "layout.schema.json");
export const validateLayoutInputShape = ajv.compile({
  $ref: "layout.schema.json#/$defs/root",
});
export function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
function assertJson(value: unknown, code: string): void {
  const active = new Set<object>();
  let nodes = 0;
  const visit = (v: unknown, depth: number): void => {
    if (++nodes > 100000 || depth > 32) throw new Error(code);
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number") return;
    if (
      !v ||
      typeof v !== "object" ||
      active.has(v) ||
      (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype)
    )
      throw new Error(code);
    active.add(v);
    for (const key of Reflect.ownKeys(v)) {
      if (Array.isArray(v) && key === "length") continue;
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (
        typeof key !== "string" ||
        !("value" in d) ||
        !d.enumerable ||
        ["__proto__", "constructor", "prototype"].includes(key)
      )
        throw new Error(code);
      visit(d.value, depth + 1);
    }
    if (Array.isArray(v) && Object.keys(v).length !== v.length)
      throw new Error(code);
    active.delete(v);
  };
  visit(value, 0);
}
export async function prepareLayout(
  raw: LayoutInput,
  policy?: LayoutPolicy,
): Promise<PreparedLayout> {
  assertJson(raw, "INVALID_LAYOUT_INPUT");
  if (policy !== undefined) assertJson(policy, "INVALID_POLICY");
  // Validate before serialization, so JSON coercion cannot change the requested constraints.
  // Snapshot synchronously, before hashing yields control to callers.
  if (
    raw?.photos?.some(
      (p) =>
        !Number.isInteger(p.width) ||
        !Number.isInteger(p.height) ||
        p.width <= 0 ||
        p.height <= 0 ||
        p.width * p.height > 80_000_000,
    )
  )
    throw new Error("INVALID_DIMENSIONS");
  const input: LayoutInput = JSON.parse(canonicalJson(raw));
  if (!validateLayoutInputShape(input)) throw new Error("INVALID_LAYOUT_INPUT");
  const ids = new Set(input.photos.map((p) => p.assetId));
  if (ids.size !== input.photos.length) throw new Error("DUPLICATE_PHOTO_ID");
  const c = input.constraints;
  if (c.minPhotosPerSpread > c.maxPhotosPerSpread)
    throw new Error("INVALID_CAPACITY");
  for (const subset of [
    c.requiredAssetIds,
    c.excludedAssetIds,
    c.explicitRepeatAssetIds,
  ])
    if (subset?.some((id) => !ids.has(id))) throw new Error("UNKNOWN_PHOTO_ID");
  if (c.requiredAssetIds?.some((id) => c.excludedAssetIds?.includes(id)))
    throw new Error("CONTRADICTORY_SELECTION");
  const resolved: LayoutPolicy = JSON.parse(
    canonicalJson(
      policy ?? {
        algorithmVersion: "local-layout-v1",
        candidateCount: 3,
        weights: {
          subject: 0.3,
          timeline: 0.2,
          whitespace: 0.2,
          variety: 0.2,
          color: 0.1,
        },
      },
    ),
  );
  if (resolved.algorithmVersion !== input.algorithmVersion)
    throw new Error("POLICY_VERSION_MISMATCH");
  const weights = [
    "subject",
    "timeline",
    "whitespace",
    "variety",
    "color",
  ] as const;
  if (
    ![1, 2, 3].includes(resolved.candidateCount) ||
    !resolved.weights ||
    weights.some(
      (k) => !Number.isFinite(resolved.weights[k]) || resolved.weights[k] < 0,
    ) ||
    weights.reduce((s, k) => s + resolved.weights[k], 0) <= 0
  )
    throw new Error("INVALID_POLICY");
  const ordered = input.photos.map((p, index) => ({ p, index }));
  if (c.orderPolicy === "captureTime")
    ordered.sort((a, b) => {
      const time = (v: string | null | undefined) =>
        v ? Date.parse(v) : Infinity;
      const ta = time(a.p.captureTime),
        tb = time(b.p.captureTime);
      return ta === tb ? a.index - b.index : ta < tb ? -1 : 1;
    });
  const inputHash = await sha256(canonicalJson({ input, policy: resolved }));
  return deepFreeze({
    input,
    inputHash,
    orderedAssetIds: ordered.map((v) => v.p.assetId),
    policy: resolved,
  });
}
