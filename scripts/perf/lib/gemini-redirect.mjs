/**
 * Redirects Gemini REST calls to the local mock by rewriting the URL ONLY: the caller's `init` object —
 * and with it the abort signal behind GEMINI_TIMEOUT_MS — reaches the inner fetch untouched, as in
 * production.
 *
 * PERF-21: the Part 0 harness instead rebuilt the call as `new Request(input, init)` and forwarded
 * `request.signal`. undici links a Request's signal to its source only weakly, so a GC during the wait
 * dropped the link and the timeout never reached the socket (the turn hung until undici's 300 s
 * headers timeout). Production code never does this; only the harness did.
 */
export const GEMINI_HOST = "generativelanguage.googleapis.com";

/**
 * @param {typeof fetch} inner  the fetch to call (the network guard; loopback passes through)
 * @param {string | undefined} mockOrigin  e.g. http://127.0.0.1:4290
 * @returns {typeof fetch}
 */
export function geminiRedirect(inner, mockOrigin) {
  return function redirectGemini(input, init) {
    if (typeof input === "string" || input instanceof URL) {
      const url = new URL(input);
      if (url.hostname === GEMINI_HOST) {
        if (!mockOrigin) throw new Error("[perf-preload] PERF_GEMINI_ORIGIN is not set");
        return inner(`${mockOrigin}${url.pathname}${url.search}`, init);
      }
    }
    // A Request object (or any other host) goes to the guard, which blocks Gemini as a non-loopback host.
    return inner(input, init);
  };
}
