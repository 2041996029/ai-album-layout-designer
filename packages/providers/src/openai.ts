import { randomBytes } from "node:crypto";
import { fetchApprovedHttps } from "../../../apps/api/src/config/network-policy";
import {
  checkProviderInput,
  type ProviderAdapter,
  type ProviderCapability,
  type ProviderContext,
  type ProviderInput,
  type QueryResult,
  type SubmitResult,
} from "./types";
type Request = typeof fetchApprovedHttps;
export class OpenAIImagesAdapter implements ProviderAdapter {
  readonly id = "openai-images";
  readonly version = "v1";
  readonly mode = "live" as const;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  constructor(
    private options: {
      allowedEndpointHosts: string[];
      imageToImage?: boolean;
      request?: Request;
    },
  ) {
    this.capabilities = new Set<ProviderCapability>([
      "textToImage",
      ...(options.imageToImage ? ["imageToImage" as const] : []),
    ]);
  }
  async submit(
    input: ProviderInput,
    c: ProviderContext,
  ): Promise<SubmitResult> {
    checkProviderInput(input, this.capabilities);
    if (!c.receipts || !c.readSecret || !c.providerModelId || !c.persistInline)
      throw Error("PROVIDER_CONTEXT_REQUIRED");
    const previous = await c.receipts.read(input.operationId);
    if (previous)
      return previous.state === "unknown"
        ? {
            state: "unknown",
            operationId: input.operationId,
            retryAfterSeconds: previous.retryAfterSeconds,
          }
        : {
            state: "accepted",
            providerRequestId: previous.providerRequestId,
            acceptedAt: new Date().toISOString(),
          };
    const base = new URL(c.endpoint);
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.search ||
      base.hash ||
      !this.options.allowedEndpointHosts.includes(base.hostname)
    )
      throw Error("ENDPOINT_FORBIDDEN");
    const secret = await c.readSecret();
    if (!secret) throw Error("PROVIDER_SECRET_REQUIRED");
    // Durable intent BEFORE a possibly paid external call; uncertain calls are query-only.
    if (!(await c.receipts.claim(input.operationId)))
      return {
        state: "unknown",
        operationId: input.operationId,
        retryAfterSeconds: 15,
      };
    const headers: Record<string, string> = {
      Authorization: "Bearer " + secret,
    };
    let body: string | Uint8Array;
    const edit = !!input.referenceObjectIds?.length;
    if (edit) {
      if (!c.readReference) throw Error("REFERENCE_RESOLVER_REQUIRED");
      const boundary = "album-" + randomBytes(16).toString("hex"),
        parts: Buffer[] = [];
      const field = (name: string, value: string) =>
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
          ),
        );
      for (const [k, v] of Object.entries({
        model: c.providerModelId,
        prompt: input.prompt,
        n: "1",
        size: `${input.width}x${input.height}`,
      }))
        field(k, v);
      for (const id of input.referenceObjectIds!) {
        const r = await c.readReference(id);
        if (
          !["image/png", "image/jpeg"].includes(r.mime) ||
          r.bytes.length > 25000000
        )
          throw Error("REFERENCE_INVALID");
        parts.push(
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="image[]"; filename="reference.${r.mime === "image/png" ? "png" : "jpg"}"\r\nContent-Type: ${r.mime}\r\n\r\n`,
          ),
          Buffer.from(r.bytes),
          Buffer.from("\r\n"),
        );
      }
      parts.push(Buffer.from(`--${boundary}--\r\n`));
      body = Buffer.concat(parts);
      headers["Content-Type"] = "multipart/form-data; boundary=" + boundary;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify({
        model: c.providerModelId,
        prompt: input.prompt,
        n: 1,
        size: `${input.width}x${input.height}`,
      });
    }
    try {
      const raw = await (this.options.request ?? fetchApprovedHttps)(
        c.endpoint.replace(/\/$/, "") +
          (edit ? "/images/edits" : "/images/generations"),
        {
          method: "POST",
          headers,
          body: typeof body === "string" ? body : new Uint8Array(body),
          signal: c.signal,
        },
        this.options.allowedEndpointHosts,
        { maxBytes: 40000000, timeoutMs: 60000 },
      );
      const result = JSON.parse(Buffer.from(raw).toString());
      if (result.error) {
        const rejected: QueryResult = {
          state: "rejected",
          providerRequestId: input.operationId,
          code: "PROVIDER_REJECTED",
          message: "Provider rejected generation",
        };
        await c.receipts.write(input.operationId, rejected);
        return {
          state: "rejected",
          code: rejected.code,
          message: rejected.message,
        };
      }
      if (!Array.isArray(result.data) || result.data.length !== 1)
        throw Error("PROVIDER_OUTPUT_INVALID");
      const output = result.data[0];
      let location: { url: string; sha256?: string };
      if (typeof output.b64_json === "string") {
        const bytes = Buffer.from(output.b64_json, "base64");
        if (!bytes.length || bytes.length > 25000000)
          throw Error("PROVIDER_OUTPUT_INVALID");
        location = await c.persistInline(bytes, "image/png", input.operationId);
      } else if (typeof output.url === "string") {
        const u = new URL(output.url);
        if (
          u.protocol !== "https:" ||
          !c.allowedResultHosts.includes(u.hostname) ||
          u.username ||
          u.password
        )
          throw Error("RESULT_URL_FORBIDDEN");
        location = { url: output.url };
      } else throw Error("PROVIDER_OUTPUT_INVALID");
      await c.receipts.write(input.operationId, {
        state: "succeeded",
        providerRequestId: input.operationId,
        outputs: [{ ...location, mime: "image/png" }],
        costFen: c.estimatedCostFen ?? 0,
      });
      return {
        state: "accepted",
        providerRequestId: input.operationId,
        acceptedAt: new Date().toISOString(),
      };
    } catch {
      return {
        state: "unknown",
        operationId: input.operationId,
        retryAfterSeconds: 15,
      };
    }
  }
  async query(
    id: { operationId: string; providerRequestId: string | null },
    c: ProviderContext,
  ): Promise<QueryResult> {
    if (!c.receipts) throw Error("PROVIDER_RECEIPTS_REQUIRED");
    return (
      (await c.receipts.read(id.operationId)) ?? {
        state: "unknown",
        providerRequestId: id.providerRequestId ?? id.operationId,
        retryAfterSeconds: 15,
      }
    );
  }
  async cancel(
    id: { operationId: string; providerRequestId: string | null },
    c: ProviderContext,
  ) {
    return this.query(id, c);
  }
}
