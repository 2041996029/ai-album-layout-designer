/** Abort immediately even when a ResourcePort/decoder cannot cancel; reclaim a late result. */
export function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  release?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const abort = () => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    };
    promise.then(
      (value) => {
        if (settled) {
          release?.(value);
          return;
        }
        settled = true;
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
}
