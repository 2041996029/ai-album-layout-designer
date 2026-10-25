import { createServer, request as httpRequest } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, basename, extname } from "node:path";
import type { AddressInfo } from "node:net";

/** Real loopback HTTP: built UI and API share an origin without Playwright routes. */
export async function commerceHttpOrigin() {
  let apiOrigin = "",
    probeForwarded = false,
    closing = false;
  let enterProbe!: () => void, releaseProbe!: () => void;
  const probeEntered = new Promise<void>((r) => {
    enterProbe = r;
  });
  const probeGate = new Promise<void>((r) => {
    releaseProbe = r;
  });
  const pending = new Set<Promise<void>>(),
    errors: unknown[] = [];
  const directory = resolve("apps/web/dist");
  const server = createServer((req, res) => {
    const work = (async () => {
      if (closing) {
        res.writeHead(503, { connection: "close" });
        res.end();
        return;
      }
      const url = new URL(req.url!, "http://fixture.invalid");
      if (url.pathname.startsWith("/v1/")) {
        const probe = req.headers["x-teardown-probe"] === "1";
        if (probe) {
          enterProbe();
          await probeGate;
        }
        if (!apiOrigin) throw Error("FIXTURE_API_NOT_READY");
        await new Promise<void>((resolveRequest, reject) => {
          const upstream = httpRequest(
            new URL(req.url!, apiOrigin),
            {
              method: req.method,
              headers: { ...req.headers, host: new URL(apiOrigin).host },
            },
            (response) => {
              if (probe) {
                if (response.statusCode !== 200) {
                  reject(Error(`PROBE_STATUS_${response.statusCode}`));
                  response.resume();
                  return;
                }
                probeForwarded = true;
              }
              res.writeHead(response.statusCode!, response.headers);
              response.on("error", reject);
              response.pipe(res);
            },
          );
          upstream.on("error", reject);
          res.on("finish", resolveRequest);
          req.on("error", reject);
          req.pipe(upstream);
        });
        return;
      }
      // Only the built commerce entry and its emitted flat assets are served.
      const name =
        url.pathname === "/commerce.html"
          ? "commerce.html"
          : url.pathname.startsWith("/assets/") &&
              basename(url.pathname) === url.pathname.slice(8)
            ? "assets/" + basename(url.pathname)
            : "";
      if (!name) {
        res.writeHead(404);
        res.end();
        return;
      }
      const content = await readFile(resolve(directory, name));
      const mime =
        (
          {
            ".html": "text/html",
            ".js": "application/javascript",
            ".css": "text/css",
            ".woff2": "font/woff2",
            ".svg": "image/svg+xml",
            ".png": "image/png",
          } as Record<string, string>
        )[extname(name)] ?? "application/octet-stream";
      res.writeHead(200, { "content-type": mime });
      res.end(content);
    })();
    pending.add(work);
    void work.then(
      () => {
        pending.delete(work);
      },
      (error) => {
        pending.delete(work);
        errors.push(error);
        res.destroy(error as Error);
      },
    );
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  let stopping: Promise<void> | undefined;
  return {
    origin,
    bindApi(value: string) {
      apiOrigin = value;
    },
    probe: {
      entered: probeEntered,
      release: releaseProbe,
      forwarded: () => probeForwarded,
    },
    stop() {
      return (stopping ??= (async () => {
        // Stop accepting connections, let actual HTTP responses finish, then
        // surface every forwarding error before the API/database may close.
        closing = true;
        const closed = new Promise<void>((resolveClose, reject) =>
          server.close((error) => (error ? reject(error) : resolveClose())),
        );
        while (pending.size) await Promise.allSettled([...pending]);
        // A response that was active at close() can become keep-alive idle
        // afterwards. Close those now, after response forwarding has drained.
        server.closeIdleConnections();
        await closed;
        if (errors.length)
          throw new AggregateError(errors, "COMMERCE_HTTP_TRANSPORT_FAILED");
      })());
    },
  };
}
