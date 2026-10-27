import { it, expect } from "vitest";
import { CosObjectStore } from "./cos";
import { createHash } from "node:crypto";
it("writes private COS objects, validates bytes/hash and pins versioned reads and signed operations", async () => {
  const data = Buffer.from("original"),
    sha = createHash("sha256").update(data).digest("hex");
  let put: any, read: any, signature: any;
  const sdk: any = {
    putObject: async (p: any) => {
      put = p;
      return {};
    },
    headObject: async () => ({
      headers: { "content-length": String(data.length) },
    }),
    getObject: async (p: any) => {
      read = p;
      p.Output.end(data);
      return {};
    },
    deleteObject: async () => ({}),
    getObjectUrl: (p: any) => {
      signature = p;
      return "https://album-123.cos.ap-shanghai.myqcloud.com/objects/a?temporary";
    },
  };
  const store = new CosObjectStore({
    bucket: "album-123",
    region: "ap-shanghai",
    secretId: "server-id",
    secretKey: "server-key",
    client: sdk,
  });
  const l: any = {
    bucket: "album-123",
    key: "objects/a",
    sha256: sha,
    objectVersionId: "version",
    storageProfileId: "p",
    profileVersion: 1,
    variant: "original",
  };
  await store.put(l, data);
  expect(put.ACL).toBe("private");
  expect(await store.read(l)).toEqual(data);
  expect(read.VersionId).toBe("version");
  expect(await store.head(l)).toEqual({ bytes: data.length, sha256: sha });
  expect(await store.sign(l, "download", 300)).toMatch(/^https:/);
  expect(signature.Method).toBe("GET");
  expect(signature.Query.versionId).toBe("version");
  await expect(
    store.sign({ ...l, bucket: "other" }, "download", 300),
  ).rejects.toThrow("STORAGE_LOCATOR_MISMATCH");
  await expect(
    store.put({ ...l, sha256: "0".repeat(64) }, data),
  ).rejects.toThrow("HASH_MISMATCH");
});
