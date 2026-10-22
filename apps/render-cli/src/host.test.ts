import { it, expect } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startHost } from "./host";
it("requires the per-run token and serves only registered resource IDs and dist files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "album-host-"));
  await writeFile(join(directory, "render.html"), "renderer");
  const host = await startHost(directory, { assets: [], fonts: [] }, new Map());
  try {
    expect(await (await fetch(host.url)).text()).toBe("renderer");
    const origin = new URL(host.url).origin;
    for (const path of [
      "/render.html",
      host.prefix + "resource?id=unknown&variant=original",
      host.prefix + "../secret",
      host.prefix + "%2e%2e%2fsecret",
      host.prefix + "file:%2f%2fetc%2fpasswd",
      host.prefix + "https:%2f%2fexample.com",
    ])
      expect((await fetch(origin + path)).status).toBe(404);
  } finally {
    await host.close();
    await rm(directory, { recursive: true, force: true });
  }
});
