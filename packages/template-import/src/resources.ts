import type { AssetRecord } from "@album/assets";
import type { MjtplAsset } from "./types";
/** Probe encoded headers; extensions and manifest MIME are untrusted. */
export function imageInfo(bytes: Uint8Array): {
  width: number;
  height: number;
  mimeType: "image/png" | "image/jpeg";
  alpha: boolean;
} {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
  let width = 0,
    height = 0,
    alpha = false,
    mimeType: "image/png" | "image/jpeg" = "image/png";
  if (
    bytes.length >= 33 &&
    v.getUint32(0) === 0x89504e47 &&
    v.getUint32(4) === 0x0d0a1a0a &&
    v.getUint32(12) === 0x49484452
  ) {
    width = v.getUint32(16);
    height = v.getUint32(20);
    alpha = [4, 6].includes(bytes[25]);
    for (let p = 8; p + 12 <= bytes.length;) {
      const len = v.getUint32(p);
      if (p + 12 + len > bytes.length) throw Error("Invalid PNG");
      if (v.getUint32(p + 4) === 0x74524e53) alpha = true;
      p += len + 12;
    }
  } else if (bytes[0] === 255 && bytes[1] === 216) {
    mimeType = "image/jpeg";
    let p = 2;
    while (p + 4 <= bytes.length) {
      if (bytes[p++] !== 255) break;
      const m = bytes[p++];
      if (m === 217 || m === 218) break;
      if (m === 255) {
        p--;
        continue;
      }
      if (m === 1 || (m >= 208 && m <= 215)) continue;
      const n = v.getUint16(p);
      if (n < 2 || p + n > bytes.length) throw Error("Invalid JPEG");
      if (m === 225 && n >= 8 && v.getUint32(p + 2) === 0x45786966)
        throw Error(
          "JPEG EXIF requires orientation normalization before import",
        );
      if (
        [
          192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207,
        ].includes(m)
      ) {
        if (n < 8) throw Error("Invalid JPEG frame");
        height = v.getUint16(p + 3);
        width = v.getUint16(p + 5);
        break;
      }
      p += n;
    }
  }
  if (!width || !height || width * height > 80e6)
    throw Error("Unsupported image or image exceeds 80MP");
  return { width, height, mimeType, alpha };
}
export function imageRecord(
  source: MjtplAsset,
  bytes: Uint8Array,
  usage: "decoration" | "text-raster" = "decoration",
): AssetRecord {
  const info = imageInfo(bytes),
    variant = {
      sha256: source.sha256,
      byteLength: bytes.length,
      mimeType: info.mimeType,
      width: info.width,
      height: info.height,
    };
  return {
    id: `mj-${source.sha256}`,
    version: 1,
    sha256: source.sha256,
    width: info.width,
    height: info.height,
    mimeType: info.mimeType,
    usage,
    source: { kind: "import", name: `MJTPL ${source.sha256}` },
    license: { id: "user-local-import", usable: true },
    status: "ready",
    variants: { original: variant, normalized: variant, preview: variant },
  };
}

import { create } from "fontkit";
import { fontRecordHash, type FontRecord } from "@album/assets";
/** Exact embedded faces only; never synthesize weight, slant, coverage or identity. */
export async function embeddedFontRecord(
  source: MjtplAsset,
  bytes: Uint8Array,
): Promise<FontRecord | null> {
  try {
    const parsed = create(bytes as Buffer);
    if (!("characterSet" in parsed)) return null;
    const weight = (parsed as unknown as { "OS/2": { usWeightClass: number } })[
      "OS/2"
    ].usWeightClass;
    if ((weight !== 400 && weight !== 700) || parsed.italicAngle !== 0)
      return null;
    const face = {
      id: `mj-face-${source.sha256}`,
      sha256: source.sha256,
      byteLength: bytes.length,
      file: source.path,
      weight: weight as 400 | 700,
      style: "normal" as const,
      codePoints: [...parsed.characterSet].sort((a, b) => a - b),
    };
    const identity = {
      source: { kind: "import" as const, name: `MJTPL ${source.sha256}` },
      license: { id: "user-local-import", usable: true },
      faces: [face],
    };
    return {
      ...identity,
      id: `mj-font-${source.sha256}`,
      version: 1,
      sha256: await fontRecordHash(identity),
      family: parsed.familyName,
      status: "ready",
    };
  } catch {
    return null;
  }
}
