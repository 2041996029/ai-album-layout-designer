import { test, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { parseMjtpl, readMjtplZip, DEFAULT_IMPORT_LIMITS } from "./index";
test("rejects unsafe and oversized ZIP entries before expanding", () => {
  for (const path of ["../x", "/x", "a\\b"])
    expect(() =>
      readMjtplZip(
        zipSync({ [path]: strToU8("x") }),
        DEFAULT_IMPORT_LIMITS,
        new AbortController().signal,
      ),
    ).toThrow();
  expect(() =>
    readMjtplZip(
      zipSync({ x: new Uint8Array(100) }),
      { ...DEFAULT_IMPORT_LIMITS, entryBytes: 50 },
      new AbortController().signal,
    ),
  ).toThrow();
});
test("cancellation and unsupported manifest fail", async () => {
  const c = new AbortController();
  c.abort();
  await expect(
    parseMjtpl(zipSync({ "manifest.json": strToU8("{}") }), c.signal),
  ).rejects.toThrow();
  await expect(
    parseMjtpl(
      zipSync({ "manifest.json": strToU8("{}") }),
      new AbortController().signal,
    ),
  ).rejects.toThrow();
});
import { buildMjtpl } from "../../../tests/fixtures/mjtpl/build";
test("checks every reference and integrity hash", async () => {
  const f = await buildMjtpl(),
    s = new AbortController().signal;
  expect((await parseMjtpl(f.bytes, s)).scenes).toHaveLength(1);
  f.manifest.pages[0].sceneHash = "0".repeat(64);
  f.files["manifest.json"] = strToU8(JSON.stringify(f.manifest));
  await expect(parseMjtpl(zipSync(f.files), s)).rejects.toThrow("hash");
});
test("rejects central/local mismatch, symlink, encryption, ZIP64 and corrupt CRC", () => {
  const good = zipSync(
      { a: strToU8("hello"), b: strToU8("world") },
      { level: 0 },
    ),
    signal = new AbortController().signal;
  const central = (b: Uint8Array) => {
    const v = new DataView(b.buffer);
    for (let p = 0; p + 4 < b.length; p++)
      if (v.getUint32(p, true) === 0x02014b50) return p;
    throw Error("No central directory");
  };
  for (const mutate of [
    (b: Uint8Array, v: DataView, p: number) => v.setUint16(p + 8, 1, true),
    (b: Uint8Array, v: DataView, p: number) =>
      v.setUint32(p + 38, 0xa0000000, true),
    (b: Uint8Array, v: DataView, p: number) =>
      v.setUint32(p + 24, 0xffffffff, true),
    (b: Uint8Array, v: DataView) => v.setUint16(8, 8, true),
    (b: Uint8Array, v: DataView) => v.setUint32(22, 99, true),
    (b: Uint8Array) => {
      b[31] ^= 1;
    },
    (b: Uint8Array, v: DataView, p: number) => {
      b[p + 46] = 98;
    },
  ]) {
    const b = good.slice(),
      v = new DataView(b.buffer);
    mutate(b, v, central(b));
    expect(() => readMjtplZip(b, DEFAULT_IMPORT_LIMITS, signal)).toThrow();
  }
});
test("accepts a valid stored ZIP above legacy 32MiB limit", () => {
  const payload = new Uint8Array(33 * 1024 ** 2),
    bytes = zipSync({ "large.bin": payload }, { level: 0 });
  expect(
    readMjtplZip(
      bytes,
      DEFAULT_IMPORT_LIMITS,
      new AbortController().signal,
    ).get("large.bin")?.length,
  ).toBe(payload.length);
});
test("rejects duplicate page/slot identity, missing files and unsupported dimensions/version", async () => {
  for (const mutate of [
    (f: Awaited<ReturnType<typeof buildMjtpl>>) => {
      f.manifest.pages.push(f.manifest.pages[0]);
    },
    (f: Awaited<ReturnType<typeof buildMjtpl>>) => {
      f.manifest.pages[0].width = Infinity;
    },
    (f: Awaited<ReturnType<typeof buildMjtpl>>) => {
      f.manifest.formatVersion = 2;
    },
    (f: Awaited<ReturnType<typeof buildMjtpl>>) => {
      delete f.files["assets/image.bin"];
    },
  ]) {
    const f = await buildMjtpl();
    mutate(f);
    f.files["manifest.json"] = strToU8(JSON.stringify(f.manifest));
    await expect(
      parseMjtpl(zipSync(f.files), new AbortController().signal),
    ).rejects.toThrow();
  }
  const f = await buildMjtpl();
  f.scene.nodes.push({ ...f.scene.nodes[0], id: "second" });
  f.files["pages/scene.json"] = strToU8(JSON.stringify(f.scene));
  f.manifest.pages[0].sceneHash = await sha256(f.files["pages/scene.json"]);
  f.files["manifest.json"] = strToU8(JSON.stringify(f.manifest));
  await expect(
    parseMjtpl(zipSync(f.files), new AbortController().signal),
  ).rejects.toThrow("Duplicate slot");
});
import { sha256 } from "@album/document";
