import { parseMjtpl, convertMjtpl } from "@album/template-import";
self.onmessage = async (event: MessageEvent<ArrayBuffer>) => {
  try {
    const signal = new AbortController().signal;
    const parsed = await parseMjtpl(new Uint8Array(event.data), signal);
    self.postMessage({ stage: "正在转换图层与素材…" });
    const converted = await convertMjtpl(parsed, signal);
    self.postMessage({ stage: "正在验证图片可用性…" });
    for (const asset of converted.theme.resources.assets) {
      const bytes = converted.files.get(`${asset.id}:normalized`)!;
      try {
        const bitmap = await createImageBitmap(
          new Blob([new Uint8Array(bytes)], { type: asset.mimeType }),
          { resizeWidth: 1, resizeHeight: 1 },
        );
        bitmap.close();
      } catch {
        throw Error(`模板素材无法解码：${asset.source.name}`);
      }
    }
    self.postMessage({ converted });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
