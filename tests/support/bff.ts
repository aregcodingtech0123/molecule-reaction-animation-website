import { createGatewayRouteHandlers } from "@/lib/gateway";
import type { GatewayServiceKey } from "@/lib/gateway";

/**
 * Invoke the real App Router catch-all handler for `/api/<service>/<...path>`
 * exactly as Next would: a Web Request plus `{ params: Promise<{ path }> }`.
 */
export async function callGateway(
  service: GatewayServiceKey,
  path: string,
  init: RequestInit & { cookie?: string } = {},
): Promise<Response> {
  const url = new URL(`http://localhost:3000/api/${service}/${path}`);
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  const request = new Request(url, { ...init, headers });
  const handlers = createGatewayRouteHandlers(service);
  const method = (init.method ?? "GET").toUpperCase() as keyof typeof handlers;
  const segments = url.pathname.split("/").slice(3).filter(Boolean).map(decodeURIComponent);
  return handlers[method](request, { params: Promise.resolve({ path: segments }) });
}

export const sessionCookie = (token: string) => `theme=dark; session_token=${token}; other=1`;
