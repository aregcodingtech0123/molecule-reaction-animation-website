import { GATEWAY_SERVICES, getServiceBaseUrl } from "./config";
import { GATEWAY_ERROR_CODES, GatewayError, gatewayErrorJson, handleGatewayFailure } from "./errors";
import { buildDownstreamHeaders, pickDownstreamResponseHeaders } from "./headers";
import { clearedSessionCookieHeader, sessionCookieHeader } from "@/lib/auth/session-cookie";
import { crossSiteRejection, isCrossSiteRequest, SAFE_METHODS } from "@/lib/security/csrf";
import type { ProxyOptions } from "./types";
import { BodyTooLargeError, GATEWAY_MAX_BODY_BYTES, readBodyWithLimit } from "@/lib/http/limited-body";

/**
 * Upstream routes the browser must never reach through the gateway. The AI
 * credit metering endpoints are internal-only (the BFF calls them server-side
 * with the internal service key); /deduct was retired. This is a denylist: the gateway adds the real internal key to
 * everything it proxies, so every new internal billing route (delivery-attempt, most recently) MUST be listed here. Matching is done on the
 * normalised upstream path and is case-insensitive, because Express routing is.
 */
const INTERNAL_ONLY_ROUTES: Partial<Record<ProxyOptions["service"], ReadonlySet<string>>> = {
  billing: new Set(["consume", "capture", "refund", "deduct", "webhooks", "delivery-attempt"]),
};

/** First path segment below the service base, after URL normalisation (`..`, `.`), lower-cased. */
function firstSegmentBelowBase(baseUrl: string, targetUrl: string): string | null {
  const basePath = new URL(baseUrl).pathname.replace(/\/+$/, "");
  const targetPath = new URL(targetUrl).pathname;
  if (!targetPath.startsWith(`${basePath}/`) && targetPath !== basePath) return null;
  const rest = targetPath.slice(basePath.length).replace(/^\/+/, "");
  return decodeURIComponent(rest.split("/")[0] ?? "").toLowerCase();
}

/**
 * Not proxied: any path that escapes the service prefix (e.g. `..` segments) for EVERY service,
 * plus the internal-only routes of a service (fail closed).
 */
function isBlockedRoute(service: ProxyOptions["service"], baseUrl: string, targetUrl: string): boolean {
  const first = firstSegmentBelowBase(baseUrl, targetUrl);
  if (first === null) return true;
  const blocked = INTERNAL_ONLY_ROUTES[service];
  return Boolean(blocked?.has(first.replace(/[\s.]+$/, "")));
}

/**
 * Auth responses: the BFF owns the session cookie (FINDING-24). Any `data.token` in an auth
 * response is removed from the body and turned into an httpOnly cookie; a successful logout
 * clears it.
 */
async function finalizeAuthResponse(
  pathSegments: string[],
  upstream: Response,
  headers: Headers,
): Promise<BodyInit> {
  const route = (pathSegments[0] ?? "").toLowerCase();
  const raw = await upstream.arrayBuffer();
  if (upstream.ok && route === "logout") headers.append("Set-Cookie", clearedSessionCookieHeader());
  if (!(upstream.headers.get("content-type") ?? "").includes("application/json")) return raw;

  let json: { data?: { token?: unknown } } | null;
  try {
    json = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return raw;
  }
  const token = json?.data?.token;
  if (typeof token !== "string") return raw;
  delete json!.data!.token;
  if (upstream.ok) headers.append("Set-Cookie", sessionCookieHeader(token));
  return JSON.stringify(json);
}

function buildDownstreamUrl(baseUrl: string, pathSegments: string[], request: Request): string {
  const path = pathSegments.length > 0 ? `/${pathSegments.map(encodeURIComponent).join("/")}` : "";
  const url = new URL(`${baseUrl}${path}`);
  const incoming = new URL(request.url);
  url.search = incoming.search;
  return url.toString();
}

/** Bounded (SEC-10): the bytes are forwarded unchanged, the Content-Type header carries the format. */
async function readRequestBody(request: Request): Promise<BodyInit | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;
  const body = await readBodyWithLimit(request, GATEWAY_MAX_BODY_BYTES);
  return body && body.byteLength > 0 ? (body as Uint8Array<ArrayBuffer>) : undefined;
}

/**
 * Proxy an incoming Next.js API request to an internal microservice.
 */
export async function proxyToService(options: ProxyOptions): Promise<Response> {
  const { service, request, pathSegments } = options;
  const config = GATEWAY_SERVICES[service];
  const baseUrl = getServiceBaseUrl(service);

  if (!baseUrl) {
    return handleGatewayFailure(
      new GatewayError(
        503,
        GATEWAY_ERROR_CODES.SERVICE_NOT_CONFIGURED,
        `${config.label} is not configured. Set ${config.envVar} in the environment.`,
        service,
      ),
    );
  }

  const timeoutMs = options.timeoutMs ?? config.defaultTimeoutMs;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const targetUrl = buildDownstreamUrl(baseUrl, pathSegments, request);
    if (isBlockedRoute(service, baseUrl, targetUrl)) {
      return gatewayErrorJson(404, "Route not found.");
    }
    if (!SAFE_METHODS.has(request.method.toUpperCase()) && isCrossSiteRequest(request)) {
      return crossSiteRejection();
    }
    const headers = buildDownstreamHeaders(request, service);
    const body = await readRequestBody(request);

    const upstream = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      signal: controller.signal,
      cache: "no-store",
      redirect: "manual",
    });

    const responseHeaders = pickDownstreamResponseHeaders(upstream.headers);
    const responseBody =
      service === "auth"
        ? await finalizeAuthResponse(pathSegments, upstream, responseHeaders)
        : await upstream.arrayBuffer();

    return new Response(responseBody, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    if (err instanceof BodyTooLargeError) {
      return gatewayErrorJson(413, "Request body too large.", { code: GATEWAY_ERROR_CODES.PAYLOAD_TOO_LARGE, service });
    }
    return handleGatewayFailure(err, service);
  } finally {
    clearTimeout(timeoutId);
  }
}
