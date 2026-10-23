import type { ConvertedTheme } from "@album/template-import";
import { IndexedDbThemeLibrary } from "@album/storage";
export async function importTheme(
  file: File,
  library: IndexedDbThemeLibrary,
  signal: AbortSignal,
  onProgress: (stage: string) => void,
): Promise<ConvertedTheme> {
  signal.throwIfAborted();
  if (file.size > 256 * 1024 ** 2) throw Error("模板包超过256MiB上限");
  onProgress("正在读取模板包…");
  const bytes = await file.arrayBuffer();
  signal.throwIfAborted();
  const converted = await new Promise<ConvertedTheme>((resolve, reject) => {
    const worker = new Worker(new URL("./import-worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(signal.reason ?? new DOMException("已取消", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event) => {
      if (event.data.stage) {
        onProgress(event.data.stage);
        return;
      }
      cleanup();
      event.data.error
        ? reject(Error(event.data.error))
        : resolve(event.data.converted);
    };
    worker.onerror = (event) => {
      cleanup();
      reject(Error(event.message || "模板解析失败"));
    };
    worker.postMessage(bytes, [bytes]);
  });
  signal.throwIfAborted();
  onProgress("正在保存到本地模板库…");
  await library.put(converted, signal);
  return converted;
}
