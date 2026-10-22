import { describe, expect, it } from "vitest";
import { prepareLayout } from "./prepare";
const input = () => ({
  projectId: "project",
  baseRevision: 1,
  photos: ["b", "a", "c"].map((assetId) => ({
    assetId,
    width: 1200,
    height: 800,
  })),
  constraints: {
    spreadCount: 1,
    minPhotosPerSpread: 1,
    maxPhotosPerSpread: 4,
    selectionPolicy: "all" as const,
    duplicatePolicy: "forbid" as const,
    orderPolicy: "user" as "user" | "captureTime",
  },
  templateRef: { id: "travel-v1", version: 1, sha256: "a".repeat(64) },
  algorithmVersion: "local-layout-v1",
  seed: 42,
});
describe("prepareLayout", () => {
  it("preserves explicit order and produces stable policy-bound hashes", async () => {
    const p = await prepareLayout(input());
    expect(p.orderedAssetIds).toEqual(["b", "a", "c"]);
    expect((await prepareLayout(input())).inputHash).toBe(p.inputHash);
    expect((await prepareLayout({ ...input(), seed: 43 })).inputHash).not.toBe(
      p.inputHash,
    );
    expect(
      (await prepareLayout(input(), { ...p.policy, candidateCount: 1 }))
        .inputHash,
    ).not.toBe(p.inputHash);
  });
  it("sorts valid capture times stably, leaving missing times last", async () => {
    const i = input();
    i.constraints.orderPolicy = "captureTime";
    const p = await prepareLayout({
      ...i,
      photos: [
        { assetId: "none", width: 1, height: 1 },
        {
          assetId: "later",
          width: 1,
          height: 1,
          captureTime: "2026-10-22T00:00:00Z",
        },
        {
          assetId: "first",
          width: 1,
          height: 1,
          captureTime: "2026-10-21T00:00:00Z",
        },
        {
          assetId: "tie",
          width: 1,
          height: 1,
          captureTime: "2026-10-21T00:00:00Z",
        },
      ],
    });
    expect(p.orderedAssetIds).toEqual(["first", "tie", "later", "none"]);
  });
  it("rejects duplicate asset IDs without collapsing distinct photos", async () => {
    const i = input();
    await expect(
      prepareLayout({ ...i, photos: [i.photos[0], i.photos[0]] }),
    ).rejects.toThrow("DUPLICATE_PHOTO_ID");
    expect((await prepareLayout(i)).orderedAssetIds).toHaveLength(3);
  });
  it.each([NaN, Infinity, 0, -1, 1.2])(
    "rejects invalid dimensions %s",
    async (width) => {
      const i = input();
      i.photos[0].width = width;
      await expect(prepareLayout(i)).rejects.toThrow("INVALID_DIMENSIONS");
    },
  );
  it("enforces schema bounds and unknown fields", async () => {
    await expect(prepareLayout({ ...input(), seed: -1 })).rejects.toThrow(
      "INVALID_LAYOUT_INPUT",
    );
    await expect(
      prepareLayout({
        ...input(),
        photos: Array.from({ length: 501 }, (_, n) => ({
          assetId: `p${n}`,
          width: 1,
          height: 1,
        })),
      }),
    ).rejects.toThrow("INVALID_LAYOUT_INPUT");
    const privateInput = { ...input(), gps: "private" };
    await expect(prepareLayout(privateInput)).rejects.toThrow(
      "INVALID_LAYOUT_INPUT",
    );
  });
  it("rejects inconsistent constraints and unknown subsets", async () => {
    const i = input();
    await expect(
      prepareLayout({
        ...i,
        constraints: { ...i.constraints, minPhotosPerSpread: 5 },
      }),
    ).rejects.toThrow("INVALID_CAPACITY");
    await expect(
      prepareLayout({
        ...i,
        constraints: { ...i.constraints, requiredAssetIds: ["unknown"] },
      }),
    ).rejects.toThrow("UNKNOWN_PHOTO_ID");
    await expect(
      prepareLayout({
        ...i,
        constraints: {
          ...i.constraints,
          requiredAssetIds: ["a"],
          excludedAssetIds: ["a"],
        },
      }),
    ).rejects.toThrow("CONTRADICTORY_SELECTION");
  });
  it("rejects policy version mismatches and invalid weights", async () => {
    const p = await prepareLayout(input());
    await expect(
      prepareLayout(input(), { ...p.policy, algorithmVersion: "other" }),
    ).rejects.toThrow("POLICY_VERSION_MISMATCH");
    for (const value of [-1, NaN, Infinity])
      await expect(
        prepareLayout(input(), {
          ...p.policy,
          weights: { ...p.policy.weights, subject: value },
        }),
      ).rejects.toThrow("INVALID_POLICY");
    await expect(
      prepareLayout(input(), {
        ...p.policy,
        weights: {
          subject: 0,
          timeline: 0,
          whitespace: 0,
          variety: 0,
          color: 0,
        },
      }),
    ).rejects.toThrow("INVALID_POLICY");
  });
  it("rejects non-JSON input without silently coercing values", async () => {
    const i = input();
    await expect(prepareLayout({ ...i, seed: NaN })).rejects.toThrow(
      "INVALID_LAYOUT_INPUT",
    );
    const malicious = { ...i };
    Object.defineProperty(malicious, "seed", {
      get() {
        throw new Error("GETTER_EXECUTED");
      },
      enumerable: true,
    });
    await expect(prepareLayout(malicious)).rejects.toThrow(
      "INVALID_LAYOUT_INPUT",
    );
  });
  it("captures inputs before await and deeply freezes results", async () => {
    const i = input();
    const pending = prepareLayout(i);
    i.photos[0].assetId = "changed";
    const p = await pending;
    expect(p.input.photos[0].assetId).toBe("b");
    expect(Object.isFrozen(p.input.photos[0])).toBe(true);
    expect(Object.isFrozen(p.policy.weights)).toBe(true);
  });
});
