import {
  canonicalJson,
  type DocumentModel,
  type TemplateVersion,
} from "@album/document";
import {
  prepareLayout,
  verifyCandidate,
  type LayoutInput,
  type LayoutCandidate,
} from "@album/layout";
import { candidateContexts } from "../../../../packages/layout/src/candidates";
import { deepFreeze } from "../../../../packages/layout/src/prepare";
export async function computeLayouts(
  input: LayoutInput,
  doc: DocumentModel,
  template: TemplateVersion,
  signal: AbortSignal,
): Promise<LayoutCandidate[]> {
  signal.throwIfAborted();
  const snapshot = structuredClone({ input, doc, template }),
    prepared = await prepareLayout(snapshot.input);
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./layout-worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("已取消排版", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onerror = () => {
      cleanup();
      reject(new Error("排版计算失败，请重新生成。"));
    };
    worker.onmessage = (event) => {
      cleanup();
      if (signal.aborted) {
        reject(new DOMException("已取消排版", "AbortError"));
        return;
      }
      if (event.data.error) {
        const e = event.data.error;
        reject(
          new Error(
            e.code === "CAPACITY_EXCEEDED"
              ? `照片放不下，至少需要 ${e.minimumRequiredSpreads} 个跨页；也可提高每跨页容量或明确允许选片。`
              : `排版约束冲突：${e.code}。请检查锁定内容、选片与跨页范围。`,
          ),
        );
        return;
      }
      const candidates: LayoutCandidate[] = event.data.candidates;
      if (
        !Array.isArray(candidates) ||
        candidates.length > 3 ||
        candidates.some(
          (c) =>
            c.inputHash !== prepared.inputHash ||
            verifyCandidate(snapshot.input, snapshot.doc, c).length,
        )
      ) {
        reject(new Error("排版方案完整性校验失败。"));
        return;
      }
      for (const c of candidates) {
        candidateContexts.set(c, {
          prepared,
          before: canonicalJson(snapshot.doc),
        });
        deepFreeze(c);
      }
      resolve(candidates);
    };
    worker.postMessage(snapshot);
  });
}
