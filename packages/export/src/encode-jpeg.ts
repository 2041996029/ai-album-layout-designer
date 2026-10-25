import { canvasBytes } from "./encode-png";
export function setJpegDensity(bytes: Uint8Array, dpi: number): Uint8Array {
  if (
    bytes[0] !== 255 ||
    bytes[1] !== 216 ||
    !Number.isInteger(dpi) ||
    dpi < 1 ||
    dpi > 65535
  )
    throw new Error("INVALID_JPEG_OR_DPI");
  const jfif = new Uint8Array([
      255,
      224,
      0,
      16,
      74,
      70,
      73,
      70,
      0,
      1,
      1,
      1,
      dpi >>> 8,
      dpi & 255,
      dpi >>> 8,
      dpi & 255,
      0,
      0,
    ]),
    parts = [bytes.slice(0, 2), jfif];
  let offset = 2,
    scan = false;
  while (offset < bytes.length) {
    if (bytes[offset] !== 255 || offset + 4 > bytes.length)
      throw new Error("INVALID_JPEG");
    const marker = bytes[offset + 1];
    if (marker === 0xda) {
      parts.push(bytes.slice(offset));
      scan = true;
      break;
    }
    const length = (bytes[offset + 2] << 8) | bytes[offset + 3],
      end = offset + 2 + length;
    if (length < 2 || end > bytes.length) throw new Error("INVALID_JPEG");
    if (marker !== 0xe0 && marker !== 0xe1)
      parts.push(bytes.slice(offset, end));
    offset = end;
  }
  if (!scan) throw new Error("INVALID_JPEG");
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
export async function encodeJpeg(
  canvas: HTMLCanvasElement,
  dpi: number,
  matte: string,
): Promise<Uint8Array> {
  if (!/^#[0-9a-f]{6}$/i.test(matte)) throw new Error("INVALID_JPEG_MATTE");
  const flat = document.createElement("canvas");
  flat.width = canvas.width;
  flat.height = canvas.height;
  try {
    const ctx = flat.getContext("2d")!;
    ctx.fillStyle = matte;
    ctx.fillRect(0, 0, flat.width, flat.height);
    ctx.drawImage(canvas, 0, 0);
    return setJpegDensity(await canvasBytes(flat, "image/jpeg", 0.95), dpi);
  } finally {
    flat.width = flat.height = 0;
  }
}
