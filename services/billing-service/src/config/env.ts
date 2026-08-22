import { z } from "zod";
import { assertDatabaseEnv, resolveDatabaseEnv } from "./database.js";

const SYSTEM_ACCOUNT_ID = "00000000-0000-0000-0000-000000000001";

function parseCorsOrigins(): string[] | true {
  const raw = process.env.CORS_ORIGINS?.trim();
  if (!raw || raw === "*") return true;
  return raw.split(",").map((o) => o.trim()).filter(Boolean);
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  port: Number(process.env.PORT ?? 4002),
  get databaseUrl() {
    return resolveDatabaseEnv().connectionString;
  },
  get database() {
    return resolveDatabaseEnv();
  },
  internalApiKey: process.env.INTERNAL_API_KEY ?? "",
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  corsOrigins: parseCorsOrigins(),
  isProduction: (process.env.NODE_ENV ?? "development") === "production",
  systemAccountId: SYSTEM_ACCOUNT_ID,
} as const;

export function assertEnv(): void {
  assertDatabaseEnv();
  if (!env.internalApiKey || env.internalApiKey.length < 24) {
    throw new Error("INTERNAL_API_KEY must be at least 24 characters.");
  }
}

export const deductSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().positive().max(10_000),
  reason: z.string().min(1).max(64).default("ai_molecule_generation"),
  idempotencyKey: z.string().min(8).max(128).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const grantSchema = z.object({
  userId: z.string().uuid(),
  amount: z.number().int().positive().max(100_000),
  reason: z.string().min(1).max(64),
  eventId: z.string().uuid().optional(),
});

export type DeductInput = z.infer<typeof deductSchema>;
export type GrantInput = z.infer<typeof grantSchema>;
