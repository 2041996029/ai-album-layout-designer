import { zipSync, strToU8 } from "fflate";
import { sha256 } from "@album/document";
/** Synthetic packages only: never commit private MJTPL sample data. */
export async function buildMjtpl() {
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAaX2RaAAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const hash = await sha256(png),
    ref = { path: "assets/image.bin", sha256: hash, sizeBytes: png.length };
  const scene = {
    schemaVersion: 3,
    pageId: "page-1",
    width: 61,
    height: 30.5,
    unit: "cm",
    background: "#FFFFFFFF",
    nodes: [
      {
        id: "node-1",
        type: "photo",
        slotId: "slot-1",
        transform: { x: 0, y: 0, width: 1, height: 1, rotationDeg: 15 },
        effects: { opacity: 0.5 },
        assetRef: { assetId: "image", relativePath: ref.path, sha256: hash },
        photoMask: { type: "assetAlpha" },
      },
    ],
  };
  const sceneBytes = strToU8(JSON.stringify(scene)),
    manifest = {
      format: "MJTPL",
      formatVersion: 1,
      schemaVersion: 3,
      name: "Synthetic",
      preview: ref,
      assets: [{ ...ref, assetKey: "image", kind: "material" }],
      pages: [
        {
          pageId: "page-1",
          name: "Page",
          width: 61,
          height: 30.5,
          unit: "cm",
          preview: ref,
          scenePath: "pages/scene.json",
          sceneHash: await sha256(sceneBytes),
        },
      ],
    };
  return {
    manifest,
    scene,
    files: {
      "manifest.json": strToU8(JSON.stringify(manifest)),
      "pages/scene.json": sceneBytes,
      [ref.path]: png,
    },
    bytes: zipSync({
      "manifest.json": strToU8(JSON.stringify(manifest)),
      "pages/scene.json": sceneBytes,
      [ref.path]: png,
    }),
  };
}
