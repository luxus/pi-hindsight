export async function withTimeout<T>(
  operation: string,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
  parentSignal?: AbortSignal,
): Promise<T> {
  if (parentSignal?.aborted) throw new Error(`${operation} aborted`);

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  let removeAbortListener: (() => void) | undefined;
  try {
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error(`${operation} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });
    const abort = parentSignal
      ? new Promise<never>((_resolve, reject) => {
          const onAbort = () => {
            controller.abort(parentSignal.reason);
            reject(new Error(`${operation} aborted`));
          };
          parentSignal.addEventListener("abort", onAbort, { once: true });
          removeAbortListener = () => parentSignal.removeEventListener("abort", onAbort);
        })
      : undefined;
    return await Promise.race([fn(controller.signal), timeout, ...(abort ? [abort] : [])]);
  } finally {
    if (timer) clearTimeout(timer);
    removeAbortListener?.();
  }
}
