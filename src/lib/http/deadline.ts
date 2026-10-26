/**
 * A cancellable deadline for one outgoing call (PERF-19).
 *
 * `AbortSignal.timeout(ms)` cannot be cancelled: once a listener is attached (fetch and @google/genai
 * both attach one), Node keeps the signal — and everything its listeners reach, i.e. the finished
 * request and response — alive until the timer fires, even when the call completed long before. Under
 * load that retains every call of the last `ms` milliseconds. This helper aborts at the same deadline,
 * with the same `TimeoutError` reason, but clears the timer the moment `fn` settles.
 */
export async function withDeadline<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("The operation was aborted due to timeout", "TimeoutError")),
    ms,
  );
  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}
