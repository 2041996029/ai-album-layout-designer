import { it, expect } from "vitest";
import { OpenAIImagesAdapter } from "./openai";
const input: any = {
  operationId: "once",
  modelVersionId: "model",
  prompt: "水墨山水",
  width: 1024,
  height: 1024,
  count: 1,
};
it("persists a synchronous response before returning accepted and queries only its receipt", async () => {
  let paid = 0;
  const receipts = new Map();
  const p = new OpenAIImagesAdapter({
    allowedEndpointHosts: ["images.example.com"],
    request: async (_url, init) => {
      paid++;
      expect(new Headers(init.headers).get("Authorization")).toBe(
        "Bearer server-only",
      );
      return Buffer.from(
        JSON.stringify({
          data: [{ b64_json: Buffer.from("image").toString("base64") }],
        }),
      );
    },
  });
  const c: any = {
    endpoint: "https://images.example.com/v1",
    providerModelId: "configured-model",
    readSecret: async () => "server-only",
    receipts: {
      claim: async (k: string) => {
        if (receipts.has(k)) return false;
        receipts.set(k, {
          state: "unknown",
          providerRequestId: k,
          retryAfterSeconds: 15,
        });
        return true;
      },
      read: async (k: string) => receipts.get(k) ?? null,
      write: async (k: string, v: any) => {
        receipts.set(k, v);
      },
    },
    persistInline: async () => ({
      url: "https://private.cos.example.com/result.png",
      sha256: "a".repeat(64),
    }),
    allowedResultHosts: ["private.cos.example.com"],
    estimatedCostFen: 12,
  };
  expect((await p.submit(input, c)).state).toBe("accepted");
  expect(
    (await p.query({ operationId: "once", providerRequestId: null }, c)).state,
  ).toBe("succeeded");
  await p.submit(input, c);
  expect(paid).toBe(1);
  expect(p.capabilities.has("idempotentSubmit")).toBe(false);
});
it("a network timeout remains unknown and never becomes permission to retry paid submit", async () => {
  let count = 0;
  const receipts = new Map();
  const p = new OpenAIImagesAdapter({
    allowedEndpointHosts: ["images.example.com"],
    request: async () => {
      count++;
      throw Error("timeout");
    },
  });
  const c: any = {
    endpoint: "https://images.example.com",
    providerModelId: "m",
    readSecret: async () => "key",
    receipts: {
      claim: async (k: string) => {
        if (receipts.has(k)) return false;
        receipts.set(k, {
          state: "unknown",
          providerRequestId: k,
          retryAfterSeconds: 15,
        });
        return true;
      },
      read: async (k: string) => receipts.get(k) ?? null,
      write: async (k: string, v: any) => {
        receipts.set(k, v);
      },
    },
    persistInline: async () => ({
      url: "https://private.example.com/result",
      sha256: "a".repeat(64),
    }),
  };
  expect((await p.submit(input, c)).state).toBe("unknown");
  expect((await p.submit(input, c)).state).toBe("unknown");
  expect(count).toBe(1);
});
