export interface JwtPayload {
    /** Standard JWT subject claim — the user's UUID (`users.id`). */
    sub: string;
    email: string;
    /** Unique token id — used for server-side revocation. */
    jti: string;
    /** Unix expiry (seconds) — mirrored into `revoked_tokens.expires_at` on logout. */
    exp: number;
}
declare global {
    namespace Express {
        interface Request {
            user?: JwtPayload;
            /** Authenticated user's UUID — mirrors `req.user.sub`. */
            userId?: string;
        }
    }
}
export declare class AppError extends Error {
    readonly statusCode: number;
    readonly code?: string | undefined;
    /** Extra machine-readable fields merged into the JSON error body. */
    readonly details?: Record<string, unknown> | undefined;
    constructor(statusCode: number, message: string, code?: string | undefined, 
    /** Extra machine-readable fields merged into the JSON error body. */
    details?: Record<string, unknown> | undefined);
}
