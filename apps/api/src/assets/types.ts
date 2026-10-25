import type { Actor, Database } from "@album/server-core";
import type { PoolClient } from "pg";
export interface StorageLocator {
  storageProfileId: string;
  profileVersion: number;
  bucket: string;
  key: string;
  objectVersionId: string | null;
  sha256: string;
  variant: string;
}
export interface ObjectStore {
  put(locator: StorageLocator, bytes: Uint8Array): Promise<void>;
  read(locator: StorageLocator, signal?: AbortSignal): Promise<Uint8Array>;
  head(locator: StorageLocator): Promise<{ bytes: number; sha256: string }>;
  remove(locator: StorageLocator): Promise<void>;
  sign(
    locator: StorageLocator,
    mode: "upload" | "download",
    ttlSeconds: number,
  ): Promise<string>;
}
export interface QuotaPolicyPort {
  readQuota(workspaceId: string): Promise<{
    limitBytes: number;
    maxProjectPhotos: number;
    projectLimit?: number;
  }>;
}
export interface WorkspaceAuthorization {
  authorize(
    actor: Actor,
    wid: string,
    action: "read" | "manageAssets" | "deleteAssets" | "manageSettings",
    tx?: PoolClient,
  ): Promise<unknown>;
}
export interface StorageConfig {
  profileVersionId: string;
  storageProfileId: string;
  profileVersion: number;
  bucket: string;
  basePrefix: string;
  uploadTtlSeconds?: number;
  downloadTtlSeconds?: number;
}
export type { Database, Actor };
