import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { digest, fail } from "@album/server-core";
import type { ObjectStore, StorageLocator } from "./types";
/** Development adapter. Files are never exposed by a static web server. */
export class LocalObjectStore implements ObjectStore {
  constructor(
    private config: {
      root: string;
      secret: string;
      environment: string;
      baseUrl: string;
    },
  ) {
    if (config.environment !== "dev") fail("DEV_ONLY");
    if (config.secret.length < 32) fail("INVALID_STORAGE_SECRET");
  }
  private path(l: StorageLocator) {
    return join(
      this.config.root,
      digest(
        JSON.stringify([
          l.storageProfileId,
          l.profileVersion,
          l.bucket,
          l.key,
          l.objectVersionId,
        ]),
      ),
    );
  }
  async put(l: StorageLocator, b: Uint8Array) {
    if (digest(b) !== l.sha256) fail("HASH_MISMATCH");
    await mkdir(this.config.root, { recursive: true, mode: 0o700 });
    await writeFile(this.path(l), b, { mode: 0o600, flag: "wx" }).catch(
      async (e) => {
        if (e.code !== "EEXIST") throw e;
        const old = await this.read(l);
        if (digest(old) !== l.sha256) fail("HASH_MISMATCH");
      },
    );
  }
  async read(l: StorageLocator) {
    return new Uint8Array(await readFile(this.path(l)));
  }
  async head(l: StorageLocator) {
    const b = await this.read(l);
    return { bytes: b.length, sha256: digest(b) };
  }
  async remove(l: StorageLocator) {
    await unlink(this.path(l));
  }
  async sign(
    l: StorageLocator,
    mode: "upload" | "download",
    ttlSeconds: number,
  ) {
    if (!Number.isInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 3600)
      fail("INVALID_TTL");
    const payload = Buffer.from(
      JSON.stringify({
        locator: l,
        mode,
        expires: Date.now() + ttlSeconds * 1000,
      }),
    ).toString("base64url");
    const signature = createHmac("sha256", this.config.secret)
      .update(payload)
      .digest("base64url");
    return `${this.config.baseUrl}/v1/dev-objects/${payload}.${signature}`;
  }
  verify(token: string, mode: "upload" | "download"): StorageLocator {
    const [payload, signature] = token.split(".");
    if (!payload || !signature) fail("INVALID_STORAGE_TOKEN", 403);
    const expected = createHmac("sha256", this.config.secret)
      .update(payload)
      .digest();
    const actual = Buffer.from(signature, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected))
      fail("INVALID_STORAGE_TOKEN", 403);
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (data.mode !== mode || data.expires <= Date.now())
      fail("EXPIRED_STORAGE_TOKEN", 403);
    return data.locator;
  }
}
