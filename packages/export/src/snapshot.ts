import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../../../docs/release-v1.0/contracts/schemas/export.schema.json";
import documentSchema from "../../../docs/release-v1.0/contracts/schemas/document.schema.json";
import layoutSchema from "../../../docs/release-v1.0/contracts/schemas/layout.schema.json";
import {
  parseDocument,
  canonicalJson,
  hashDocument,
  sha256,
} from "@album/document";
import { assertManifest, type SavedRevision } from "@album/storage";
import type { ExportOptions, ExportSnapshot } from "./types";
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
ajv.addSchema(documentSchema, "document.schema.json");
ajv.addSchema(layoutSchema, "layout.schema.json");
ajv.addSchema(schema, "export.schema.json");
const optionsSchema = ajv.compile({ $ref: "export.schema.json#/$defs/root" }),
  dateSchema = ajv.compile({ type: "string", format: "date-time" });
const verified = new WeakSet<object>();
export function validateOptions(options: ExportOptions): void {
  if (!optionsSchema(options))
    throw new Error(
      "INVALID_EXPORT_OPTIONS: " + ajv.errorsText(optionsSchema.errors),
    );
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
export function assertSnapshot(snapshot: ExportSnapshot): void {
  if (!verified.has(snapshot)) throw new Error("SNAPSHOT_UNVERIFIED");
}
/** Factory rehydrates trusted local/CLI snapshots; serialized objects must be revalidated through it. */
export async function freezeSnapshot(
  saved: SavedRevision,
  options: ExportOptions,
  createdAt: string,
): Promise<ExportSnapshot> {
  const pinned = structuredClone(saved),
    selected = structuredClone(options);
  validateOptions(selected);
  assertManifest(pinned.resources);
  if (!dateSchema(createdAt)) throw new Error("INVALID_SNAPSHOT_DATE");
  const doc = parseDocument(pinned.doc);
  if ((await hashDocument(doc)) !== pinned.docHash)
    throw new Error("DOC_HASH_MISMATCH");
  const optionsHash = await sha256(canonicalJson(selected)),
    snapshotHash = await sha256(
      canonicalJson({
        docHash: pinned.docHash,
        resources: pinned.resources,
        optionsHash,
        createdAt,
      }),
    );
  const snapshot: ExportSnapshot = {
    snapshotId: "snap_" + crypto.randomUUID().replaceAll("-", ""),
    projectId: doc.projectId,
    revision: doc.revision,
    doc,
    docHash: pinned.docHash,
    resources: pinned.resources,
    options: selected,
    optionsHash,
    snapshotHash,
    configReleaseId: "local_c1",
    createdAt,
  };
  deepFreeze(snapshot);
  verified.add(snapshot);
  return snapshot;
}
