import "./config/loadEnv.js";
import { assertEnv, env } from "./config/env.js";
import { createApp } from "./app.js";
import { closePool, isDatabaseReady, verifyDatabaseConnection } from "./db/index.js";

const PORT = env.port;

const WEAK_SECRETS = [
  "replace-with-at-least-32-characters-secret-key",
  "changeme",
  "secret",
  "your-secret-here",
  "jwt-secret",
];

function enforceProductionSecurityGuards(): void {
  const jwtSecret = process.env.JWT_SECRET ?? "";
  if (WEAK_SECRETS.some((weak) => jwtSecret.includes(weak))) {
    console.error("FATAL: JWT_SECRET matches a known weak/placeholder value. Exiting.");
    process.exit(1);
  }

  if (jwtSecret.length < 32) {
    console.error("FATAL: JWT_SECRET must be at least 32 characters. Exiting.");
    process.exit(1);
  }
}

function resolveListenHost(): string {
  if (process.env.HOST?.trim()) {
    return process.env.HOST.trim();
  }
  // SECURITY-TODO: In containerized/cloud deployments, bind to the pod interface
  // and restrict ingress via private network ACL — not only localhost.
  return env.isProduction ? "127.0.0.1" : "0.0.0.0";
}

function logPaymentProviders(): void {
  console.log(
    "💳 Lemon Squeezy (USD — sole provider):",
    env.lemonSqueezyApiKey && env.lemonSqueezyStoreId ? "CONFIGURED" : "MISSING",
  );
  if (env.nodeEnv === "development" && (!env.lemonSqueezyApiKey || !env.lemonSqueezyStoreId)) {
    console.warn(
      "[auth-billing-service] Set LEMONSQUEEZY_API_KEY + LEMONSQUEEZY_STORE_ID + variant IDs for checkout.",
    );
  }
}

function logStartupWarnings(): void {
  try {
    assertEnv();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[auth-billing-service] Environment warning: ${message}`);
    console.warn(
      "[auth-billing-service] Copy services/auth-billing-service/.env.example → .env and set JWT_SECRET (32+ chars) plus database credentials.",
    );
  }
}

async function bootstrap(): Promise<void> {
  enforceProductionSecurityGuards();
  logStartupWarnings();
  logPaymentProviders();

  const app = createApp();
  const HOST = resolveListenHost();

  try {
    await verifyDatabaseConnection();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn(`[auth-billing-service] Database probe error: ${message}`);
  }

  await new Promise<void>((resolve, reject) => {
    const server = app.listen(PORT, HOST, () => {
      console.log(`🚀 Auth Microservice running seamlessly on port ${PORT}`);
      console.log(`[auth-billing-service] bound to ${HOST}:${PORT}`);
      console.log(
        `[auth-billing-service] database: ${isDatabaseReady() ? "connected" : "unavailable — auth/billing routes may return 503"}`,
      );
      console.log(
        "[auth-billing-service] POST /api/billing/checkout · POST /api/billing/webhooks/lemonsqueezy",
      );
      resolve();
    });

    server.on("error", (err) => {
      reject(err);
    });

    async function shutdown(signal: string) {
      console.log(`[auth-billing-service] ${signal} — shutting down`);
      server.close(async () => {
        await closePool();
        process.exit(0);
      });
    }

    process.on("SIGINT", () => void shutdown("SIGINT"));
    process.on("SIGTERM", () => void shutdown("SIGTERM"));
  });
}

bootstrap().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[auth-billing-service] failed to bind port ${PORT}: ${message}`);
  process.exit(1);
});
