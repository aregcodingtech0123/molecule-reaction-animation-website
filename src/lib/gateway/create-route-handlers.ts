import { proxyToService } from "./proxy";
import type { GatewayServiceKey } from "./types";

type RouteContext = { params: Promise<{ path: string[] }> };

async function handleGatewayRequest(
  service: GatewayServiceKey,
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { path } = await context.params;
  return proxyToService({
    service,
    request,
    pathSegments: path ?? [],
  });
}

/**
 * Factory for catch-all App Router handlers (`[...path]/route.ts`).
 * Registers all common HTTP verbs on the gateway proxy.
 */
export function createGatewayRouteHandlers(service: GatewayServiceKey) {
  const handler = (request: Request, context: RouteContext) =>
    handleGatewayRequest(service, request, context);

  return {
    GET: handler,
    POST: handler,
    PUT: handler,
    PATCH: handler,
    DELETE: handler,
    OPTIONS: handler,
  };
}
