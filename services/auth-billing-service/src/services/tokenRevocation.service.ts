import { pool } from "../db/index.js";

/**
 * In-process positive cache of revoked JTIs.
 * Avoids a DB round-trip on every subsequent request after logout on this instance.
 * Key = jti, value = expiresAt epoch ms (drop after natural JWT expiry).
 */
const revokedJtiCache = new Map<string, number>();

const PURGE_EVERY_N_CHECKS = 256;
let checksSincePurge = 0;

function cacheGet(jti: string): boolean | null {
  const expiresAtMs = revokedJtiCache.get(jti);
  if (expiresAtMs === undefined) return null;
  if (expiresAtMs <= Date.now()) {
    revokedJtiCache.delete(jti);
    return null;
  }
  return true;
}

function cacheSet(jti: string, expiresAt: Date): void {
  revokedJtiCache.set(jti, expiresAt.getTime());
}

/**
 * PK lookup on `revoked_tokens.jti` — indexed, constant-time relative to table size.
 * Skips expired rows so stale blacklist entries do not keep denying forever after purge lag.
 */
export async function isJtiRevoked(jti: string): Promise<boolean> {
  const cached = cacheGet(jti);
  if (cached === true) return true;

  const result = await pool.query<{ expires_at: Date }>(
    `SELECT expires_at
     FROM revoked_tokens
     WHERE jti = $1
       AND expires_at > NOW()
     LIMIT 1`,
    [jti],
  );

  const row = result.rows[0];
  if (!row) {
    maybeSchedulePurge();
    return false;
  }

  cacheSet(jti, row.expires_at);
  maybeSchedulePurge();
  return true;
}

/** Persist revocation; idempotent under concurrent logout. */
export async function revokeJti(jti: string, expiresAt: Date): Promise<void> {
  await pool.query(
    `INSERT INTO revoked_tokens (jti, expires_at)
     VALUES ($1, $2)
     ON CONFLICT (jti) DO NOTHING`,
    [jti, expiresAt],
  );
  cacheSet(jti, expiresAt);
}

/** Delete rows that can never match a live JWT (exp already passed). */
export async function purgeExpiredRevokedTokens(): Promise<number> {
  const result = await pool.query(`DELETE FROM revoked_tokens WHERE expires_at <= NOW()`);
  const deleted = result.rowCount ?? 0;

  const now = Date.now();
  for (const [jti, expiresAtMs] of revokedJtiCache) {
    if (expiresAtMs <= now) revokedJtiCache.delete(jti);
  }

  return deleted;
}

function maybeSchedulePurge(): void {
  checksSincePurge += 1;
  if (checksSincePurge < PURGE_EVERY_N_CHECKS) return;
  checksSincePurge = 0;
  void purgeExpiredRevokedTokens().catch((err) => {
    console.warn("[tokenRevocation] purge failed:", err);
  });
}
