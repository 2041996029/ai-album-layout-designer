import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import documentSchema from "../../../docs/release-v1.0/contracts/schemas/document.schema.json";
import layoutSchema from "../../../docs/release-v1.0/contracts/schemas/layout.schema.json";
import type { DocumentModel, DocumentIssue, Layer } from "./model";
import { isGroupLayer, isImageLayer, isKnownLayer } from "./model";

export class DocumentValidationError extends Error {
  constructor(public readonly issues: DocumentIssue[]) {
    super(issues.map((i) => `${i.code} at ${i.path}: ${i.message}`).join("; "));
    this.name = "DocumentValidationError";
  }
}
const ajv = new Ajv2020({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(documentSchema, "document.schema.json");
ajv.addSchema(layoutSchema, "layout.schema.json");
const validateShape = ajv.compile({ $ref: "document.schema.json#/$defs/root" });
const issue = (
  code: string,
  path: string,
  message: string,
  severity: "blocker" | "warning" = "blocker",
): DocumentIssue => ({ code, path, message, severity });

/** Scan before cloning/schema validation: do not execute getters or recurse into cycles. */
function jsonIssue(value: unknown): DocumentIssue | undefined {
  const ancestors = new Set<object>();
  let count = 0;
  const visit = (
    v: unknown,
    path: string,
    depth: number,
  ): DocumentIssue | undefined => {
    if (++count > 200_000 || depth > 64)
      return issue("NON_JSON_VALUE", path, "JSON structure too large or deep");
    if (v === null || typeof v === "boolean" || typeof v === "string") return;
    if (typeof v === "number")
      return Number.isFinite(v)
        ? undefined
        : issue("NON_JSON_VALUE", path, "Number must be finite");
    if (typeof v !== "object")
      return issue("NON_JSON_VALUE", path, "Only JSON values accepted");
    const proto = Object.getPrototypeOf(v);
    if (
      (!Array.isArray(v) && proto !== Object.prototype && proto !== null) ||
      ancestors.has(v)
    )
      return issue(
        "NON_JSON_VALUE",
        path,
        "Expected a plain, acyclic JSON object",
      );
    ancestors.add(v);
    for (const key of Reflect.ownKeys(v)) {
      if (typeof key !== "string")
        return issue("NON_JSON_VALUE", path, "Symbol keys are not JSON");
      if (Array.isArray(v) && key === "length") continue;
      if (Array.isArray(v)) {
        const index = Number(key);
        if (
          !Number.isInteger(index) ||
          index < 0 ||
          index >= v.length ||
          String(index) !== key
        )
          return issue(
            "NON_JSON_VALUE",
            path + "/" + key,
            "Only canonical in-range array indices accepted",
          );
      }
      if (["__proto__", "constructor", "prototype"].includes(key))
        return issue("UNSAFE_KEY", path + "/" + key, "Unsafe property name");
      const d = Object.getOwnPropertyDescriptor(v, key)!;
      if (d.get || d.set || !d.enumerable)
        return issue(
          "NON_JSON_VALUE",
          path + "/" + key,
          "Only enumerable JSON data allowed",
        );
      const found = visit(d.value, path + "/" + key, depth + 1);
      if (found) return found;
    }
    // All keys are distinct, enumerable, in-range indices, so equal counts
    // guarantee every index is present without walking a huge sparse length.
    if (Array.isArray(v) && Object.keys(v).length !== v.length)
      return issue(
        "NON_JSON_VALUE",
        path,
        "Sparse or extended arrays not accepted",
      );
    ancestors.delete(v);
    return;
  };
  return visit(value, "", 0);
}

function semanticIssues(doc: DocumentModel): DocumentIssue[] {
  const issues: DocumentIssue[] = [];
  const ids = new Set<string>();
  const unique = (id: string, path: string) => {
    if (ids.has(id))
      issues.push(issue("DUPLICATE_ID", path, "IDs must be globally unique"));
    ids.add(id);
  };
  const checkSurface = (layers: Layer[], path: string) => {
    let count = 0;
    const walk = (list: Layer[], depth: number, at: string) => {
      list.forEach((layer, i) => {
        count++;
        const p = at + "/" + i;
        unique(layer.id, p + "/id");
        if (!isKnownLayer(layer))
          issues.push({
            ...issue(
              "UNSUPPORTED_LAYER",
              p,
              "Unknown same-version layer cannot be rendered",
            ),
            layerId: layer.id,
          });
        if (isGroupLayer(layer)) {
          if (depth >= 5)
            issues.push(issue("GROUP_DEPTH", p, "At most five nested groups"));
          walk(layer.children, depth + 1, p + "/children");
        }
        if (isImageLayer(layer) && layer.crop) {
          const c = layer.crop;
          if (
            c.x < 0 ||
            c.y < 0 ||
            c.width <= 0 ||
            c.height <= 0 ||
            c.x + c.width > 1 + 1e-12 ||
            c.y + c.height > 1 + 1e-12
          )
            issues.push(
              issue(
                "INVALID_CROP",
                p + "/crop",
                "Crop must be inside oriented source",
              ),
            );
        }
      });
    };
    walk(layers, 0, path);
    if (count > 100)
      issues.push(
        issue("LAYER_LIMIT", path, "At most 100 recursive layers per surface"),
      );
  };
  checkSurface(doc.cover.front, "/cover/front");
  checkSurface(doc.cover.back, "/cover/back");
  doc.spreads.forEach((s, i) => {
    unique(s.id, `/spreads/${i}/id`);
    checkSurface(s.layers, `/spreads/${i}/layers`);
  });
  return issues;
}
export function validateDocument(value: unknown): DocumentIssue[] {
  const malformed = jsonIssue(value);
  if (malformed) return [malformed];
  if (
    !value ||
    typeof value !== "object" ||
    (value as { schemaVersion?: unknown }).schemaVersion !== 1
  )
    return [
      issue(
        "UNSUPPORTED_SCHEMA",
        "/schemaVersion",
        "Only schema version 1 is supported",
      ),
    ];
  const shaped = validateShape(value);
  const errors: DocumentIssue[] = shaped
    ? []
    : [
        issue(
          "INVALID_DOCUMENT",
          "",
          ajv.errorsText(validateShape.errors, { separator: "; " }),
        ),
      ];
  // Safe traversal even for rejected known structures (depth errors deserve a stable code).
  const d = value as DocumentModel;
  if (
    d.cover &&
    Array.isArray(d.cover.front) &&
    Array.isArray(d.cover.back) &&
    Array.isArray(d.spreads) &&
    d.spreads.every((s) => s && Array.isArray(s.layers))
  ) {
    const safeList = (list: unknown[]): boolean =>
      list.every(
        (l) =>
          l &&
          typeof l === "object" &&
          typeof (l as Layer).id === "string" &&
          typeof (l as Layer).type === "string" &&
          ((l as Layer).type !== "group" ||
            (Array.isArray((l as any).children) &&
              safeList((l as any).children))),
      );
    if (
      safeList([
        ...d.cover.front,
        ...d.cover.back,
        ...d.spreads.flatMap((s) => s.layers),
      ])
    )
      errors.push(...semanticIssues(d));
  }
  return errors;
}
export function parseDocument(value: unknown): DocumentModel {
  const issues = validateDocument(value);
  const fatal = issues.filter((i) => i.code !== "UNSUPPORTED_LAYER");
  if (fatal.length) throw new DocumentValidationError(fatal);
  return structuredClone(value) as DocumentModel;
}
