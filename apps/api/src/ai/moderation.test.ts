import { it, expect } from "vitest";
import { OpenAIModerationAdapter } from "./moderation";
it("moderation fails closed on transport errors and malformed responses", async () => {
  for (const request of [
    async () => {
      throw Error("timeout");
    },
    async () => Buffer.from("{}"),
  ]) {
    const adapter = new OpenAIModerationAdapter({
      policies: {
        "p@1": {
          endpoint: "https://moderation.example.com/v1",
          model: "moderation",
          readSecret: async () => "private",
        },
      },
      allowedHosts: ["moderation.example.com"],
      request,
    });
    expect((await adapter.review(new Uint8Array([1]), "p@1")).state).toBe(
      "review",
    );
  }
});
it("only the pinned moderation policy can approve an output", async () => {
  const adapter = new OpenAIModerationAdapter({
    policies: {
      "p@1": {
        endpoint: "https://moderation.example.com/v1",
        model: "moderation",
        readSecret: async () => "private",
      },
    },
    allowedHosts: ["moderation.example.com"],
    request: async () => Buffer.from('{"results":[{"flagged":false}]}'),
  });
  expect(await adapter.review(new Uint8Array([1]), "p@1")).toMatchObject({
    state: "approved",
    policyVersion: "p@1",
  });
  await expect(adapter.review(new Uint8Array([1]), "p@2")).rejects.toThrow(
    "MODERATION_UNCONFIGURED",
  );
});
