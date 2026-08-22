import { pool } from "../db/index.js";
/**
 * In-process positive cache of revoked JTIs.
 * Avoids a DB round-trip on every subsequent request after logout on this instance.
 * Key = jti, value = expiresAt epoch ms (drop after natural JWT expiry).
 */
const revokedJtiCache = new Map();
const PURGE_EVERY_N_CHECKS = 256;
let checksSincePurge = 0;
function cacheGet(jti) {
    const expiresAtMs = revokedJtiCache.get(jti);
    if (expiresAtMs === undefined)
        return null;
    if (expiresAtMs <= Date.now()) {
        revokedJtiCache.delete(jti);
        return null;
    }
    return true;
}
function cacheSet(jti, expiresAt) {
    revokedJtiCache.set(jti, expiresAt.getTime());
}
/**
 * PK lookup on `revoked_tokens.jti` — indexed, constant-time relative to table size.
 * Skips expired rows so stale blacklist entries do not keep denying forever after purge lag.
 */
export async function isJtiRevoked(jti) {
    const cached = cacheGet(jti);
    if (cached === true)
        return true;
    const result = await pool.query(`SELECT expires_at
     FROM revoked_tokens
     WHERE jti = $1
       AND expires_at > NOW()
     LIMIT 1`, [jti]);
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
export async function revokeJti(jti, expiresAt) {
    await pool.query(`INSERT INTO revoked_tokens (jti, expires_at)
     VALUES ($1, $2)
     ON CONFLICT (jti) DO NOTHING`, [jti, expiresAt]);
    cacheSet(jti, expiresAt);
}
/** Delete rows that can never match a live JWT (exp already passed). */
export async function purgeExpiredRevokedTokens() {
    const result = await pool.query(`DELETE FROM revoked_tokens WHERE expires_at <= NOW()`);
    const deleted = result.rowCount ?? 0;
    const now = Date.now();
    for (const [jti, expiresAtMs] of revokedJtiCache) {
        if (expiresAtMs <= now)
            revokedJtiCache.delete(jti);
    }
    return deleted;
}
function maybeSchedulePurge() {
    checksSincePurge += 1;
    if (checksSincePurge < PURGE_EVERY_N_CHECKS)
        return;
    checksSincePurge = 0;
    void purgeExpiredRevokedTokens().catch((err) => {
        console.warn("[tokenRevocation] purge failed:", err);
    });
}
//# sourceMappingURL=tokenRevocation.service.js.map