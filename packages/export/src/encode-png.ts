const signature = [137, 80, 78, 71, 13, 10, 26, 10];
function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const b of bytes) {
    crc ^= b;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function setPngDensity(bytes: Uint8Array, dpi: number): Uint8Array {
  if (
    !signature.every((v, i) => bytes[i] === v) ||
    !Number.isInteger(dpi) ||
    dpi < 1 ||
    dpi > 65535
  )
    throw new Error("INVALID_PNG_OR_DPI");
  const parts: Uint8Array[] = [bytes.slice(0, 8)],
    chunk = new Uint8Array(21),
    cv = new DataView(chunk.buffer);
  cv.setUint32(0, 9);
  chunk.set([112, 72, 89, 115], 4);
  cv.setUint32(8, Math.round(dpi / 0.0254));
  cv.setUint32(12, Math.round(dpi / 0.0254));
  chunk[16] = 1;
  cv.setUint32(17, crc32(chunk.subarray(4, 17)));
  let offset = 8,
    inserted = false,
    ended = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("INVALID_PNG");
    const n = new DataView(
        bytes.buffer,
        bytes.byteOffset + offset,
        4,
      ).getUint32(0),
      end = offset + n + 12;
    if (end > bytes.length) throw new Error("INVALID_PNG");
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    if (type !== "pHYs") parts.push(bytes.slice(offset, end));
    if (type === "IHDR") {
      parts.push(chunk);
      inserted = true;
    }
    offset = end;
    if (type === "IEND") {
      ended = true;
      break;
    }
  }
  if (!inserted || !ended || offset !== bytes.length)
    throw new Error("INVALID_PNG");
  const out = new Uint8Array(parts.reduce((n, b) => n + b.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}
export async function canvasBytes(
  canvas: HTMLCanvasElement,
  type: string,
  quality?: number,
): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("ENCODING_FAILED"))),
      type,
      quality,
    ),
  );
  return new Uint8Array(await blob.arrayBuffer());
}
export async function encodePng(
  canvas: HTMLCanvasElement,
  dpi: number,
): Promise<Uint8Array> {
  return setPngDensity(await canvasBytes(canvas, "image/png"), dpi);
}
