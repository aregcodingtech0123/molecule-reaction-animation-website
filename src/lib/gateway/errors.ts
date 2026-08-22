import type { GatewayErrorBody, GatewayServiceKey } from "./types";

export const GATEWAY_ERROR_CODES = {
  SERVICE_NOT_CONFIGURED: "SERVICE_NOT_CONFIGURED",
  SERVICE_UNAVAILABLE: "SERVICE_UNAVAILABLE",
  UPSTREAM_TIMEOUT: "UPSTREAM_TIMEOUT",
  UPSTREAM_ERROR: "UPSTREAM_ERROR",
  BAD_GATEWAY: "BAD_GATEWAY",
} as const;

export type GatewayErrorCode = (typeof GATEWAY_ERROR_CODES)[keyof typeof GATEWAY_ERROR_CODES];

export class GatewayError extends Error {
  readonly status: number;
  readonly code: GatewayErrorCode;
  readonly service?: GatewayServiceKey;

  constructor(
    status: number,
    code: GatewayErrorCode,
    message: string,
    service?: GatewayServiceKey,
  ) {
    super(message);
    this.name = "GatewayError";
    this.status = status;
    this.code = code;
    this.service = service;
  }
}

export function gatewayErrorJson(
  status: number,
  error: string,
  options?: { code?: GatewayErrorCode; service?: GatewayServiceKey },
): Response {
  const body: GatewayErrorBody = {
    success: false,
    error,
    code: options?.code,
    service: options?.service,
  };
  return Response.json(body, { status });
}

export function handleGatewayFailure(err: unknown, service?: GatewayServiceKey): Response {
  if (err instanceof GatewayError) {
    return gatewayErrorJson(err.status, err.message, {
      code: err.code,
      service: err.service ?? service,
    });
  }

  const name = err instanceof Error ? err.name : "";
  const message = err instanceof Error ? err.message : "Unknown gateway error";

  if (name === "AbortError" || message.includes("aborted")) {
    return gatewayErrorJson(504, "Upstream service timed out.", {
      code: GATEWAY_ERROR_CODES.UPSTREAM_TIMEOUT,
      service,
    });
  }

  if (
    message.includes("fetch failed") ||
    message.includes("ECONNREFUSED") ||
    message.includes("ENOTFOUND") ||
    message.includes("network")
  ) {
    return gatewayErrorJson(503, "Service temporarily unavailable.", {
      code: GATEWAY_ERROR_CODES.SERVICE_UNAVAILABLE,
      service,
    });
  }

  return gatewayErrorJson(502, "Bad gateway — upstream request failed.", {
    code: GATEWAY_ERROR_CODES.BAD_GATEWAY,
    service,
  });
}
