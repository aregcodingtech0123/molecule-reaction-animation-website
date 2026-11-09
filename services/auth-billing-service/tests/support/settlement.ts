import type pg from "pg";
import type { SettlementKeys } from "../../src/config/settlementSecret.js";
import { mintSettlementCapability, type SettlementBinding, type SettlementClaims, type SettlementPurpose } from "../../src/utils/settlementCapability.js";
import { TEST_ENV } from "../setup/env";

export const TEST_SETTLEMENT_KEYS: SettlementKeys = { current: TEST_ENV.SETTLEMENT_CAPABILITY_SECRET };

/** The body field carrying a capability on /capture and /refund. */
export const CAPABILITY_FIELD = "settlementCapability";

/**
 * What the persisted hold row says, read with its own SQL and floored here rather than in the query, so a test built on
 * it would notice the service computing these values differently.
 */
export async function persistedBinding(db: pg.Pool, userId: string, referenceId: string): Promise<SettlementBinding> {
  const { rows } = await db.query<{ user_id: string; reference_id: string; amount: number; operation_type: string; created: number; expires: number }>(
    `SELECT user_id::text, reference_id, amount, operation_type,
            EXTRACT(EPOCH FROM created_at)::float8 AS created, EXTRACT(EPOCH FROM expires_at)::float8 AS expires
     FROM ai_credit_holds WHERE user_id = $1 AND reference_id = $2`,
    [userId, referenceId],
  );
  const row = rows[0];
  if (!row) throw new Error("persistedBinding: no such hold");
  return {
    userId: row.user_id,
    referenceId: row.reference_id,
    amount: row.amount,
    operationType: row.operation_type,
    createdAtSeconds: Math.floor(row.created),
    reservationExpiresAtSeconds: Math.floor(row.expires),
  };
}

/** A correctly signed capability for the hold row as it is now, with optional deliberate differences. */
export async function mintForRow(
  db: pg.Pool,
  purpose: SettlementPurpose,
  userId: string,
  referenceId: string,
  overrides: Partial<SettlementBinding> = {},
  keys: SettlementKeys = TEST_SETTLEMENT_KEYS,
): Promise<string> {
  return mintSettlementCapability(purpose, { ...(await persistedBinding(db, userId, referenceId)), ...overrides }, keys);
}

/** The claims inside a token, without verifying it. */
export function claimsOf(token: string): SettlementClaims {
  return JSON.parse(Buffer.from(token.split(".")[1]!, "base64url").toString("utf8")) as SettlementClaims;
}
