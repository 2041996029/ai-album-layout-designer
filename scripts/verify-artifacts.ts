import { canonicalJson, hashDocument, sha256 } from "@album/document";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { PDFDocument } from "pdf-lib";
const root = resolve(process.argv[2] ?? "docs/export-samples/program-c1");
function assert(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
for (const format of ["png", "jpeg", "pdf"]) {
  const dir = join(root, format),
    manifest = JSON.parse(await readFile(join(dir, "manifest.json"), "utf8")),
    snapshot = JSON.parse(
      await readFile(join(root, `snapshot-${format}.json`), "utf8"),
    ),
    report = JSON.parse(await readFile(join(dir, "preflight.json"), "utf8"));
  assert(
    manifest.revision === 12 && manifest.snapshotHash === snapshot.snapshotHash,
    "snapshot/revision mismatch",
  );
  assert(
    !report.blockers.length && !report.warnings.length,
    "sample preflight not clean",
  );
  assert(
    (await hashDocument(snapshot.doc)) === snapshot.docHash,
    "document hash mismatch",
  );
  assert(
    (await sha256(canonicalJson(snapshot.options))) === snapshot.optionsHash,
    "options hash mismatch",
  );
  assert(
    (await sha256(
      canonicalJson({
        docHash: snapshot.docHash,
        resources: snapshot.resources,
        optionsHash: snapshot.optionsHash,
        createdAt: snapshot.createdAt,
      }),
    )) === snapshot.snapshotHash,
    "snapshot content mismatch",
  );
  for (const file of manifest.files) {
    assert(/^[a-zA-Z0-9_.-]+$/.test(file.filename), "unsafe filename");
    const bytes = await readFile(join(dir, file.filename));
    assert(
      createHash("sha256").update(bytes).digest("hex") === file.sha256,
      "file SHA mismatch",
    );
    assert(bytes.length === file.byteLength, "file size mismatch");
    if (format === "png") {
      assert(
        bytes.readUInt32BE(16) === 7157 && bytes.readUInt32BE(20) === 3614,
        "PNG dimensions",
      );
      const pos = bytes.indexOf("pHYs");
      assert(pos > 0 && bytes[pos + 12] === 1, "PNG units");
      assert(
        Math.abs(bytes.readUInt32BE(pos + 4) * 0.0254 - 300) < 0.02,
        "PNG DPI",
      );
    }
    if (format === "jpeg") {
      assert(
        bytes.subarray(6, 11).toString("ascii") === "JFIF\0" &&
          bytes[13] === 1 &&
          bytes.readUInt16BE(14) === 300 &&
          bytes.readUInt16BE(16) === 300,
        "JPEG density",
      );
      let p = 2,
        found = false;
      while (p < bytes.length && bytes[p] === 255) {
        const marker = bytes[p + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          assert(
            bytes.readUInt16BE(p + 5) === 3614 &&
              bytes.readUInt16BE(p + 7) === 7157,
            "JPEG dimensions",
          );
          found = true;
          break;
        }
        if (marker === 0xda) break;
        p += 2 + bytes.readUInt16BE(p + 2);
      }
      assert(found, "JPEG SOF missing");
    }
    if (format === "pdf") {
      const pdf = await PDFDocument.load(bytes);
      assert(pdf.getPageCount() === 6, "PDF page count");
      for (const page of pdf.getPages()) {
        const media = page.getMediaBox(),
          trim = page.getTrimBox(),
          bleed = page.getBleedBox();
        assert(
          Math.abs(media.width - (306 * 72) / 25.4) < 1e-5 &&
            Math.abs(media.height - (306 * 72) / 25.4) < 1e-5,
          "PDF media box",
        );
        assert(
          Math.abs(trim.x - (3 * 72) / 25.4) < 1e-5 &&
            Math.abs(trim.width - (300 * 72) / 25.4) < 1e-5,
          "PDF trim box",
        );
        assert(
          JSON.stringify(media) === JSON.stringify(bleed),
          "PDF bleed box",
        );
      }
    }
  }
  console.log(
    `${format}: SHA, dimensions, DPI/physical boxes and snapshot verified`,
  );
}
