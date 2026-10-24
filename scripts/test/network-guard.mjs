/**
 * Fail-closed fetch guard for tests.
 *
 * Replaces globalThis.fetch with a wrapper that:
 *   - passes loopback requests (127.0.0.1 / localhost / ::1) to the real fetch,
 *   - serves registered stubs for external hosts,
 *   - throws for every other external request.
 *
 * Real Lemon Squeezy, Google, Gemini and Resend endpoints are therefore
 * unreachable from any test process even if a real key leaks into the env.
 */

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** @type {Array<{ match: (url: URL, init: RequestInit) => boolean, handler: (url: URL, init: RequestInit, request: Request) => Response | Promise<Response> }>} */
const stubs = [];
/** @type {Array<{ url: string, method: string, headers: Record<string,string>, body: string | null }>} */
export const externalCalls = [];

let realFetch = null;

function toUrl(input) {
  if (input instanceof URL) return input;
  if (typeof input === "string") return new URL(input);
  return new URL(input.url);
}

export class BlockedNetworkError extends Error {
  constructor(url) {
    super(`[network-guard] Blocked real network call to ${url.origin}${url.pathname}`);
    this.name = "BlockedNetworkError";
  }
}

/**
 * @param {{ allowHosts?: string[] }} [options] extra non-secret hosts passed through
 *   (E2E only: Google Fonts for next/font, so pages render as in production).
 */
export function installNetworkGuard(options = {}) {
  if (realFetch) return;
  realFetch = globalThis.fetch;
  const allowed = new Set(options.allowHosts ?? []);
  globalThis.fetch = async function guardedFetch(input, init = {}) {
    const url = toUrl(input);
    if (LOOPBACK.has(url.hostname) || allowed.has(url.hostname)) {
      return realFetch(input, init);
    }

    const request = new Request(input, init);
    const body = init.body == null ? null : typeof init.body === "string" ? init.body : await request.clone().text();
    const headers = Object.fromEntries(request.headers.entries());
    externalCalls.push({ url: url.toString(), method: request.method, headers, body });

    for (const stub of [...stubs].reverse()) {
      if (stub.match(url, init)) {
        return stub.handler(url, init, request);
      }
    }
    throw new BlockedNetworkError(url);
  };
}

/**
 * Register an external-host stub. Later registrations win.
 * @returns {() => void} unregister
 */
export function stubExternal(match, handler) {
  const entry = {
    match: typeof match === "function" ? match : (url) => url.hostname === match || url.toString().startsWith(match),
    handler,
  };
  stubs.push(entry);
  return () => {
    const i = stubs.indexOf(entry);
    if (i >= 0) stubs.splice(i, 1);
  };
}

export function resetNetworkStubs() {
  stubs.length = 0;
  externalCalls.length = 0;
}

export function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}
