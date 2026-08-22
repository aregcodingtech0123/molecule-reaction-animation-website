import { parseSessionTokenFromCookieHeader } from "@/lib/auth/resolve-session-token";

const FORWARD_REQUEST_HEADERS = [
  "accept",
  "accept-language",
  "content-type",
  "x-request-id",
  "x-correlation-id",
  "x-idempotency-key",
] as const;

/**
 * Extract Bearer JWT from the incoming client request (Authorization header).
 * Returns the full header value (e.g. "Bearer eyJ...") for downstream forwarding.
 */
export function extractBearerAuthorization(request: Request): string | null {
  const raw = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!raw?.trim()) return null;

  const normalized = raw.trim();
  if (/^bearer\s+.+/i.test(normalized)) {
    return normalized;
  }

  return null;
}

/**
 * Build outbound headers for the downstream microservice call.
 * Forwards session cookie or Authorization header as Bearer for Express.
 */
export function buildDownstreamHeaders(
  request: Request,
  service: string,
): Headers {
  const headers = new Headers();

  let auth = extractBearerAuthorization(request);
  if (!auth) {
    const cookieToken = parseSessionTokenFromCookieHeader(request.headers.get("cookie"));
    if (cookieToken) {
      auth = `Bearer ${cookieToken}`;
    }
  }

  if (auth) {
    headers.set("Authorization", auth);
  }

  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  headers.set("X-Forwarded-By", "moleculestudio-gateway");
  headers.set("X-Gateway-Service", service);

  return headers;
}

/** Pass selected response headers from upstream back to the browser. */
export function pickDownstreamResponseHeaders(upstream: Headers): Headers {
  const headers = new Headers();
  const passThrough = ["content-type", "cache-control", "x-request-id", "retry-after"];

  for (const name of passThrough) {
    const value = upstream.get(name);
    if (value) headers.set(name, value);
  }

  return headers;
}
