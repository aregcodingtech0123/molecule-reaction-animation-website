import { createHmac } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { env } from "../config/env.js";

/** Tombstones count for this long; the daily job deletes older ones, and lookups ignore them even before that. */
export const TOMBSTONE_RETENTION_SQL = "12 months";

/**
 * Keyed hash of an e-mail address: HMAC-SHA256(EMAIL_TOMBSTONE_SECRET, lower(trim(email))). A plain hash of an address can be
 * reversed by trying addresses; with the key only this service can compute it. Returns null when the guard is off or has no
 * secret (non-production only - production refuses to start without one), so callers never store an unkeyed value.
 */
export function emailTombstoneKey(email: string): Buffer | null {
  if (!env.emailTombstoneGuardEnabled) return null;
  const secret = env.emailTombstoneSecret;
  if (!secret) return null;
  return createHmac("sha256", secret).update(email.trim().toLowerCase()).digest();
}

/** Was this address used by an account that was deleted less than 12 months ago? */
export async function isEmailTombstoned(db: Pool | PoolClient, email: string): Promise<boolean> {
  const key = emailTombstoneKey(email);
  if (!key) return false;
  const { rowCount } = await db.query(
    `SELECT 1 FROM deleted_email_tombstones WHERE email_hmac = $1 AND created_at > NOW() - INTERVAL '${TOMBSTONE_RETENTION_SQL}' LIMIT 1`,
    [key],
  );
  return (rowCount ?? 0) > 0;
}
