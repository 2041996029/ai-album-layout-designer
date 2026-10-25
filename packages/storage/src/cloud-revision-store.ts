import { openDB } from "idb";
import type { components } from "@album/contracts";
import {
  parseDocument,
  canonicalJson,
  canonicalDocument,
  hashDocument,
  type DocumentModel,
} from "@album/document";
import type { ResourceManifest } from "@album/assets";
import {
  assertManifest,
  StorageError,
  type RevisionStore,
  type SavedRevision,
  type SaveResult,
} from "./indexeddb-store";
/** Recovery drafts are distinct from saved cloud revisions and retained until explicitly discarded. */
export class CloudRevisionStore implements RevisionStore {
  constructor(
    readonly baseUrl: string,
    readonly workspaceId: string,
    readonly fetcher: typeof fetch,
  ) {}
  private url(projectId: string) {
    return `${this.baseUrl.replace(/\/$/, "")}/projects/${encodeURIComponent(projectId)}`;
  }
  private async recovery(doc: DocumentModel, resources: ResourceManifest) {
    if (typeof indexedDB === "undefined") return;
    const db = await openDB(`album-cloud-recovery:${this.workspaceId}`, 1, {
      upgrade(db) {
        db.createObjectStore("drafts");
      },
    });
    try {
      await db.put(
        "drafts",
        { doc, resources, capturedAt: new Date().toISOString() },
        `${doc.projectId}:${crypto.randomUUID()}`,
      );
    } finally {
      db.close();
    }
  }
  async recoveryDrafts(
    projectId: string,
  ): Promise<
    { doc: DocumentModel; resources: ResourceManifest; capturedAt: string }[]
  > {
    if (typeof indexedDB === "undefined")
      throw new StorageError("INDEXEDDB_UNAVAILABLE");
    const db = await openDB(`album-cloud-recovery:${this.workspaceId}`, 1, {
      upgrade(db) {
        db.createObjectStore("drafts");
      },
    });
    try {
      const entries = await db.getAll("drafts");
      return entries
        .filter((d) => d.doc.projectId === projectId)
        .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    } finally {
      db.close();
    }
  }
  async load(projectId: string, revision?: number): Promise<SavedRevision> {
    const response = await this.fetcher(
      this.url(projectId) +
        `${revision === undefined ? "" : `?revision=${revision}`}`,
      {
        credentials: "include",
        headers: { "X-Workspace-Id": this.workspaceId },
      },
    );
    if (!response.ok)
      throw new StorageError(
        response.status === 404 ? "REVISION_NOT_FOUND" : "STORAGE_FAILED",
      );
    const envelope =
        (await response.json()) as components["schemas"]["GetProjectResponse"],
      body = envelope.data;
    const doc = parseDocument(body.document);
    const docHash = body.documentSha256;
    if (
      doc.projectId !== projectId ||
      (revision !== undefined && doc.revision !== revision) ||
      (await hashDocument(doc)) !== docHash
    )
      throw new StorageError("STORAGE_CORRUPT");
    const resources = body.resources;
    if (!resources) throw new StorageError("RESOURCE_MANIFEST_UNAVAILABLE");
    assertManifest(resources);
    return {
      doc,
      docHash,
      resources,
      savedAt: body.project.updatedAt,
    };
  }
  async save(
    document: DocumentModel,
    expectedRevision: number,
    resources: ResourceManifest,
  ): Promise<SaveResult> {
    const recoveryDraft = parseDocument(document);
    assertManifest(resources);
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      throw new StorageError("INVALID_REVISION");
    try {
      await this.recovery(recoveryDraft, resources);
      const commandId = crypto.randomUUID();
      const response = await this.fetcher(this.url(document.projectId), {
        method: "PATCH",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          "X-Workspace-Id": this.workspaceId,
          "If-Match": `"${expectedRevision}"`,
          "Idempotency-Key": commandId,
        },
        body: JSON.stringify({
          commandId,
          commands: [{ type: "replaceDocument", document: recoveryDraft }],
          clientPlatform: "web",
          resources,
        }),
      });
      if (!response.ok)
        return {
          ok: false,
          code:
            response.status === 409 ? "REVISION_CONFLICT" : "STORAGE_FAILED",
          recoveryDraft,
        };
      const envelope =
          (await response.json()) as components["schemas"]["PatchProjectResponse"],
        body = envelope.data,
        doc = parseDocument(body.document),
        docHash = body.documentSha256;
      if (
        doc.projectId !== document.projectId ||
        doc.revision !== expectedRevision + 1 ||
        canonicalDocument(doc) !==
          canonicalDocument({
            ...recoveryDraft,
            revision: expectedRevision + 1,
          }) ||
        (await hashDocument(doc)) !== docHash
      )
        throw new StorageError("STORAGE_CORRUPT");
      if (!body.resources)
        throw new StorageError("RESOURCE_MANIFEST_UNAVAILABLE");
      assertManifest(body.resources);
      if (canonicalJson(body.resources) !== canonicalJson(resources))
        throw new StorageError("RESOURCE_MANIFEST_MISMATCH");
      return {
        ok: true,
        value: {
          doc,
          docHash,
          resources: structuredClone(body.resources),
          savedAt: body.project.updatedAt,
        },
      };
    } catch (error) {
      return {
        ok: false,
        code:
          error instanceof DOMException && error.name === "QuotaExceededError"
            ? "STORAGE_FULL"
            : "STORAGE_FAILED",
        recoveryDraft,
      };
    }
  }
}
