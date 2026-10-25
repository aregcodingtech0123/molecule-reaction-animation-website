import type { GatewayServiceKey } from "./types";

export interface GatewayServiceConfig {
  key: GatewayServiceKey;
  envVar: string;
  /** Human-readable label for logs and error payloads */
  label: string;
  /** Default upstream timeout in milliseconds */
  defaultTimeoutMs: number;
}

export const GATEWAY_SERVICES: Record<GatewayServiceKey, GatewayServiceConfig> = {
  auth: {
    key: "auth",
    envVar: "AUTH_SERVICE_URL",
    label: "Auth Service",
    defaultTimeoutMs: 10_000,
  },
  billing: {
    key: "billing",
    envVar: "BILLING_SERVICE_URL",
    label: "Billing Service",
    defaultTimeoutMs: 15_000,
  },
  users: {
    key: "users",
    envVar: "USERS_SERVICE_URL",
    label: "Users Service",
    defaultTimeoutMs: 10_000,
  },
};

export function getServiceBaseUrl(service: GatewayServiceKey): string | null {
  const config = GATEWAY_SERVICES[service];
  const raw = process.env[config.envVar]?.trim();
  if (!raw) return null;
  return raw.replace(/\/+$/, "");
}
