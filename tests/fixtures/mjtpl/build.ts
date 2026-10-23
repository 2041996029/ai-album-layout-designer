import { zipSync, strToU8 } from "fflate";
async function sha256(bytes: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(hash)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
/** Synthetic packages only: never commit private MJTPL sample data. */
export async function buildMjtpl(rotationDeg = 15, width = 61, height = 30.5) {
  const png = Uint8Array.from(
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGP4DwQACfsD/fteaysAAAAASUVORK5CYII=",
      "base64",
    ),
  );
  const hash = await sha256(png),
    ref = { path: "assets/image.bin", sha256: hash, sizeBytes: png.length };
  const scene = {
    schemaVersion: 3,
    pageId: "page-1",
    width,
    height,
    unit: "cm",
    background: "#FFFFFFFF",
    nodes: [
      {
        id: "node-1",
        type: "photo",
        slotId: "slot-1",
        transform: { x: 0, y: 0, width: 1, height: 1, rotationDeg },
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
          width,
          height,
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
