import { fail } from "@album/server-core";
import type { ObjectStore, StorageLocator } from "./types";
/** Frozen profile versions route legacy objects to their original provider. */
export class RoutingObjectStore implements ObjectStore {
  private stores = new Map<string, ObjectStore>();
  register(profileId: string, version: number, store: ObjectStore) {
    const key = profileId + ":" + version;
    if (this.stores.has(key)) fail("STORAGE_PROFILE_IMMUTABLE", 409);
    this.stores.set(key, store);
  }
  private store(l: StorageLocator) {
    const s = this.stores.get(l.storageProfileId + ":" + l.profileVersion);
    if (!s) fail("STORAGE_PROFILE_UNAVAILABLE", 503);
    return s;
  }
  put(l: StorageLocator, b: Uint8Array) {
    return this.store(l).put(l, b);
  }
  read(l: StorageLocator, s?: AbortSignal) {
    return this.store(l).read(l, s);
  }
  head(l: StorageLocator) {
    return this.store(l).head(l);
  }
  remove(l: StorageLocator) {
    return this.store(l).remove(l);
  }
  sign(l: StorageLocator, m: "upload" | "download", t: number) {
    return this.store(l).sign(l, m, t);
  }
}
