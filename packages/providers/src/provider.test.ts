import { it, expect } from "vitest";
import { ReplayProvider } from "./fake-adapter";
import { ProviderRegistry } from "./registry";
const context: any = {
  connectionVersionId: "connection-v1",
  secretRef: "ref",
  secretVersion: "v1",
  endpoint: "https://images.example.com",
  allowedResultHosts: ["outputs.example.com"],
};
const input: any = {
  operationId: "op1",
  modelVersionId: "m1",
  prompt: "山水",
  width: 1024,
  height: 1024,
  count: 1,
};
it("accepted timeout is unknown and queries original operation without resubmission", async () => {
  const p = new ReplayProvider({ scenario: "accepted_timeout" });
  expect((await p.submit(input, context)).state).toBe("unknown");
  expect(
    (await p.query({ operationId: "op1", providerRequestId: null }, context))
      .state,
  ).toBe("succeeded");
  expect(p.submissions).toBe(1);
  await p.submit(input, context);
  expect(p.submissions).toBe(1);
});
it("capabilities and unsupported parameters are explicit rather than silently dropped", async () => {
  const p = new ReplayProvider({ scenario: "success" });
  expect(p.capabilities.has("textSuggestion")).toBe(false);
  await expect(p.submit({ ...input, seed: 1 }, context)).rejects.toThrow(
    "UNSUPPORTED_PARAMETER",
  );
  await expect(
    p.submit({ ...input, referenceObjectIds: ["photo"] }, context),
  ).rejects.toThrow("UNSUPPORTED_CAPABILITY");
});
it("registry pins an immutable adapter version and refuses unknown adapters", () => {
  const r = new ProviderRegistry(),
    p = new ReplayProvider({ scenario: "success" });
  r.register(p);
  expect(r.get(p.id, p.version)).toBe(p);
  expect(() => r.register(p)).toThrow("PROVIDER_VERSION_IMMUTABLE");
  expect(() => r.get("unknown", "v1")).toThrow("PROVIDER_UNCONFIGURED");
});
