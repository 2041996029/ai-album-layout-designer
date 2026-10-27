import COS from "cos-nodejs-sdk-v5";
import { Writable } from "node:stream";
import { createHash } from "node:crypto";
import { fail } from "@album/server-core";
import type { ObjectStore, StorageLocator } from "./types";
export class CosObjectStore implements ObjectStore {
  private client: any;
  private maxRead: number;
  constructor(
    private options: {
      bucket: string;
      region: string;
      secretId: string;
      secretKey: string;
      client?: unknown;
      maxReadBytes?: number;
    },
  ) {
    if (
      !/^[a-z0-9-]+-\d+$/.test(options.bucket) ||
      !/^[a-z]{2}-[a-z]+(?:-\d+)?$/.test(options.region) ||
      !options.secretId ||
      !options.secretKey
    )
      fail("COS_CONFIGURATION_REQUIRED", 503);
    this.client =
      options.client ??
      new COS({
        SecretId: options.secretId,
        SecretKey: options.secretKey,
        Protocol: "https:",
      });
    this.maxRead = options.maxReadBytes ?? 536870912;
  }
  private params(l: StorageLocator) {
    if (
      l.bucket !== this.options.bucket ||
      !l.key ||
      l.key.startsWith("/") ||
      l.key.split("/").some((s) => s === ".." || s === ".") ||
      !/^[-a-zA-Z0-9_/\.]+$/.test(l.key)
    )
      fail("STORAGE_LOCATOR_MISMATCH", 422);
    return {
      Bucket: l.bucket,
      Region: this.options.region,
      Key: l.key,
      ...(l.objectVersionId ? { VersionId: l.objectVersionId } : {}),
    };
  }
  async put(l: StorageLocator, bytes: Uint8Array) {
    const p = this.params(l);
    if (createHash("sha256").update(bytes).digest("hex") !== l.sha256)
      fail("HASH_MISMATCH", 422);
    await this.client.putObject({
      ...p,
      Body: Buffer.from(bytes),
      ContentLength: bytes.length,
      ACL: "private",
      "x-cos-meta-sha256": l.sha256,
    });
  }
  async read(l: StorageLocator, signal?: AbortSignal) {
    const p = this.params(l);
    signal?.throwIfAborted();
    const head = await this.client.headObject(p),
      size = Number(head.headers?.["content-length"]);
    if (!Number.isSafeInteger(size) || size < 0 || size > this.maxRead)
      fail("OBJECT_TOO_LARGE", 413);
    const buffers: Buffer[] = [];
    let total = 0;
    const output = new Writable({
      write: (chunk, _encoding, done) => {
        total += chunk.length;
        if (total > this.maxRead || signal?.aborted)
          return done(Error("OBJECT_READ_ABORTED"));
        buffers.push(Buffer.from(chunk));
        done();
      },
    });
    const complete = new Promise<void>((resolve, reject) => {
      output.on("finish", resolve);
      output.on("error", reject);
    });
    const abort = () => output.destroy(Error("OBJECT_READ_ABORTED"));
    signal?.addEventListener("abort", abort, { once: true });
    try {
      await Promise.all([
        this.client.getObject({ ...p, Output: output }),
        complete,
      ]);
      const b = Buffer.concat(buffers);
      if (
        b.length !== size ||
        createHash("sha256").update(b).digest("hex") !== l.sha256
      )
        fail("HASH_MISMATCH", 422);
      return b;
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  async head(l: StorageLocator) {
    const b = await this.read(l);
    return {
      bytes: b.length,
      sha256: createHash("sha256").update(b).digest("hex"),
    };
  }
  async remove(l: StorageLocator) {
    await this.client.deleteObject(this.params(l));
  }
  async sign(
    l: StorageLocator,
    mode: "upload" | "download",
    ttlSeconds: number,
  ) {
    const p = this.params(l);
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600)
      fail("STORAGE_TTL_INVALID", 422);
    const url = this.client.getObjectUrl({
      ...p,
      Method: mode === "upload" ? "PUT" : "GET",
      Sign: true,
      Expires: ttlSeconds,
      Protocol: "https:",
      ...(l.objectVersionId ? { Query: { versionId: l.objectVersionId } } : {}),
    });
    if (typeof url !== "string" || !url.startsWith("https://"))
      fail("STORAGE_SIGNATURE_INVALID", 503);
    return url;
  }
}
