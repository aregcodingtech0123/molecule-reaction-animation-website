import "./config/loadEnv.js";
import { assertEnv, env, lemonVariantConfigProblem } from "./config/env.js";
import { createApp } from "./app.js";
import { closePool, isDatabaseReady, verifyDatabaseConnection } from "./db/index.js";
import { weakSecretReason } from "./config/secretStrength.js";
import { productionConfigProblems } from "./config/productionConfig.js";
import { releaseExpiredHolds } from "./services/aiCredits.service.js";
import { clearOldWebhookPayloads, retryStoredWebhookEvents } from "./services/webhookInbox.service.js";

const PORT = env.port;

function enforceProductionSecurityGuards(): void {
  for (const name of ["JWT_SECRET", "INTERNAL_SERVICE_SECRET"] as const) {
    const reason = weakSecretReason(name, process.env[name]);
    if (reason) {
      console.error(`FATAL: ${reason} Exiting.`);
      process.exit(1);
    }
  }

  // Production rules apply unless NODE_ENV is explicitly development/test (SEC-08): every secret
  // and URL is validated up front and the whole list is reported, so a misconfigured deploy fails
  // closed instead of serving with forgeable webhooks, localhost links or a sandbox mail sender.
  if (env.isProduction) {
    const problems = productionConfigProblems();
    if (problems.length > 0) {
      for (const problem of problems) console.error(`FATAL: ${problem}`);
      console.error(
        `FATAL: refusing to start with production rules (NODE_ENV=${env.nodeEnv || "<unset>"}; ` +
          "only NODE_ENV=development or test relaxes them). Exiting.",
      );
      process.exit(1);
    }
    return;
  }

  // Variant ids come from the environment only (FINDING-13); outside production a warning.
  const variantProblem = lemonVariantConfigProblem();
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

/**
 * Periodically process stored Lemon webhook events that failed or were never picked up (R19), and clear
 * the payload of events processed more than 30 days ago.
 */
function startWebhookRetryWorker(): void {
  const intervalMs = env.webhookRetryIntervalMs;
  if (intervalMs <= 0) return;
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    // After an outage nothing else may probe the database on a quiet site: do it here (single-flight).
    if (!isDatabaseReady()) {
      void verifyDatabaseConnection();
      return;
    }
    running = true;
    void retryStoredWebhookEvents()
      .then(async (r) => {
        if (r.processed + r.failed > 0) {
          console.warn(`[Webhook] Retried stored events: ${r.processed} processed, ${r.failed} still failing (see db:reconcile).`);
        }
        await clearOldWebhookPayloads();
      })
      .catch((err) => console.error("[Webhook] Stored-event retry failed:", err instanceof Error ? err.message : err))
      .finally(() => {
        running = false;
      });
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
      startWebhookRetryWorker();
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
