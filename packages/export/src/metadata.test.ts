import { expect, it } from "vitest";
import { setPngDensity } from "./encode-png";
import { setJpegDensity } from "./encode-jpeg";
it("writes a valid PNG pHYs chunk with metre units and repeatable CRC", () => {
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const out = setPngDensity(png, 300);
  const index = Buffer.from(out).indexOf("pHYs"),
    view = new DataView(out.buffer, out.byteOffset);
  expect(view.getUint32(index + 4)).toBe(11811);
  expect(view.getUint32(index + 8)).toBe(11811);
  expect(out[index + 12]).toBe(1);
  expect(Buffer.from(out.slice(index + 13, index + 17)).toString("hex")).toBe(
    "78a53f76",
  );
  expect(setPngDensity(out, 300)).toEqual(out);
});
it("inserts JFIF inch density, removes EXIF, and preserves JPEG scan data", () => {
  const jpeg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe1, 0, 8, 69, 120, 105, 102, 0, 0, 0xff, 0xda, 0, 2, 1,
    2, 3, 0xff, 0xd9,
  ]);
  const out = setJpegDensity(jpeg, 300);
  expect([...out.slice(6, 11)]).toEqual([74, 70, 73, 70, 0]);
  expect(out[13]).toBe(1);
  expect(new DataView(out.buffer).getUint16(14)).toBe(300);
  expect(new DataView(out.buffer).getUint16(16)).toBe(300);
  expect(Buffer.from(out).includes(Buffer.from("Exif"))).toBe(false);
  expect([...out.slice(-9)]).toEqual([...jpeg.slice(-9)]);
  expect(setJpegDensity(out, 300)).toEqual(out);
});
it("releases decoded PNG channels before embedding the next PDF page", async () => {
  const { PDFDocument } = await import("pdf-lib"),
    { vi } = await import("vitest"),
    { encodePdf } = await import("./encode-pdf");
  const original = PDFDocument.prototype.embedPng;
  let previous: any;
  let checked = 0;
  const spy = vi
    .spyOn(PDFDocument.prototype, "embedPng")
    .mockImplementation(async function (this: any, data: any) {
      if (previous) {
        expect(previous.embedder).toBeUndefined();
        checked++;
      }
      previous = await original.call(this, data);
      return previous;
    });
  try {
    const bytes = Uint8Array.from(
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=",
          "base64",
        ),
      ),
      surface: any = { trimWidthMm: 100, trimHeightMm: 100, bleedMm: 3 };
    await encodePdf(
      [
        { surface, mime: "image/png", bytes },
        { surface, mime: "image/png", bytes },
      ],
      {
        doc: { revision: 1 },
        revision: 1,
        createdAt: "2026-10-21T00:00:00Z",
      } as any,
    );
    expect(checked).toBe(1);
  } finally {
    spy.mockRestore();
  }
});
