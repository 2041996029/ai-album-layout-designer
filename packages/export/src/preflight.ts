import { generatedProvenanceIssues } from "@album/document";
import { verifyImportedTemplateProof } from "@album/document";
import {
  validateDocumentAssignment,
  validateLayoutContextHash,
} from "@album/layout";
import {
  validateDocument,
  isGroupLayer,
  isImageLayer,
  isTextLayer,
  canonicalJson,
  sha256,
  type Layer,
  type TextLayer,
} from "@album/document";
import {
  loadFont,
  unsupportedGlyphs,
  inspectImage,
  type ResourcePort,
  type LoadedFont,
  type AssetRecord,
} from "@album/assets";
import { layoutText, createTextMeasure, getRecipe } from "@album/render";
import { planSurfaces, effectivePpi } from "./geometry";
import { assertSnapshot } from "./snapshot";
import {
  MAX_SURFACE_PIXELS,
  BROWSER_MEMORY_BYTES,
  type ExportSnapshot,
  type PreflightReport,
  type PreflightIssue,
} from "./types";
const verifiedReports = new WeakSet<object>();
function sealReport(report: PreflightReport): PreflightReport {
  const freeze = (value: unknown) => {
    if (value && typeof value === "object") {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
  };
  freeze(report);
  verifiedReports.add(report);
  return report;
}
export interface PreflightPolicy {
  memoryBudgetBytes?: number;
  templateRefs?: readonly { id: string; version: number; sha256: string }[];
}
async function read(
  port: ResourcePort,
  id: string,
  variant: "original" | "normalized",
  signal: AbortSignal,
): Promise<Uint8Array> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const cleanup = () => signal.removeEventListener("abort", abort);
    signal.addEventListener("abort", abort, { once: true });
    port.read(id, variant).then(
      (bytes) => {
        cleanup();
        resolve(bytes);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}
export async function preflight(
  snapshot: ExportSnapshot,
  port: ResourcePort,
  signal: AbortSignal,
  policy: PreflightPolicy = {},
): Promise<PreflightReport> {
  assertSnapshot(snapshot);
  signal.throwIfAborted();
  if (
    policy.memoryBudgetBytes !== undefined &&
    (!Number.isSafeInteger(policy.memoryBudgetBytes) ||
      policy.memoryBudgetBytes <= 0 ||
      policy.memoryBudgetBytes > 2 * 1024 ** 3)
  )
    throw new Error("INVALID_MEMORY_BUDGET");
  const surfaces = planSurfaces(snapshot),
    blockers: PreflightIssue[] = [],
    warnings: PreflightIssue[] = [],
    loaded = new Map<string, LoadedFont>();
  const add = async (
    code: string,
    path: string,
    message: string,
    extra: Partial<PreflightIssue> = {},
    warning = false,
  ) => {
    const id =
      "issue_" +
      (
        await sha256(
          canonicalJson({ code, path, surface: extra.surfaceId ?? null }),
        )
      ).slice(0, 24);
    const item: PreflightIssue = {
      id,
      code,
      path,
      message,
      severity: warning ? "warning" : "blocker",
      ...extra,
    };
    const target = warning ? warnings : blockers;
    if (!target.some((i) => i.id === id)) target.push(item);
  };
  for (const issue of validateDocument(snapshot.doc))
    await add(issue.code, issue.path, issue.message);
  for (const code of validateDocumentAssignment(snapshot.doc))
    await add(
      code,
      "/assignmentManifest",
      "排版照片清单与当前文档不一致，请重新排版或恢复照片。",
    );
  if (!(await validateLayoutContextHash(snapshot.doc)))
    await add(
      "LAYOUT_INTEGRITY_FAILED",
      "/layoutContext",
      "排版输入校验失败，请重新生成方案。",
    );
  const referenced = new Map<
    string,
    {
      layer: Layer;
      scale: number;
      surfaceId: string;
      bounds: { x: number; y: number; width: number; height: number };
    }
  >();
  let maxFrames = 0;
  for (const surface of surfaces) {
    let frameBytes = 0;
    const layers = surface.cover
      ? snapshot.doc.cover[surface.cover]
      : snapshot.doc.spreads.find((s) => s.id === surface.sourceSpreadId)!
          .layers;
    type Matrix = [number, number, number, number, number, number];
    const mul = (a: Matrix, b: Matrix): Matrix => [
      a[0] * b[0] + a[2] * b[1],
      a[1] * b[0] + a[3] * b[1],
      a[0] * b[2] + a[2] * b[3],
      a[1] * b[2] + a[3] * b[3],
      a[0] * b[4] + a[2] * b[5] + a[4],
      a[1] * b[4] + a[3] * b[5] + a[5],
    ];
    const walk = (list: Layer[], scale: number, parent: Matrix) => {
      for (const layer of list) {
        if (layer.visible === false) continue;
        const angle = (Number(layer.rotation ?? 0) * Math.PI) / 180,
          localScale = isGroupLayer(layer) ? (layer.scale ?? 1) : 1;
        const m = mul(parent, [
          Math.cos(angle) * localScale,
          Math.sin(angle) * localScale,
          -Math.sin(angle) * localScale,
          Math.cos(angle) * localScale,
          Number(layer.x ?? 0),
          Number(layer.y ?? 0),
        ]);
        if (isGroupLayer(layer)) {
          walk(layer.children, scale * localScale, m);
          continue;
        }
        const corners = [
          [0, 0],
          [Number(layer.width ?? 0), 0],
          [0, Number(layer.height ?? 0)],
          [Number(layer.width ?? 0), Number(layer.height ?? 0)],
        ].map(([x, y]) => ({
          x: m[0] * x + m[2] * y + m[4],
          y: m[1] * x + m[3] * y + m[5],
        }));
        const x = Math.min(...corners.map((p) => p.x)),
          y = Math.min(...corners.map((p) => p.y));
        referenced.set(surface.id + "|" + layer.id, {
          layer,
          scale,
          surfaceId: surface.id,
          bounds: {
            x,
            y,
            width: Math.max(...corners.map((p) => p.x)) - x,
            height: Math.max(...corners.map((p) => p.y)) - y,
          },
        });
        if (isImageLayer(layer))
          frameBytes +=
            4 *
            Math.ceil((layer.width * scale * snapshot.options.dpi) / 96) *
            Math.ceil((layer.height * scale * snapshot.options.dpi) / 96);
      }
    };
    walk(layers, 1, [1, 0, 0, 1, 0, 0]);
    maxFrames = Math.max(maxFrames, frameBytes);
    if (surface.pixelWidth * surface.pixelHeight > MAX_SURFACE_PIXELS)
      await add(
        "PIXEL_BUDGET",
        "/surfaces/" + surface.id,
        "输出面超过50MP，请拆分或降低规格。",
        { surfaceId: surface.id },
      );
  }
  const sourcePixels = Math.max(
    0,
    ...[...referenced.values()]
      .filter((r) => isImageLayer(r.layer))
      .map((r) => {
        const a = snapshot.resources.assets.find(
          (a) => a.id === (r.layer as any).assetId,
        );
        const maskId = isImageLayer(r.layer)
          ? r.layer.alphaMask?.assetId
          : undefined;
        const mask = maskId
          ? snapshot.resources.assets.find((a) => a.id === maskId)
          : undefined;
        return (
          (a ? a.width * a.height : 0) + (mask ? mask.width * mask.height : 0)
        );
      }),
  );
  const surfacePixels = Math.max(
    ...surfaces.map((s) => s.pixelWidth * s.pixelHeight),
  );
  const estimatedBytes =
    12 * sourcePixels + 12 * surfacePixels + maxFrames + 128 * 1024 ** 2;
  if (maxFrames > 128 * 1024 ** 2)
    await add(
      "CACHE_BUDGET",
      "/resources",
      "同时保留的图片图框超过128MiB，请缩小图框或拆分。",
    );
  if (estimatedBytes > (policy.memoryBudgetBytes ?? BROWSER_MEMORY_BYTES))
    await add(
      "MEMORY_BUDGET",
      "/resources",
      "预计工作集超出当前渲染环境预算，请拆分或降低规格。",
    );
  for (const spread of snapshot.doc.spreads)
    if (
      spread.templateRef &&
      !(await verifyImportedTemplateProof(spread)) &&
      !policy.templateRefs?.some(
        (t) =>
          t.id === spread.templateRef!.id &&
          t.version === spread.templateRef!.version &&
          t.sha256 === spread.templateRef!.sha256,
      )
    )
      await add(
        "TEMPLATE_UNAVAILABLE",
        "/spreads/" + spread.id,
        "模板版本或授权未注册，不能导出。",
      );
  if (
    blockers.some((i) =>
      ["PIXEL_BUDGET", "MEMORY_BUDGET", "CACHE_BUDGET"].includes(i.code),
    )
  )
    return sealReport({
      snapshotHash: snapshot.snapshotHash,
      blockers,
      warnings,
      surfaces,
      estimatedBytes,
    });
  try {
    for (const { layer, scale, surfaceId, bounds } of referenced.values()) {
      signal.throwIfAborted();
      const path = "/layers/" + layer.id;
      if (isImageLayer(layer)) {
        const asset = snapshot.resources.assets.find(
          (a) => a.id === layer.assetId,
        );
        if (!asset || asset.status !== "ready") {
          await add("ASSET_MISSING", path, "原片或归一化图不可用。", {
            layerId: layer.id,
          });
          continue;
        }
        if (!asset.license.usable) {
          await add("ASSET_UNLICENSED", path, "照片使用授权不可用。", {
            layerId: layer.id,
          });
          continue;
        }
        if (
          layer.role === "generated" ||
          (asset as any).origin === "generated" ||
          (asset.source as any).kind === "generated" ||
          (asset as any).provenance != null
        ) {
          const provenanceIssues = generatedProvenanceIssues(
            snapshot.doc,
            asset,
            layer.id,
          );
          for (const issue of provenanceIssues)
            await add(issue.code, path, issue.message, { layerId: layer.id });
          if (provenanceIssues.length) continue;
        }

        try {
          for (const variant of ["original", "normalized"] as const) {
            const bytes = await read(port, asset.id, variant, signal);
            signal.throwIfAborted();
            if ((await sha256(bytes)) !== asset.variants[variant].sha256)
              throw new Error("HASH_MISMATCH");
            const header = inspectImage(bytes);
            if (
              variant === "normalized" &&
              (header.width !== asset.width || header.height !== asset.height)
            )
              throw new Error("ASSET_DIMENSIONS_MISMATCH");
          }
          if (layer.filter) getRecipe(layer.filter);
        } catch (error) {
          signal.throwIfAborted();
          const code =
            error instanceof Error &&
            [
              "HASH_MISMATCH",
              "ASSET_DIMENSIONS_MISMATCH",
              "UNSUPPORTED_FILTER_VERSION",
              "INVALID_FILTER_PARAMETERS",
            ].includes(error.message)
              ? error.message
              : "ASSET_MISSING";
          await add(code, path, String(error), { layerId: layer.id });
          continue;
        }
        if (layer.alphaMask) {
          const maskPath = path + "/alphaMask";
          const mask = snapshot.resources.assets.find(
            (a) => a.id === layer.alphaMask!.assetId,
          );
          if (!mask || mask.status !== "ready")
            await add("ASSET_MISSING", maskPath, "槽位蒙版不可用。", {
              layerId: layer.id,
            });
          else if (!mask.license.usable)
            await add(
              "ASSET_UNLICENSED",
              maskPath,
              "槽位蒙版使用授权不可用。",
              { layerId: layer.id },
            );
          else {
            try {
              for (const variant of ["original", "normalized"] as const) {
                const bytes = await read(port, mask.id, variant, signal);
                signal.throwIfAborted();
                if ((await sha256(bytes)) !== mask.variants[variant].sha256)
                  throw new Error("HASH_MISMATCH");
                const header = inspectImage(bytes);
                if (
                  variant === "normalized" &&
                  (header.width !== mask.width || header.height !== mask.height)
                )
                  throw new Error("ASSET_DIMENSIONS_MISMATCH");
              }
            } catch (error) {
              signal.throwIfAborted();
              const code =
                error instanceof Error &&
                ["HASH_MISMATCH", "ASSET_DIMENSIONS_MISMATCH"].includes(
                  error.message,
                )
                  ? error.message
                  : "ASSET_MISSING";
              await add(code, maskPath, String(error), { layerId: layer.id });
            }
          }
        }
        const ppi = effectivePpi(layer, asset, scale);
        if (ppi < 200)
          await add(
            "LOW_PPI",
            path,
            `有效清晰度${ppi}PPI。`,
            {
              layerId: layer.id,
              surfaceId,
              ppi,
              level: ppi < 100 ? "strong" : "normal",
            },
            true,
          );
      }
      if (isTextLayer(layer)) {
        if (layer.critical !== false) {
          const surface = surfaces.find((s) => s.id === surfaceId)!,
            safe = (snapshot.doc.printProfile.safeMm * 96) / 25.4,
            c = surface.clip;
          const intersects =
            bounds.x < c.x + c.width &&
            bounds.x + bounds.width > c.x &&
            bounds.y < c.y + c.height &&
            bounds.y + bounds.height > c.y;
          if (
            intersects &&
            (bounds.x < c.x + safe ||
              bounds.y < c.y + safe ||
              bounds.x + bounds.width > c.x + c.width - safe ||
              bounds.y + bounds.height > c.y + c.height - safe)
          )
            await add(
              "SAFE_AREA",
              path,
              "重要文字进入裁切安全区，请检查。",
              { layerId: layer.id, surfaceId },
              true,
            );
          const gutter = snapshot.doc.pageSize.width;
          if (
            intersects &&
            !surface.cover &&
            bounds.x < gutter + safe &&
            bounds.x + bounds.width > gutter - safe
          )
            await add(
              "GUTTER_TEXT",
              path,
              "重要文字接近装订中缝，请检查。",
              { layerId: layer.id, surfaceId },
              true,
            );
        }
        const font = snapshot.resources.fonts.find(
          (f) => f.id === layer.fontAssetId,
        );
        if (
          !font ||
          ![400, 700].includes(layer.fontWeight) ||
          !font.faces.some((face) => face.weight === layer.fontWeight)
        ) {
          await add("FONT_UNAVAILABLE", path, "指定字体或实际字重不可用。", {
            layerId: layer.id,
          });
          continue;
        }
        if (!font.license.usable) {
          await add("FONT_UNLICENSED", path, "字体使用授权不可用。", {
            layerId: layer.id,
          });
          continue;
        }
        try {
          const text = [...referenced.values()]
            .filter(
              (r) =>
                isTextLayer(r.layer) &&
                (r.layer as TextLayer).fontAssetId === font.id,
            )
            .map((r) => (r.layer as TextLayer).text)
            .join("\n");
          if (!loaded.has(font.id))
            loaded.set(font.id, await loadFont(font, port, signal, text));
          const face = loaded.get(font.id)!;
          if (unsupportedGlyphs(layer.text, face).length) {
            await add(
              "UNSUPPORTED_GLYPHS",
              path,
              "字体不包含文本中的全部字符。",
              { layerId: layer.id },
            );
            continue;
          }
          const canvas = document.createElement("canvas");
          canvas.width = canvas.height = 1;
          const ctx = canvas.getContext("2d")!;
          const report = layoutText(
            layer,
            face,
            createTextMeasure(ctx, layer.fontWeight as 400 | 700),
          );
          canvas.width = canvas.height = 0;
          if (report.overflow)
            await add(
              "TEXT_OVERFLOW",
              path,
              `「${layer.text.slice(0, 36)}」超出文字框，请自动适配或扩大文字框。`,
              {
                layerId: layer.id,
                surfaceId,
              },
            );
        } catch (error) {
          signal.throwIfAborted();
          await add(
            (error as any).code === "FONT_UNLICENSED"
              ? "FONT_UNLICENSED"
              : "FONT_UNAVAILABLE",
            path,
            String(error),
            { layerId: layer.id },
          );
        }
      }
    }
  } finally {
    for (const font of loaded.values()) font.dispose();
  }
  return sealReport({
    snapshotHash: snapshot.snapshotHash,
    blockers,
    warnings,
    surfaces,
    estimatedBytes,
  });
}
export function authorizeExport(
  snapshot: ExportSnapshot,
  report: PreflightReport,
  acknowledgedWarningIds: string[],
): void {
  assertSnapshot(snapshot);
  if (!verifiedReports.has(report)) throw new Error("PREFLIGHT_UNVERIFIED");
  if (report.snapshotHash !== snapshot.snapshotHash)
    throw new Error("PREFLIGHT_STALE");
  if (report.blockers.length) throw new Error("PREFLIGHT_BLOCKED");
  if (
    planSurfaces(snapshot).some(
      (s) => s.pixelWidth * s.pixelHeight > MAX_SURFACE_PIXELS,
    )
  )
    throw new Error("PIXEL_BUDGET");
  const warnings = new Set(report.warnings.map((i) => i.id));
  if (
    acknowledgedWarningIds.some((id) => !warnings.has(id)) ||
    report.warnings.some((i) => !acknowledgedWarningIds.includes(i.id))
  )
    throw new Error("WARNINGS_UNACKNOWLEDGED");
}
