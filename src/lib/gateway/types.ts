export type GatewayServiceKey = "auth" | "billing" | "users";

export interface GatewayErrorBody {
  success: false;
  error: string;
  code?: string;
  service?: GatewayServiceKey;
}

export interface GatewaySuccessBody {
  success: true;
  data: unknown;
}

export type GatewayResponseBody = GatewayErrorBody | GatewaySuccessBody;

export interface ProxyOptions {
  service: GatewayServiceKey;
  request: Request;
  pathSegments: string[];
  /** Override default upstream timeout (ms). */
  timeoutMs?: number;
}
