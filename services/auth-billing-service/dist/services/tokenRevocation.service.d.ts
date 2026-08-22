/**
 * PK lookup on `revoked_tokens.jti` — indexed, constant-time relative to table size.
 * Skips expired rows so stale blacklist entries do not keep denying forever after purge lag.
 */
export declare function isJtiRevoked(jti: string): Promise<boolean>;
/** Persist revocation; idempotent under concurrent logout. */
export declare function revokeJti(jti: string, expiresAt: Date): Promise<void>;
/** Delete rows that can never match a live JWT (exp already passed). */
export declare function purgeExpiredRevokedTokens(): Promise<number>;
