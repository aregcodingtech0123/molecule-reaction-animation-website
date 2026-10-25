import "../config/loadEnv.js";
import { assertDatabaseEnv, resolveDatabaseEnv } from "./database.js";

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

/**
 * Production rules apply unless NODE_ENV is explicitly "development" or "test". An unset or
 * unexpected value ("staging", a typo) must fail closed — not quietly enable dev-only behaviour
 * such as logging verification / reset links instead of mailing them (SEC-08).
 */
export function isProductionNodeEnv(value: string | undefined): boolean {
  const mode = value?.trim().toLowerCase();
  return mode !== "development" && mode !== "test";
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

  // ── AI credit reservations ────────────────────────────────────────────────
  /** How long a reservation may stay 'held' before it expires (never charged). */
  get aiHoldTtlSeconds() {
    const v = Number(readEnv("AI_HOLD_TTL_SECONDS"));
    return Number.isInteger(v) && v > 0 ? v : 600;
  },
  /** How often the service settles expired reservations. 0 disables the timer. */
  get aiHoldSweepIntervalMs() {
    const raw = readEnv("AI_HOLD_SWEEP_INTERVAL_MS");
    const v = Number(raw);
    return raw !== "" && Number.isInteger(v) && v >= 0 ? v : 300_000;
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

const LEMON_VARIANT_ENV = [
  "LEMONSQUEEZY_VARIANT_STARTER",
  "LEMONSQUEEZY_VARIANT_PRO",
  "LEMONSQUEEZY_VARIANT_ENTERPRISE",
] as const;

/**
 * Why the Lemon variant → pack mapping is unusable, or null when it is fine.
 * The mapping comes from the environment only (FINDING-13): a missing,
 * non-numeric or shared variant id would credit the wrong pack or none.
 */
export function lemonVariantConfigProblem(source: NodeJS.ProcessEnv = process.env): string | null {
  const missing: string[] = [];
  const invalid: string[] = [];
  const seen = new Map<string, string>();
  for (const name of LEMON_VARIANT_ENV) {
    const value = source[name]?.trim() ?? "";
    if (!value) {
      missing.push(name);
    } else if (!/^\d+$/.test(value)) {
      invalid.push(name);
    } else if (seen.has(value)) {
      return `${name} and ${seen.get(value)} use the same variant id ${value}; each pack needs its own.`;
    } else {
      seen.set(value, name);
    }
  }
  if (missing.length) {
    return `${missing.join(", ")} not set — purchases of those packs cannot be mapped to credits.`;
  }
  if (invalid.length) {
    return `${invalid.join(", ")} must be a numeric Lemon Squeezy variant id.`;
  }
  return null;
}

export function lemonVariantForPackage(packageId: string): string {
  if (packageId === "starter") return env.lemonSqueezyVariantStarter;
  if (packageId === "pro") return env.lemonSqueezyVariantPro;
  if (packageId === "enterprise") return env.lemonSqueezyVariantEnterprise;
  return "";
}
