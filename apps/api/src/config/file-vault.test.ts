import { it, expect } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSecretVault } from "./file-vault";
it("persists encrypted versioned secrets without plaintext and rejects tampering", async () => {
  const dir = await mkdtemp(join(tmpdir(), "vault-"));
  try {
    const v = new FileSecretVault(
      dir,
      "independent-vault-encryption-key-at-least-thirty-two",
    );
    const b = await v.write(
      "merchant",
      Buffer.from("private-signing-material"),
    );
    expect(
      Buffer.from(await v.read(b.secretRef, b.secretVersion)).toString(),
    ).toBe("private-signing-material");
    const path = join(dir, b.secretRef, b.secretVersion + ".json"),
      raw = await readFile(path, "utf8");
    expect(raw).not.toContain("private-signing-material");
    await writeFile(path, raw.replace(/"cipher":"[^"]+"/, '"cipher":"AAAA"'));
    await expect(v.read(b.secretRef, b.secretVersion)).rejects.toThrow(
      "SECRET_UNAVAILABLE",
    );
    expect(await v.isRevoked("missing", "missing")).toBe(true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
