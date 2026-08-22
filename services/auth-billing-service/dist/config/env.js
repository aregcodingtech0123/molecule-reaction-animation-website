import "../config/loadEnv.js";
import { assertDatabaseEnv, resolveDatabaseEnv } from "./database.js";
const BCRYPT_ROUNDS = 10;
function parseIntEnv(name, fallback) {
    const value = Number(process.env[name]);
    return Number.isFinite(value) ? value : fallback;
}
function readEnv(name) {
    return process.env[name]?.trim() ?? "";
}
export const env = {
    host: process.env.HOST?.trim() || "0.0.0.0",
    port: parseIntEnv("PORT", 4000),
    nodeEnv: process.env.NODE_ENV ?? "development",
    get databaseUrl() {
        return resolveDatabaseEnv().connectionString;
    },
    get database() {
        return resolveDatabaseEnv();
    },
    jwtSecret: process.env.JWT_SECRET ?? "",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
    bcryptRounds: parseIntEnv("BCRYPT_ROUNDS", BCRYPT_ROUNDS),
    isProduction: (process.env.NODE_ENV ?? "development") === "production",
    get frontendUrl() {
        return (readEnv("FRONTEND_URL") || "http://localhost:3000").replace(/\/+$/, "");
    },
    get googleClientId() {
        return readEnv("GOOGLE_CLIENT_ID");
    },
    // ── Shopier (TR / TRY) ────────────────────────────────────────────────────
    get shopierApiKey() {
        return readEnv("SHOPIER_API_KEY");
    },
    get shopierApiSecret() {
        return readEnv("SHOPIER_API_SECRET");
    },
    get shopierWebsiteIndex() {
        return readEnv("SHOPIER_WEBSITE_INDEX") || "1";
    },
    /** Optional REST webhook token (Shopier-Signature). Classic callback uses API secret. */
    get shopierWebhookToken() {
        return readEnv("SHOPIER_WEBHOOK_TOKEN");
    },
    // ── Lemon Squeezy (Global / USD MoR) ──────────────────────────────────────
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
    // ── Email (Resend) ────────────────────────────────────────────────────────
    get resendApiKey() {
        return readEnv("RESEND_API_KEY");
    },
    get emailFrom() {
        return readEnv("EMAIL_FROM") || "MoleculeStudio <onboarding@resend.dev>";
    },
};
export function assertEnv() {
    assertDatabaseEnv();
    if (!env.jwtSecret || env.jwtSecret.length < 32) {
        throw new Error("JWT_SECRET must be at least 32 characters.");
    }
    if (env.isProduction && !env.googleClientId) {
        console.warn("[env] GOOGLE_CLIENT_ID is not set — POST /api/auth/google will return 503.");
    }
}
export function lemonVariantForPackage(packageId) {
    if (packageId === "starter")
        return env.lemonSqueezyVariantStarter;
    if (packageId === "pro")
        return env.lemonSqueezyVariantPro;
    return "";
}
//# sourceMappingURL=env.js.map