import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fail } from "@album/server-core";
import type { SecretPort } from "./types";
/** Single-server encrypted vault; only API UID owns this persistent directory. */
export class FileSecretVault implements SecretPort {
  private key: Buffer;
  constructor(
    private root: string,
    secret: string,
  ) {
    if (secret.length < 32) fail("VAULT_SECRET_REQUIRED", 503);
    this.key = createHash("sha256").update(secret).digest();
  }
  private path(ref: string, version: string) {
    if (
      ![ref, version].every((v) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v))
    )
      fail("SECRET_UNAVAILABLE", 503);
    return join(this.root, ref, version + ".json");
  }
  async write(name: string, value: Uint8Array) {
    const version = randomUUID(),
      path = this.path(name, version);
    await mkdir(join(this.root, name), { recursive: true, mode: 0o700 });
    const iv = randomBytes(12),
      c = createCipheriv("aes-256-gcm", this.key, iv);
    c.setAAD(Buffer.from(name + ":" + version));
    const cipher = Buffer.concat([c.update(value), c.final()]);
    await writeFile(
      path,
      JSON.stringify({
        iv: iv.toString("base64"),
        cipher: cipher.toString("base64"),
        tag: c.getAuthTag().toString("base64"),
      }),
      { flag: "wx", mode: 0o600 },
    );
    return { secretRef: name, secretVersion: version };
  }
  async read(ref: string, version: string) {
    const path = this.path(ref, version);
    try {
      const v = JSON.parse(await readFile(path, "utf8")),
        d = createDecipheriv(
          "aes-256-gcm",
          this.key,
          Buffer.from(v.iv, "base64"),
        );
      d.setAAD(Buffer.from(ref + ":" + version));
      d.setAuthTag(Buffer.from(v.tag, "base64"));
      return Buffer.concat([
        d.update(Buffer.from(v.cipher, "base64")),
        d.final(),
      ]);
    } catch {
      fail("SECRET_UNAVAILABLE", 503);
    }
  }
  async isRevoked(ref: string, version: string) {
    try {
      await this.read(ref, version);
      return false;
    } catch {
      return true;
    }
  }
}
