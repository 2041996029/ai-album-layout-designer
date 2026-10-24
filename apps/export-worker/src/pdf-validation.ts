import { inflateSync } from "node:zlib";
import sharp from "sharp";
import {
  PDFDocument,
  PDFDict,
  PDFName,
  PDFRawStream,
  PDFNumber,
  PDFArray,
} from "pdf-lib";
import type { SurfaceSpec } from "@album/export";
import { digest, fail } from "@album/server-core";
type Matrix = [number, number, number, number, number, number];
export type PdfBrand = {
  pixels: Uint8Array;
  x: number;
  y: number;
  width: number;
  height: number;
};
const identity: Matrix = [1, 0, 0, 1, 0, 0];
const multiply = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[2] * b[1],
  a[1] * b[0] + a[3] * b[1],
  a[0] * b[2] + a[2] * b[3],
  a[1] * b[2] + a[3] * b[3],
  a[0] * b[4] + a[2] * b[5] + a[4],
  a[1] * b[4] + a[3] * b[5] + a[5],
];
const close = (a: number, b: number) => Math.abs(a - b) < 0.0001;
function decoded(stream: PDFRawStream, maximum: number, mask = false) {
  const decode = stream.dict.get(PDFName.of("Decode"));
  const identityDecode =
    decode instanceof PDFArray &&
    decode.size() === 2 &&
    decode.lookup(0, PDFNumber).asNumber() === 0 &&
    decode.lookup(1, PDFNumber).asNumber() === 1;
  if (
    stream.dict.get(PDFName.of("Filter")) !== PDFName.of("FlateDecode") ||
    stream.dict.has(PDFName.of("DecodeParms")) ||
    (decode && !(mask && identityDecode))
  )
    fail("ARTIFACT_INVALID");
  const bytes = inflateSync(stream.contents, { maxOutputLength: maximum });
  if (bytes.length !== maximum) fail("ARTIFACT_INVALID");
  return bytes;
}
/** Restricted C1 raster PDF grammar: balanced graphics state, concatenated matrices and image paints only. */
function painted(content: string) {
  const regex =
    /\/[A-Za-z0-9_-]+|[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z]+/g;
  const tokens = [...content.matchAll(regex)];
  let end = 0,
    matrix: Matrix = [...identity];
  const stack: Matrix[] = [],
    operands: (number | string)[] = [],
    result: { name: string; matrix: Matrix }[] = [];
  for (const match of tokens) {
    if (content.slice(end, match.index).trim()) fail("ARTIFACT_INVALID");
    end = match.index! + match[0].length;
    const value = match[0];
    if (value.startsWith("/")) operands.push(value.slice(1));
    else if (Number.isFinite(Number(value))) operands.push(Number(value));
    else if (value === "q" && !operands.length) {
      if (stack.length >= 32) fail("ARTIFACT_INVALID");
      stack.push([...matrix]);
    } else if (value === "Q" && !operands.length) {
      const previous = stack.pop();
      if (!previous) fail("ARTIFACT_INVALID");
      matrix = previous;
    } else if (
      value === "cm" &&
      operands.length === 6 &&
      operands.every((x) => typeof x === "number")
    ) {
      matrix = multiply(matrix, operands.splice(0) as Matrix);
    } else if (
      value === "Do" &&
      operands.length === 1 &&
      typeof operands[0] === "string"
    ) {
      result.push({ name: operands.pop() as string, matrix: [...matrix] });
    } else fail("ARTIFACT_INVALID");
  }
  if (content.slice(end).trim() || stack.length || operands.length)
    fail("ARTIFACT_INVALID");
  return result;
}
async function pixels(png: Uint8Array, width: number, height: number) {
  const { data, info } = await sharp(png, { limitInputPixels: 50_000_000 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.width !== width || info.height !== height || info.channels !== 4)
    fail("ARTIFACT_INVALID");
  return data;
}
function imagePixels(
  pdf: PDFDocument,
  stream: PDFRawStream,
  width: number,
  height: number,
) {
  const d = stream.dict;
  if (
    d.get(PDFName.of("Subtype")) !== PDFName.of("Image") ||
    d.get(PDFName.of("ColorSpace")) !== PDFName.of("DeviceRGB") ||
    d.lookup(PDFName.of("Width"), PDFNumber).asNumber() !== width ||
    d.lookup(PDFName.of("Height"), PDFNumber).asNumber() !== height ||
    d.lookup(PDFName.of("BitsPerComponent"), PDFNumber).asNumber() !== 8 ||
    d.has(PDFName.of("ImageMask")) ||
    d.has(PDFName.of("Mask"))
  )
    fail("ARTIFACT_INVALID");
  const rgb = decoded(stream, width * height * 3);
  let alpha: Uint8Array | undefined;
  const mask = d.get(PDFName.of("SMask"));
  if (mask) {
    const gray = pdf.context.lookup(mask);
    if (
      !(gray instanceof PDFRawStream) ||
      gray.dict.get(PDFName.of("ColorSpace")) !== PDFName.of("DeviceGray") ||
      gray.dict.lookup(PDFName.of("Width"), PDFNumber).asNumber() !== width ||
      gray.dict.lookup(PDFName.of("Height"), PDFNumber).asNumber() !== height ||
      gray.dict.lookup(PDFName.of("BitsPerComponent"), PDFNumber).asNumber() !==
        8
    )
      fail("ARTIFACT_INVALID");
    alpha = decoded(gray, width * height, true);
  }
  const rgba = Buffer.allocUnsafe(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    rgba[4 * i] = rgb[3 * i];
    rgba[4 * i + 1] = rgb[3 * i + 1];
    rgba[4 * i + 2] = rgb[3 * i + 2];
    rgba[4 * i + 3] = alpha?.[i] ?? 255;
  }
  return rgba;
}
/** Decode exactly the images actually painted by each C1 page and bind their pixel content to sequential independent renders. */
export async function verifyPdf(
  bytes: Uint8Array,
  surfaces: SurfaceSpec[],
  expectedPages?: Uint8Array[],
  brands?: PdfBrand[],
) {
  try {
    if (
      !expectedPages ||
      expectedPages.length !== surfaces.length ||
      (brands && brands.length !== surfaces.length)
    )
      fail("ARTIFACT_INVALID");
    const pdf = await PDFDocument.load(bytes);
    if (pdf.getPageCount() !== surfaces.length) fail("ARTIFACT_INVALID");
    for (const [index, page] of pdf.getPages().entries()) {
      const s = surfaces[index],
        media = page.getMediaBox(),
        trim = page.getTrimBox(),
        bleed = page.getBleedBox(),
        pt = 72 / 25.4;
      if (
        !close(media.x, 0) ||
        !close(media.y, 0) ||
        !close(media.width, (s.trimWidthMm + 2 * s.bleedMm) * pt) ||
        !close(media.height, (s.trimHeightMm + 2 * s.bleedMm) * pt) ||
        !close(trim.x, s.bleedMm * pt) ||
        !close(trim.y, s.bleedMm * pt) ||
        !close(trim.width, s.trimWidthMm * pt) ||
        !close(trim.height, s.trimHeightMm * pt) ||
        !close(bleed.x, 0) ||
        !close(bleed.y, 0) ||
        !close(bleed.width, media.width) ||
        !close(bleed.height, media.height) ||
        page.getRotation().angle !== 0
      )
        fail("ARTIFACT_INVALID");
      const annotations = page.node.lookup(PDFName.of("Annots"));
      if (
        annotations &&
        (!(annotations instanceof PDFArray) || annotations.size() > 0)
      )
        fail("ARTIFACT_INVALID");
      const contents = page.node.lookup(PDFName.of("Contents"));
      const refs =
        contents instanceof PDFArray ? contents.asArray() : [contents];
      let content = "";
      for (const ref of refs) {
        const stream = pdf.context.lookup(ref);
        if (
          !(stream instanceof PDFRawStream) ||
          stream.dict.get(PDFName.of("Filter")) !== PDFName.of("FlateDecode") ||
          stream.dict.has(PDFName.of("DecodeParms"))
        )
          fail("ARTIFACT_INVALID");
        const data = inflateSync(stream.contents, { maxOutputLength: 65536 });
        content += Buffer.from(data).toString("ascii") + "\n";
      }
      const paints = painted(content),
        xobjects = page.node
          .Resources()
          ?.lookup(PDFName.of("XObject"), PDFDict),
        expectedCount = brands ? 2 : 1;
      if (
        paints.length !== expectedCount ||
        !xobjects ||
        xobjects.entries().length !== expectedCount ||
        new Set(paints.map((p) => p.name)).size !== expectedCount
      )
        fail("ARTIFACT_INVALID");
      for (const [paintIndex, paint] of paints.entries()) {
        const brand = paintIndex === 1 ? brands?.[index] : undefined;
        const expected = brand?.pixels ?? expectedPages[index];
        const metadata = await sharp(expected).metadata(),
          width = brand ? metadata.width! : s.pixelWidth,
          height = brand ? metadata.height! : s.pixelHeight;
        if (width * height > 50_000_000) fail("ARTIFACT_INVALID");
        const rectangle = brand ?? {
          x: 0,
          y: 0,
          width: media.width,
          height: media.height,
        };
        const desired = [
          rectangle.width,
          0,
          0,
          rectangle.height,
          rectangle.x,
          rectangle.y,
        ];
        if (paint.matrix.some((v, i) => !close(v, desired[i])))
          fail("ARTIFACT_INVALID");
        const stream = pdf.context.lookup(xobjects.get(PDFName.of(paint.name)));
        if (!(stream instanceof PDFRawStream)) fail("ARTIFACT_INVALID");
        const actual = imagePixels(pdf, stream, width, height),
          reference = await pixels(expected, width, height);
        if (digest(actual) !== digest(reference)) fail("ARTIFACT_INVALID");
      }
    }
  } catch {
    fail("ARTIFACT_INVALID");
  }
}
