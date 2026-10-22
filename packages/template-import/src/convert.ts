import { sha256 } from "@album/document";
import type { ImageLayer, Layer } from "@album/document";
import type { AssetRecord, FontRecord } from "@album/assets";
import { imageInfo, imageRecord, embeddedFontRecord } from "./resources";
import type {
  ParsedMjtpl,
  ConvertedTheme,
  ImportedPage,
  ImportIssue,
  MjtplNode,
} from "./types";
export function argb(color: string): { color: string; opacity: number } {
  if (/^#[a-f0-9]{8}$/i.test(color))
    return {
      color: "#" + color.slice(3),
      opacity: parseInt(color.slice(1, 3), 16) / 255,
    };
  if (/^#[a-f0-9]{6}$/i.test(color)) return { color, opacity: 1 };
  throw Error("Unsupported color");
}
export async function convertMjtpl(
  parsed: ParsedMjtpl,
  signal: AbortSignal,
): Promise<ConvertedTheme> {
  const files = new Map<string, Uint8Array>(),
    assets = new Map<string, AssetRecord>(),
    fonts = new Map<string, FontRecord>(),
    fontCache = new Map<string, FontRecord | null>(),
    byKey = new Map(parsed.manifest.assets.map((a) => [a.assetKey, a])),
    issues: ImportIssue[] = [],
    pages: ImportedPage[] = [];
  const id = async (kind: string, value: string) =>
    `mj-${kind}-${(await sha256(new TextEncoder().encode(parsed.sourceHash + ":" + value))).slice(0, 48)}`;
  files.set(
    parsed.manifest.preview.path,
    parsed.files.get(parsed.manifest.preview.path)!,
  );
  for (let i = 0; i < parsed.scenes.length; i++) {
    signal.throwIfAborted();
    const scene = parsed.scenes[i],
      page = parsed.manifest.pages[i],
      pageId = await id("page", page.pageId),
      factor = page.unit === "cm" ? 96 / 2.54 : 1,
      width = page.width * factor,
      height = page.height * factor;
    const output: ImportedPage = {
      id: pageId,
      name: page.name,
      width,
      height,
      previewPath: page.preview.path,
      background: argb(scene.background).color,
      layers: [],
      photoSlots: [],
      issues: [],
    };
    files.set(page.preview.path, parsed.files.get(page.preview.path)!);
    const report = (
      node: MjtplNode | undefined,
      code: string,
      message: string,
      severity: "warning" | "blocker" = "blocker",
    ) => {
      const issue = { code, message, severity, pageId, nodeId: node?.id };
      output.issues.push(issue);
      issues.push(issue);
    };
    if (argb(scene.background).opacity !== 1)
      report(
        undefined,
        "BACKGROUND_ALPHA",
        "Transparent page background cannot be reproduced",
      );
    const sorted = [...scene.nodes].sort(
      (a, b) => (a.siblingIndex ?? 0) - (b.siblingIndex ?? 0),
    );
    for (const node of sorted) {
      signal.throwIfAborted();
      const t = node.transform,
        layerId = await id("layer", page.pageId + ":" + node.id);
      if (!["photo", "material", "text"].includes(node.type)) {
        report(node, "UNSUPPORTED_NODE", `Unsupported node: ${node.type}`);
        continue;
      }
      if (node.parentId)
        report(
          node,
          "UNSUPPORTED_PARENT",
          "Nested transform cannot be reproduced",
        );
      if (
        (t.scaleX ?? 1) !== 1 ||
        (t.scaleY ?? 1) !== 1 ||
        Object.keys(t).some(
          (k) =>
            ![
              "x",
              "y",
              "width",
              "height",
              "rotationDeg",
              "scaleX",
              "scaleY",
            ].includes(k),
        )
      )
        report(
          node,
          "UNSUPPORTED_TRANSFORM",
          "Nontrivial affine transform cannot be reproduced",
        );
      if (
        node.effects &&
        ((node.effects.blendMode ?? "normal") !== "normal" ||
          Object.keys(node.effects).some(
            (k) =>
              !["opacity", "blendMode"].includes(k) && node.effects![k] != null,
          ))
      )
        report(node, "UNSUPPORTED_EFFECT", "Effect cannot be reproduced");
      const opacity = node.effects?.opacity ?? 1;
      if (!Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
        report(node, "INVALID_OPACITY", "Invalid layer opacity");
        continue;
      }
      if (node.maskRef)
        report(
          node,
          "UNSUPPORTED_MASK",
          "External mask reference cannot be reproduced",
        );
      if (node.type === "text") {
        const style = node.textStyle ?? {},
          hash = style.fontContentHash;
        const fontSource =
          typeof hash === "string"
            ? parsed.manifest.assets.find(
                (a) => a.kind === "font" && a.sha256 === hash,
              )
            : undefined;
        if (fontSource && !fontCache.has(fontSource.sha256))
          fontCache.set(
            fontSource.sha256,
            await embeddedFontRecord(
              fontSource,
              parsed.files.get(fontSource.path)!,
            ),
          );
        const font = fontSource ? fontCache.get(fontSource.sha256) : null;
        const weight =
          style.fontWeight === 700 ||
          style.fontWeight === "Bold" ||
          style.bold === true
            ? 700
            : style.fontWeight === 400 ||
                style.fontWeight === "Regular" ||
                style.fontWeight === undefined
              ? 400
              : Number(style.fontWeight);
        const text = node.text ?? "",
          fontSize = Number(style.fontSize),
          lineHeight = Number(style.lineHeight ?? 1.2),
          letterSpacing = Number(style.letterSpacing ?? 0);
        const cp = new Set(font?.faces[0].codePoints ?? []),
          coverage = Array.from(text).every(
            (c) => c === "\n" || c === "\r" || cp.has(c.codePointAt(0)!),
          );
        const supportedStyle =
          !style.italic &&
          !style.underline &&
          (!style.writingMode || style.writingMode === "horizontal") &&
          !node.psdTextImportWarnings &&
          [fontSize, lineHeight, letterSpacing].every(Number.isFinite) &&
          fontSize > 0 &&
          lineHeight > 0 &&
          ["left", "center", "right", "justify"].includes(
            String(style.alignment ?? "left"),
          );
        if (
          font &&
          font.faces[0].weight === weight &&
          coverage &&
          supportedStyle
        ) {
          const color = argb(String(style.color ?? "#FF000000")),
            ppi = scene.ppi ?? 96,
            scale = page.unit === "cm" ? 96 / ppi : 1;
          if (!Number.isFinite(scale) || scale <= 0)
            throw Error("Invalid text resolution");
          fonts.set(font.id, font);
          files.set(
            `${font.faces[0].id}:font`,
            parsed.files.get(fontSource!.path)!,
          );
          output.layers.push({
            id: layerId,
            type: "text",
            x: t.x * width,
            y: t.y * height,
            width: t.width * width,
            height: t.height * height,
            rotation: t.rotationDeg ?? 0,
            opacity: opacity * color.opacity,
            visible: node.visible !== false,
            locked: node.locked === true,
            text,
            fontAssetId: font.id,
            fontSize: fontSize * scale,
            fontWeight: weight,
            lineHeight,
            letterSpacing: letterSpacing * scale,
            textAlign: (style.alignment ?? "left") as
              "left" | "center" | "right" | "justify",
            fill: color.color,
            layoutPhotoRole: "decoration",
          });
          continue;
        }
      }
      const source = byKey.get(node.assetRef?.assetId ?? "");
      if (!source) {
        report(
          node,
          node.type === "text" ? "TEXT_NO_RASTER" : "MISSING_IMAGE",
          "No matching appearance image is available",
        );
        continue;
      }
      const bytes = parsed.files.get(source.path)!;
      let asset: AssetRecord;
      try {
        asset = imageRecord(
          source,
          bytes,
          node.type === "text" ? "text-raster" : "decoration",
        );
      } catch (e) {
        report(node, "UNSUPPORTED_IMAGE", String(e));
        continue;
      }
      assets.set(asset.id, asset);
      for (const variant of ["original", "normalized", "preview"])
        files.set(`${asset.id}:${variant}`, bytes);
      const layer: ImageLayer = {
        id: layerId,
        type: "image",
        assetId: asset.id,
        x: t.x * width,
        y: t.y * height,
        width: t.width * width,
        height: t.height * height,
        rotation: t.rotationDeg ?? 0,
        opacity,
        visible: node.visible !== false,
        locked: node.locked === true,
        crop: { x: 0, y: 0, width: 1, height: 1 },
        fitMode: "contain",
        layoutPhotoRole: "decoration",
      };
      if (node.type === "text") {
        layer.importedText = {
          version: 1,
          text: node.text ?? "",
          textStyle: node.textStyle ?? {},
          reason: "raster-appearance",
        };
        report(
          node,
          "TEXT_APPEARANCE_PRESERVED",
          "Text appearance retained as raster; font metrics and original composition are not editable",
          "warning",
        );
      }
      if (node.type === "photo") {
        const slotId = await id(
          "slot",
          page.pageId + ":" + (node.slotId ?? node.id),
        );
        layer.templateSlot = { version: 1, slotId };
        output.photoSlots.push({
          slotId,
          layerId,
          required: node.slotRequired === true,
        });
        if (node.photoMask?.type === "assetAlpha") {
          if (imageInfo(bytes).alpha)
            layer.alphaMask = { version: 1, assetId: asset.id };
        } else if (node.photoMask)
          report(node, "UNSUPPORTED_PHOTO_MASK", "Unsupported photo mask");
        const crop = node.crop;
        if (
          crop &&
          (crop.left !== 0 ||
            crop.top !== 0 ||
            crop.right !== 1 ||
            crop.bottom !== 1)
        ) {
          if (
            [crop.left, crop.top, crop.right, crop.bottom].every(
              Number.isFinite,
            ) &&
            crop.left >= 0 &&
            crop.top >= 0 &&
            crop.right <= 1 &&
            crop.bottom <= 1 &&
            crop.right > crop.left &&
            crop.bottom > crop.top
          )
            layer.crop = {
              x: crop.left,
              y: crop.top,
              width: crop.right - crop.left,
              height: crop.bottom - crop.top,
            };
          else report(node, "UNSUPPORTED_CROP", "Invalid source crop");
        }
        const c = node.cropTransform;
        if (c) {
          layer.importedCropTransform = { ...c };
          const baked =
            node.convertedFrom === "material" &&
            node.photoMask?.type === "assetAlpha" &&
            (!crop ||
              (crop.left === 0 &&
                crop.top === 0 &&
                crop.right === 1 &&
                crop.bottom === 1));
          if (
            !baked &&
            (c.coordinateSpace !== "frame" ||
              c.centerX !== 0.5 ||
              c.centerY !== 0.5 ||
              c.width !== 1 ||
              c.height !== 1 ||
              c.rotationDeg !== 0)
          )
            report(
              node,
              "UNSUPPORTED_CROP_TRANSFORM",
              "Frame crop transform cannot be reproduced",
            );
        }
      }
      output.layers.push(layer as Layer);
    }
    pages.push(output);
  }
  return {
    theme: {
      version: 1,
      id: `mj-theme-${parsed.sourceHash}`,
      sourceHash: parsed.sourceHash,
      name: parsed.manifest.name,
      pages,
      resources: { assets: [...assets.values()], fonts: [...fonts.values()] },
      issues,
    },
    files,
  };
}
