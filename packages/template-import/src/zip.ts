import { Unzip, UnzipInflate } from "fflate";
import type { ImportLimits } from "./types";
export const DEFAULT_IMPORT_LIMITS: ImportLimits = {
  compressedBytes: 256 * 1024 ** 2,
  expandedBytes: 512 * 1024 ** 2,
  entryBytes: 64 * 1024 ** 2,
  entries: 10000,
  pages: 50,
  layers: 100,
  fonts: 20,
};
const fail = (): never => {
  throw new Error("Invalid or unsafe MJTPL ZIP");
};
export function readMjtplZip(
  bytes: Uint8Array,
  limits: ImportLimits,
  signal: AbortSignal,
): Map<string, Uint8Array> {
  signal.throwIfAborted();
  if (bytes.length < 22 || bytes.length > limits.compressedBytes) fail();
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length),
    decoder = new TextDecoder("utf-8", { fatal: true });
  let end = -1;
  for (let p = bytes.length - 22; p >= Math.max(0, bytes.length - 65557); p--)
    if (
      v.getUint32(p, true) === 0x06054b50 &&
      p + 22 + v.getUint16(p + 20, true) === bytes.length
    ) {
      end = p;
      break;
    }
  if (end < 0 || v.getUint16(end + 4, true) || v.getUint16(end + 6, true))
    fail();
  const count = v.getUint16(end + 10, true),
    start = v.getUint32(end + 16, true);
  if (
    count === 65535 ||
    count > limits.entries ||
    count !== v.getUint16(end + 8, true) ||
    start + v.getUint32(end + 12, true) !== end
  )
    fail();
  const expected = new Map<string, { size: number; crc: number }>();
  let p = start,
    total = 0;
  const regions: { start: number; end: number }[] = [];
  for (let i = 0; i < count; i++) {
    signal.throwIfAborted();
    if (p + 46 > end || v.getUint32(p, true) !== 0x02014b50) fail();
    const flags = v.getUint16(p + 8, true),
      method = v.getUint16(p + 10, true),
      compressed = v.getUint32(p + 20, true),
      size = v.getUint32(p + 24, true),
      len = v.getUint16(p + 28, true),
      extra = v.getUint16(p + 30, true),
      comment = v.getUint16(p + 32, true),
      local = v.getUint32(p + 42, true),
      crc = v.getUint32(p + 16, true);
    if (
      p + 46 + len + extra + comment > end ||
      flags & ~0x080e ||
      ![0, 8].includes(method) ||
      size === 0xffffffff ||
      compressed === 0xffffffff ||
      local + 30 > start ||
      ((v.getUint32(p + 38, true) >>> 16) & 0xf000) === 0xa000
    )
      fail();
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + len));
    if (
      !name ||
      name.includes("\\") ||
      name.includes("\0") ||
      name.startsWith("/") ||
      name.includes(":") ||
      name.split("/").some((x) => x === ".." || x === "." || !x) ||
      expected.has(name) ||
      size > limits.entryBytes ||
      (total += size) > limits.expandedBytes
    )
      fail();
    for (let e = p + 46 + len; e < p + 46 + len + extra;) {
      if (e + 4 > p + 46 + len + extra) fail();
      const id = v.getUint16(e, true),
        n = v.getUint16(e + 2, true);
      if (id === 1 || e + 4 + n > p + 46 + len + extra) fail();
      e += 4 + n;
    }
    if (
      v.getUint32(local, true) !== 0x04034b50 ||
      v.getUint16(local + 6, true) !== flags ||
      v.getUint16(local + 8, true) !== method
    )
      fail();
    const ll = v.getUint16(local + 26, true),
      le = v.getUint16(local + 28, true),
      data = local + 30 + ll + le;
    if (
      data + compressed > start ||
      decoder.decode(bytes.subarray(local + 30, local + 30 + ll)) !== name
    )
      fail();
    if (
      !(flags & 8) &&
      (v.getUint32(local + 14, true) !== crc ||
        v.getUint32(local + 18, true) !== compressed ||
        v.getUint32(local + 22, true) !== size)
    )
      fail();
    for (let e = local + 30 + ll; e < data;) {
      if (e + 4 > data) fail();
      const id = v.getUint16(e, true),
        n = v.getUint16(e + 2, true);
      if (id === 1 || e + 4 + n > data) fail();
      e += 4 + n;
    }
    let regionEnd = data + compressed;
    if (flags & 8) {
      if (
        ![0, crc].includes(v.getUint32(local + 14, true)) ||
        ![0, compressed].includes(v.getUint32(local + 18, true)) ||
        ![0, size].includes(v.getUint32(local + 22, true))
      )
        fail();
      let d = regionEnd;
      if (d + 12 > start) fail();
      if (v.getUint32(d, true) === 0x08074b50) d += 4;
      if (
        d + 12 > start ||
        v.getUint32(d, true) !== crc ||
        v.getUint32(d + 4, true) !== compressed ||
        v.getUint32(d + 8, true) !== size
      )
        fail();
      regionEnd = d + 12;
    }
    regions.push({ start: local, end: regionEnd });
    expected.set(name, { size, crc });
    p += 46 + len + extra + comment;
  }
  if (p !== end) fail();
  regions.sort((a, b) => a.start - b.start);
  for (let i = 1; i < regions.length; i++)
    if (regions[i].start < regions[i - 1].end) fail();
  const files = new Map<string, Uint8Array>(),
    seen = new Set<string>();
  total = 0;
  const unzip = new Unzip((file) => {
    const found = expected.get(file.name);
    if (!found || seen.has(file.name)) fail();
    const exp = found!;
    seen.add(file.name);
    const chunks: Uint8Array[] = [];
    let length = 0;
    file.ondata = (error, data, final) => {
      signal.throwIfAborted();
      if (error) throw error;
      length += data.length;
      total += data.length;
      if (
        length > exp.size ||
        length > limits.entryBytes ||
        total > limits.expandedBytes
      ) {
        file.terminate();
        fail();
      }
      chunks.push(data);
      if (final) {
        if (length !== exp.size) fail();
        const output = new Uint8Array(length);
        let at = 0;
        for (const c of chunks) {
          output.set(c, at);
          at += c.length;
        }
        if (crc32(output) !== exp.crc) fail();
        files.set(file.name, output);
      }
    };
    file.start();
  });
  unzip.register(UnzipInflate);
  for (let p = 0; p < bytes.length; p += 4096) {
    signal.throwIfAborted();
    unzip.push(bytes.subarray(p, p + 4096), p + 4096 >= bytes.length);
  }
  if (files.size !== expected.size) fail();
  return files;
}
const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  return c >>> 0;
});
function crc32(bytes: Uint8Array): number {
  let crc = -1;
  for (const b of bytes) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ b) & 255];
  return (crc ^ -1) >>> 0;
}
