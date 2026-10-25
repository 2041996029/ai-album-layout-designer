import type { DocumentModel } from "@album/document";
import type { ResourceManifest } from "@album/assets";
import type { RevisionStore, SaveResult } from "@album/storage";
export class Autosave {
  status: "dirty" | "saving" | "saved" | "conflict" | "error" = "saved";
  lastResult: SaveResult | undefined;
  private revision: number;
  private generation = 0;
  private dirty = false;
  private disposed = false;
  private idle: ReturnType<typeof setTimeout> | undefined;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<SaveResult> | undefined;
  private listeners = new Set<() => void>();
  constructor(
    private store: RevisionStore,
    private getDraft: () => DocumentModel,
    private getResources: () => ResourceManifest,
  ) {
    this.revision = getDraft().revision;
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private notify(): void {
    if (!this.disposed) for (const fn of this.listeners) fn();
  }
  private timers(): void {
    if (this.idle) clearTimeout(this.idle);
    if (this.deadline) clearTimeout(this.deadline);
    this.idle = undefined;
    this.deadline = undefined;
  }
  markDirty(): void {
    if (this.disposed) return;
    this.generation++;
    this.dirty = true;
    this.status = "dirty";
    if (this.idle) clearTimeout(this.idle);
    this.idle = setTimeout(() => void this.flush(), 2000);
    this.deadline ??= setTimeout(() => void this.flush(), 10000);
    this.notify();
  }
  async flush(): Promise<SaveResult> {
    if (this.pending) {
      await this.pending;
      if (this.dirty && !this.disposed) return this.flush();
      return this.lastResult!;
    }
    this.timers();
    const doc = structuredClone(this.getDraft()),
      resources = structuredClone(this.getResources()),
      generation = this.generation;
    this.dirty = false;
    this.status = "saving";
    this.notify();
    this.pending = (async () => {
      let result: SaveResult;
      try {
        result = await this.store.save(doc, this.revision, resources);
      } catch {
        result = { ok: false, code: "STORAGE_FAILED", recoveryDraft: doc };
      }
      this.lastResult = result;
      if (result.ok) {
        this.revision = result.value.doc.revision;
        this.status = this.generation === generation ? "saved" : "dirty";
      } else
        this.status =
          result.code === "REVISION_CONFLICT" ? "conflict" : "error";
      this.notify();
      return result;
    })();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
  dispose(): void {
    this.disposed = true;
    this.timers();
    this.listeners.clear();
  }
}
