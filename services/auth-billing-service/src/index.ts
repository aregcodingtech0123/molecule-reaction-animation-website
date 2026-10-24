import "./config/loadEnv.js";
import { assertEnv, env, lemonVariantConfigProblem } from "./config/env.js";
import { createApp } from "./app.js";
import { closePool, isDatabaseReady, verifyDatabaseConnection } from "./db/index.js";
import { weakSecretReason } from "./config/secretStrength.js";
import { releaseExpiredHolds } from "./services/aiCredits.service.js";

const PORT = env.port;

function enforceProductionSecurityGuards(): void {
  for (const name of ["JWT_SECRET", "INTERNAL_SERVICE_SECRET"] as const) {
    const reason = weakSecretReason(name, process.env[name]);
    if (reason) {
      console.error(`FATAL: ${reason} Exiting.`);
      process.exit(1);
    }
  }

  // Variant ids come from the environment only (FINDING-13); production fails closed.
  const variantProblem = lemonVariantConfigProblem();
  if (variantProblem && env.isProduction) {
    console.error(`FATAL: ${variantProblem} Exiting.`);
    process.exit(1);
  }
  if (variantProblem) {
    console.warn(`[auth-billing-service] ${variantProblem}`);
  }
}

/** Periodically settle AI reservations that were never captured or released (never charged). */
function startExpiredHoldSweeper(): void {
  const intervalMs = env.aiHoldSweepIntervalMs;
  if (intervalMs <= 0) return;
  const timer = setInterval(() => {
    if (!isDatabaseReady()) return;
    void releaseExpiredHolds()
      .then((n) => {
        if (n > 0) console.warn(`[credits] Settled ${n} expired AI reservation(s) as not charged (see db:reconcile).`);
      })
      .catch((err) => console.error("[credits] Expired-hold sweep failed:", err instanceof Error ? err.message : err));
  }, intervalMs);
  timer.unref();
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
      startExpiredHoldSweeper();
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
