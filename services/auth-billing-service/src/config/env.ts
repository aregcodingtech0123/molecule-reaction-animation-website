import "../config/loadEnv.js";
import { assertDatabaseEnv, resolveDatabaseEnv } from "./database.js";
import { aiDailyTurnLimits, aiHoldTtlSeconds, emailTombstoneGuardSetting, isProductionNodeEnv } from "./productionConfig.js";

const BCRYPT_ROUNDS = 10;

function parseIntEnv(name: string, fallback: number): number {
  // An empty value means "not set": Number("") is 0, which used to give e.g. bcrypt cost 0 (SEC-08).
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function readEnv(name: string): string {
  return process.env[name]?.trim() ?? "";
}

export const env = {
  host: process.env.HOST?.trim() || "0.0.0.0",
  port: parseIntEnv("PORT", 4000),
  /** Raw NODE_ENV for messages ("" when unset). Use `isProduction` for decisions. */
  get nodeEnv() {
    return process.env.NODE_ENV?.trim() ?? "";
  },
  get databaseUrl() {
    return resolveDatabaseEnv().connectionString;
  },
  get database() {
    return resolveDatabaseEnv();
  },
  jwtSecret: process.env.JWT_SECRET ?? "",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  bcryptRounds: parseIntEnv("BCRYPT_ROUNDS", BCRYPT_ROUNDS),
  get isProduction() {
    return isProductionNodeEnv(process.env.NODE_ENV);
  },
  get frontendUrl() {
    return (readEnv("FRONTEND_URL") || "http://localhost:3000").replace(/\/+$/, "");
  },
  get googleClientId() {
    return readEnv("GOOGLE_CLIENT_ID");
  },

  // ── Lemon Squeezy (sole payment provider — USD MoR) ───────────────────────
  get lemonSqueezyApiKey() {
    return readEnv("LEMONSQUEEZY_API_KEY");
  },
  get lemonSqueezyStoreId() {
    return readEnv("LEMONSQUEEZY_STORE_ID");
  },
  get lemonSqueezyWebhookSecret() {
    return readEnv("LEMONSQUEEZY_WEBHOOK_SECRET");
  },
  get lemonSqueezyVariantStarter() {
    return readEnv("LEMONSQUEEZY_VARIANT_STARTER");
  },
  get lemonSqueezyVariantPro() {
    return readEnv("LEMONSQUEEZY_VARIANT_PRO");
  },
  get lemonSqueezyVariantEnterprise() {
    return readEnv("LEMONSQUEEZY_VARIANT_ENTERPRISE");
  },
  /** Production credits test-mode orders only with this explicit opt-in (staging stores). */
  get lemonSqueezyAllowTestMode() {
    return readEnv("LEMONSQUEEZY_ALLOW_TEST_MODE") === "true";
  },

  // ── Internal service-to-service credential (BFF → this service) ───────────
  /** Shared secret the Next.js BFF sends as X-Internal-Service-Key on metering calls. */
  get internalServiceSecret() {
    return readEnv("INTERNAL_SERVICE_SECRET");
  },

  // ── Client IP resolution (FINDING-04) ─────────────────────────────────────
  /**
   * Number of reverse proxies in front of this service whose X-Forwarded-For entries are
   * trusted for DIRECT traffic. 0 (default) = ignore X-Forwarded-For entirely, because this
   * service is publicly reachable for webhooks and any client could otherwise spoof its IP.
   * Set it to the number of proxies your platform adds (e.g. 1 behind a single load balancer
   * that appends the client address). BFF traffic uses X-Client-IP + the internal key instead.
   */
  get trustProxyHops() {
    const v = Number(readEnv("TRUST_PROXY_HOPS"));
    return Number.isInteger(v) && v >= 0 ? v : 0;
  },

  // ── Account deletion: re-registration guard ───────────────────────────────
  /** False when EMAIL_TOMBSTONE_GUARD is off: no lookup, no bonus skip, no tombstone is written. */
  get emailTombstoneGuardEnabled() {
    return emailTombstoneGuardSetting(process.env).enabled;
  },
  /** Key of the e-mail hash (HMAC-SHA256). Its own secret; never reused for anything else. */
  get emailTombstoneSecret() {
    return readEnv("EMAIL_TOMBSTONE_SECRET");
  },

  // ── AI credit reservations ────────────────────────────────────────────────
  /** How long a reservation may stay 'held' before it expires (never charged). */
  get aiHoldTtlSeconds() {
    return aiHoldTtlSeconds(process.env);
  },
  /** AI turns per rolling 24 h, per user and service-wide (SEC-16). */
  get aiDailyTurnLimits() {
    return aiDailyTurnLimits(process.env);
  },
  /** How often the service settles expired reservations. 0 disables the timer. */
  get aiHoldSweepIntervalMs() {
    const raw = readEnv("AI_HOLD_SWEEP_INTERVAL_MS");
    const v = Number(raw);
    return raw !== "" && Number.isInteger(v) && v >= 0 ? v : 300_000;
  },

  // ── Lemon Squeezy webhook inbox (R19) ─────────────────────────────────────
  /**
   * Longest the webhook waits to store a delivery before answering 503 (Lemon then retries it after 5 s,
   * 25 s, 125 s). Keeps a slow or resuming database from holding Lemon's request open.
   */
  get webhookStoreTimeoutMs() {
    const v = Number(readEnv("WEBHOOK_STORE_TIMEOUT_MS"));
    return Number.isInteger(v) && v > 0 ? v : 3_000;
  },
  /** How often stored events that failed (or never ran) are processed again. 0 disables the timer. */
  get webhookRetryIntervalMs() {
    const raw = readEnv("WEBHOOK_RETRY_INTERVAL_MS");
    const v = Number(raw);
    return raw !== "" && Number.isInteger(v) && v >= 0 ? v : 60_000;
  },

  // ── Email (Resend) ────────────────────────────────────────────────────────
  get resendApiKey() {
    return readEnv("RESEND_API_KEY");
  },
  /** Preferred sender identity. Falls back to EMAIL_FROM for older configs. */
  get senderEmail() {
    return (
      readEnv("SENDER_EMAIL") ||
      readEnv("EMAIL_FROM") ||
      "MoleculeStudio <onboarding@resend.dev>"
    );
  },
  /** @deprecated Prefer `senderEmail` / SENDER_EMAIL */
  get emailFrom() {
    return this.senderEmail;
  },
} as const;

export function assertEnv(): void {
  assertDatabaseEnv();
  if (!env.jwtSecret || env.jwtSecret.length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters.");
  }
  if (env.isProduction && !env.googleClientId) {
    console.warn("[env] GOOGLE_CLIENT_ID is not set — POST /api/auth/google will return 503.");
  }
}

// Lives in productionConfig.ts (free of env-loading side effects, so check:config can use it).
export { isProductionNodeEnv, lemonVariantConfigProblem } from "./productionConfig.js";

export function lemonVariantForPackage(packageId: string): string {
  if (packageId === "starter") return env.lemonSqueezyVariantStarter;
  if (packageId === "pro") return env.lemonSqueezyVariantPro;
  if (packageId === "enterprise") return env.lemonSqueezyVariantEnterprise;
  return "";
}
