import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { randomBytes } from "node:crypto";
import type { ResourceManifest } from "@album/assets";
export async function startHost(
  dist: string,
  resources: ResourceManifest,
  blobs: Map<string, Uint8Array>,
) {
  const token = randomBytes(24).toString("hex"),
    prefix = "/" + token + "/",
    root = resolve(dist),
    lookup = new Map<string, string>();
  for (const a of resources.assets)
    for (const [v, record] of Object.entries(a.variants))
      lookup.set(a.id + "|" + v, record.sha256);
  for (const f of resources.fonts)
    for (const face of f.faces) lookup.set(face.id + "|font", face.sha256);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://127.0.0.1"),
        path = decodeURIComponent(url.pathname);
      if (req.method !== "GET" || !path.startsWith(prefix)) {
        res.writeHead(404).end();
        return;
      }
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (path === prefix + "resource") {
        const hash = lookup.get(
            (url.searchParams.get("id") ?? "") +
              "|" +
              (url.searchParams.get("variant") ?? ""),
          ),
          bytes = hash && blobs.get(hash);
        if (!bytes) {
          res.writeHead(404).end();
          return;
        }
        res.setHeader("Content-Type", "application/octet-stream");
        res.end(bytes);
        return;
      }
      const relative = path.slice(prefix.length) || "render.html",
        file = resolve(root, relative);
      if (
        !file.startsWith(root + sep) ||
        relative.split("/").some((p) => p === ".." || p === ".") ||
        relative.includes("\\")
      ) {
        res.writeHead(404).end();
        return;
      }
      const type: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".css": "text/css",
        ".woff2": "font/woff2",
        ".json": "application/json",
      };
      res.setHeader(
        "Content-Type",
        type[extname(file)] ?? "application/octet-stream",
      );
      res.end(await readFile(file));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("HOST_FAILED");
  return {
    url: `http://127.0.0.1:${address.port}${prefix}render.html`,
    prefix,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      ),
  };
}
