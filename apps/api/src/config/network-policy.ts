import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { fail } from "@album/server-core";

type Address = { address: string; family: number };
type PolicyPorts = {
  resolve?: (hostname: string) => Promise<Address[]>;
  request?: typeof httpsRequest;
};
const forbidden = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const)
  forbidden.addSubnet(address, prefix, "ipv4");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  forbidden.addSubnet(address, prefix, "ipv6");
const global6 = new BlockList();
global6.addSubnet("2000::", 3, "ipv6");
function approvedAddress(value: Address): boolean {
  const family = isIP(value.address);
  return (
    family === value.family &&
    (family === 4
      ? !forbidden.check(value.address, "ipv4")
      : family === 6 &&
        global6.check(value.address, "ipv6") &&
        !forbidden.check(value.address, "ipv6"))
  );
}
function checkedUrl(raw: string, allowedHosts: string[]): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    fail("ENDPOINT_FORBIDDEN", 422);
  }
  const host = url.hostname.toLowerCase();
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.hash ||
    (url.port && url.port !== "443") ||
    !host ||
    host.endsWith(".") ||
    isIP(host.replace(/^\[|\]$/g, "")) ||
    !allowedHosts.some(
      (approved) => approved === host && /^[a-z0-9.-]+$/.test(approved),
    )
  )
    fail("ENDPOINT_FORBIDDEN", 422);
  return url;
}
export function createNetworkPolicy(ports: PolicyPorts = {}) {
  const resolve =
    ports.resolve ??
    ((hostname) => lookup(hostname, { all: true, verbatim: true }));
  const request = ports.request ?? httpsRequest;
  async function addresses(raw: string, allowedHosts: string[]) {
    const url = checkedUrl(raw, allowedHosts);
    let resolved: Address[];
    try {
      resolved = await resolve(url.hostname);
    } catch {
      fail("ENDPOINT_FORBIDDEN", 422);
    }
    if (!resolved.length || resolved.some((a) => !approvedAddress(a)))
      fail("ENDPOINT_FORBIDDEN", 422);
    return { url, resolved };
  }
  async function assertApprovedHttps(
    url: string,
    allowedHosts: string[],
  ): Promise<void> {
    await addresses(url, allowedHosts);
  }
  async function fetchApprovedHttps(
    raw: string,
    init: RequestInit,
    allowedHosts: string[],
    limits: { maxBytes: number; timeoutMs: number },
  ): Promise<Uint8Array> {
    if (
      !Number.isSafeInteger(limits.maxBytes) ||
      limits.maxBytes < 1 ||
      !Number.isSafeInteger(limits.timeoutMs) ||
      limits.timeoutMs < 1
    )
      fail("ENDPOINT_LIMITS_INVALID", 422);
    const deadline = Date.now() + limits.timeoutMs;
    const controller = new AbortController();
    const abort = () => controller.abort();
    init.signal?.addEventListener("abort", abort, { once: true });
    if (init.signal?.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
    let method = (init.method ?? "GET").toUpperCase();
    const body = init.body;
    if (
      body !== undefined &&
      body !== null &&
      typeof body !== "string" &&
      !(body instanceof Uint8Array) &&
      !(body instanceof URLSearchParams)
    ) {
      clearTimeout(timer);
      fail("ENDPOINT_BODY_UNSUPPORTED", 422);
    }
    let headers = new Headers(init.headers);
    // Host/SNI always derive from the approved URL, never caller headers.
    for (const name of [
      "host",
      "connection",
      "transfer-encoding",
      "content-length",
    ])
      headers.delete(name);
    try {
      for (let redirects = 0; redirects <= 5; redirects++) {
        if (controller.signal.aborted || Date.now() >= deadline)
          fail("ENDPOINT_TIMEOUT", 504);
        // Bound DNS too; a slow resolver cannot outlive the overall request deadline.
        const { url, resolved } = await new Promise<
          Awaited<ReturnType<typeof addresses>>
        >((done, reject) => {
          const aborted = () => reject(Error("ENDPOINT_TIMEOUT"));
          controller.signal.addEventListener("abort", aborted, { once: true });
          addresses(raw, allowedHosts)
            .then(done, reject)
            .finally(() =>
              controller.signal.removeEventListener("abort", aborted),
            );
        });
        if (controller.signal.aborted) fail("ENDPOINT_TIMEOUT", 504);
        const pinned = resolved[0];
        const result = await new Promise<{
          bytes?: Uint8Array;
          location?: string;
        }>((done, reject) => {
          const options: RequestOptions = {
            method,
            headers: Object.fromEntries(headers),
            servername: url.hostname,
            rejectUnauthorized: true,
            agent: false,
            signal: controller.signal,
            // No second DNS lookup: TLS connects only to addresses checked above.
            lookup: ((
              _hostname: string,
              lookupOptions: { all?: boolean },
              callback: Function,
            ) => {
              if (lookupOptions.all)
                callback(
                  null,
                  resolved.map((a) => ({
                    address: a.address,
                    family: a.family,
                  })),
                );
              else callback(null, pinned.address, pinned.family);
            }) as RequestOptions["lookup"],
          };
          const req = request(url, options, (response) => {
            const status = response.statusCode ?? 0;
            if ([301, 302, 303, 307, 308].includes(status)) {
              response.resume();
              if (
                !response.headers.location ||
                !["GET", "HEAD"].includes(method)
              ) {
                reject(Error("ENDPOINT_REDIRECT_FORBIDDEN"));
                return;
              }
              done({ location: response.headers.location });
              return;
            }
            if (status < 200 || status >= 300) {
              response.resume();
              reject(Error("ENDPOINT_HTTP_ERROR"));
              return;
            }
            let length = 0;
            const chunks: Buffer[] = [];
            response.on("data", (chunk) => {
              const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
              length += bytes.length;
              if (length > limits.maxBytes) {
                response.destroy();
                reject(Error("ENDPOINT_RESPONSE_TOO_LARGE"));
                return;
              }
              chunks.push(bytes);
            });
            response.on("error", () => reject(Error("ENDPOINT_NETWORK_ERROR")));
            response.on("aborted", () =>
              reject(Error("ENDPOINT_NETWORK_ERROR")),
            );
            response.on("end", () => done({ bytes: Buffer.concat(chunks) }));
          });
          req.on("error", () =>
            reject(
              Error(
                controller.signal.aborted
                  ? "ENDPOINT_TIMEOUT"
                  : "ENDPOINT_NETWORK_ERROR",
              ),
            ),
          );
          req.end(
            body instanceof URLSearchParams
              ? body.toString()
              : (body ?? undefined),
          );
        });
        if (result.bytes) return result.bytes;
        if (redirects === 5) fail("ENDPOINT_REDIRECT_LIMIT", 422);
        const next = new URL(result.location!, url);
        checkedUrl(next.href, allowedHosts);
        if (next.origin !== url.origin) {
          headers = new Headers(headers);
          for (const name of ["authorization", "cookie", "proxy-authorization"])
            headers.delete(name);
        }
        raw = next.href;
        method = method.toUpperCase();
      }
      fail("ENDPOINT_REDIRECT_LIMIT", 422);
    } finally {
      clearTimeout(timer);
      init.signal?.removeEventListener("abort", abort);
    }
    throw Error("ENDPOINT_NETWORK_ERROR");
  }
  return { assertApprovedHttps, fetchApprovedHttps };
}
const policy = createNetworkPolicy();
export const assertApprovedHttps = policy.assertApprovedHttps;
export const fetchApprovedHttps = policy.fetchApprovedHttps;
