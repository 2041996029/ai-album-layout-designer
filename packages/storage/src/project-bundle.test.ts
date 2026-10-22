import { it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { readProjectZip } from "./project-bundle";
const basic = () => ({
  "manifest.json": strToU8("{}"),
  "document.json": strToU8("{}"),
});
it("reads stored and deflated JSON entries but refuses paths outside its fixed allowlist", () => {
  for (const level of [0, 6] as const)
    expect(readProjectZip(zipSync(basic(), { level })).size).toBe(2);
  for (const path of [
    "../escape",
    "/absolute",
    "resources/../../file",
    "resources\\escape",
    "https://evil/a",
    "licenses/a.txt",
  ])
    expect(() =>
      readProjectZip(zipSync({ ...basic(), [path]: strToU8("x") })),
    ).toThrow();
});
it("rejects duplicate central directory names before decompressing", () => {
  const bytes = zipSync(basic());
  const view = new DataView(bytes.buffer);
  let found = 0;
  for (let i = 0; i < bytes.length - 46; i++)
    if (view.getUint32(i, true) === 0x02014b50) {
      bytes.set(strToU8("document.json"), i + 46);
      found++;
    }
  expect(found).toBe(2);
  expect(() => readProjectZip(bytes)).toThrow();
});
it("rejects oversized declared output and trailing junk without allocating that output", () => {
  const bytes = zipSync(basic());
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < bytes.length - 46; i++)
    if (view.getUint32(i, true) === 0x02014b50) {
      view.setUint32(i + 24, 1024 ** 3 + 1, true);
      break;
    }
  expect(() => readProjectZip(bytes)).toThrow();
  expect(() =>
    readProjectZip(new Uint8Array([...zipSync(basic()), 1])),
  ).toThrow();
});
