import { describe, it, expect } from "vitest";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  rm,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { unzipSync, strFromU8 } from "fflate";
const initializer = resolve("deploy/server-test/init-env.mjs");
const packager = resolve("scripts/package-server-test.mjs");
describe("server upload kit", () => {
  it("initializes private secrets once and preserves origin and credentials on rerun", async () => {
    const dir = await mkdtemp(join(tmpdir(), "album-kit-"));
    try {
      execFileSync(process.execPath, [
        initializer,
        "--directory",
        dir,
        "--origin",
        "https://album.test",
      ]);
      const env = await readFile(join(dir, ".env"), "utf8");
      const secret = await readFile(
        join(dir, ".secrets", "auth_signing"),
        "utf8",
      );
      expect(secret.trim()).toMatch(/^[a-f0-9]{64}$/);
      expect(env).toContain("ALBUM_ORIGIN=https://album.test");
      expect(env).not.toContain(secret.trim());
      expect(
        (await stat(join(dir, ".secrets", "auth_signing"))).mode & 0o777,
      ).toBe(0o600);
      execFileSync(process.execPath, [initializer, "--directory", dir]);
      expect(await readFile(join(dir, ".env"), "utf8")).toBe(env);
      expect(
        await readFile(join(dir, ".secrets", "auth_signing"), "utf8"),
      ).toBe(secret);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  it("packages actual source and deployment files but excludes even tracked runtime secrets", async () => {
    const dir = await mkdtemp(join(tmpdir(), "album-package-"));
    try {
      execFileSync("git", ["init", "-q", dir]);
      for (const [name, value] of Object.entries({
        "package.json": '{"name":"fixture"}',
        ".nvmrc": "24",
        ".gitattributes": "*.csv -text",
        "docs/export-samples/program-c1/pdf/album-r12.pdf": "pdf-baseline",
        "docs/legacy-delivery.pdf": "historical-document",
        "apps/api/backups/customer.sql": "PRIVATE_BACKUP",
        "apps/api/src/main.ts": 'console.log("api")',
        "deploy/server-test/compose.yaml": "services: {}",
        "deploy/server-test/.env.example": "ALBUM_PORT=8080",
        ".env": "SECRET=do-not-package",
        "deploy/server-test/.secrets/auth_signing": "private-signing-value",
        "attachments/credential.md": "private-upload",
      })) {
        await mkdir(join(dir, name, ".."), { recursive: true });
        await writeFile(join(dir, name), value);
      }
      execFileSync("git", ["-C", dir, "add", "."]);
      const out = join(dir, "upload.zip");
      execFileSync(process.execPath, [
        packager,
        "--root",
        dir,
        "--output",
        out,
      ]);
      const entries = unzipSync(await readFile(out));
      expect(entries["HuaNian_SheJi/apps/api/src/main.ts"]).toBeTruthy();
      expect(
        entries["HuaNian_SheJi/deploy/server-test/compose.yaml"],
      ).toBeTruthy();
      expect(
        entries["HuaNian_SheJi/deploy/server-test/.env.example"],
      ).toBeTruthy();
      expect({
        sample:
          !!entries[
            "HuaNian_SheJi/docs/export-samples/program-c1/pdf/album-r12.pdf"
          ],
        nodeVersion: !!entries["HuaNian_SheJi/.nvmrc"],
        attributes: !!entries["HuaNian_SheJi/.gitattributes"],
        backup: !!entries["HuaNian_SheJi/apps/api/backups/customer.sql"],
        legacy: !!entries["HuaNian_SheJi/docs/legacy-delivery.pdf"],
      }).toEqual({
        sample: true,
        nodeVersion: true,
        attributes: true,
        backup: false,
        legacy: false,
      });
      expect(
        Object.keys(entries).some(
          (k) =>
            k.endsWith("/.env") ||
            k.includes("/.secrets/") ||
            k.includes("/attachments/"),
        ),
      ).toBe(false);
      expect(
        strFromU8(entries["HuaNian_SheJi/DEPLOYMENT-MANIFEST.json"]),
      ).toContain("sourceFiles");
      expect(await readFile(out + ".sha256", "utf8")).toMatch(
        /^[a-f0-9]{64}  upload.zip/,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
