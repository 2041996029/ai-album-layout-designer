import { it, expect } from "vitest";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  rmSync,
  statSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
it("checks manifest freshness without modifying matching or stale output", () => {
  const dir = mkdtempSync(join(tmpdir(), "album-filter-check-")),
    file = join(dir, "manifest.json");
  const run = () =>
    spawnSync(
      process.execPath,
      [
        "--import",
        "tsx",
        "scripts/build-filter-manifest.ts",
        "--check",
        "--output",
        file,
      ],
      { encoding: "utf8" },
    );
  try {
    expect(run().status).not.toBe(0);
    expect(existsSync(file)).toBe(false);
    writeFileSync(
      file,
      readFileSync("packages/render/manifests/filters-v1.json"),
    );
    const time = statSync(file).mtimeMs;
    expect(run().status).toBe(0);
    expect(statSync(file).mtimeMs).toBe(time);
    writeFileSync(file, '{"stale":true}');
    expect(run().status).not.toBe(0);
    expect(readFileSync(file, "utf8")).toBe('{"stale":true}');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
