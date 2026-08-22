import { GATEWAY_SERVICES, getServiceBaseUrl } from "./config";
import { GATEWAY_ERROR_CODES, GatewayError, handleGatewayFailure } from "./errors";
import { buildDownstreamHeaders, pickDownstreamResponseHeaders } from "./headers";
import type { ProxyOptions } from "./types";

function buildDownstreamUrl(baseUrl: string, pathSegments: string[], request: Request): string {
  const path = pathSegments.length > 0 ? `/${pathSegments.map(encodeURIComponent).join("/")}` : "";
  const url = new URL(`${baseUrl}${path}`);
  const incoming = new URL(request.url);
  url.search = incoming.search;
  return url.toString();
}

async function readRequestBody(request: Request): Promise<BodyInit | undefined> {
  if (request.method === "GET" || request.method === "HEAD") return undefined;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("multipart/form-data")) {
    return request.blob();
  }

  const buffer = await request.arrayBuffer();
  return buffer.byteLength > 0 ? buffer : undefined;
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
    const responseBody = await upstream.arrayBuffer();

    return new Response(responseBody, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    return handleGatewayFailure(err, service);
  } finally {
    clearTimeout(timeoutId);
  }
}
