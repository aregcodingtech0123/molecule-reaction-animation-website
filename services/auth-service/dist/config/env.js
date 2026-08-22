import { z } from "zod";
import { assertDatabaseEnv, resolveDatabaseEnv } from "./database.js";
const DEFAULT_BCRYPT_ROUNDS = 12;
const DEFAULT_JWT_EXPIRES = "7d";
const DEFAULT_SIGNUP_CREDITS = 10;
function parseBcryptRounds() {
    const raw = Number(process.env.BCRYPT_ROUNDS ?? DEFAULT_BCRYPT_ROUNDS);
    if (!Number.isFinite(raw) || raw < 10 || raw > 14)
        return DEFAULT_BCRYPT_ROUNDS;
    return Math.floor(raw);
}
function parseCorsOrigins() {
    const raw = process.env.CORS_ORIGINS?.trim();
    if (!raw || raw === "*")
        return true;
    return raw.split(",").map((o) => o.trim()).filter(Boolean);
}
export const env = {
    nodeEnv: process.env.NODE_ENV ?? "development",
    port: Number(process.env.PORT ?? 4001),
    get databaseUrl() {
        return resolveDatabaseEnv().connectionString;
    },
    get database() {
        return resolveDatabaseEnv();
    },
    jwtSecret: process.env.JWT_SECRET ?? "",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? DEFAULT_JWT_EXPIRES,
    bcryptRounds: parseBcryptRounds(),
    billingServiceUrl: process.env.BILLING_SERVICE_URL?.replace(/\/+$/, "") ?? "",
    internalApiKey: process.env.INTERNAL_API_KEY ?? "",
    signupCreditAmount: Number(process.env.SIGNUP_CREDIT_AMOUNT ?? DEFAULT_SIGNUP_CREDITS),
    corsOrigins: parseCorsOrigins(),
    isProduction: (process.env.NODE_ENV ?? "development") === "production",
};
export function assertEnv() {
    assertDatabaseEnv();
    if (!env.jwtSecret || env.jwtSecret.length < 32) {
        throw new Error("JWT_SECRET must be at least 32 characters.");
    }
}
export const registerSchema = z.object({
    email: z.string().email().max(320).transform((v) => v.toLowerCase().trim()),
    password: z
        .string()
        .min(8, "Password must be at least 8 characters.")
        .max(128)
        .regex(/[A-Za-z]/, "Password must contain a letter.")
        .regex(/[0-9]/, "Password must contain a number."),
    displayName: z.string().min(2).max(120).trim().optional(),
});
export const loginSchema = z.object({
    email: z.string().email().max(320).transform((v) => v.toLowerCase().trim()),
    password: z.string().min(1).max(128),
});
//# sourceMappingURL=env.js.map