export interface JwtPayload {
  /** Standard JWT subject claim — the user's UUID (`users.id`). */
  sub: string;
  email: string;
  /** Unique token id — used for server-side revocation. */
  jti: string;
  /** Unix expiry (seconds) — mirrored into `revoked_tokens.expires_at` on logout. */
  exp: number;
  /** Session generation; must equal users.token_version. */
  tv: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      /** Authenticated user's UUID — mirrors `req.user.sub`. */
      userId?: string;
      /**
       * Client IP used for rate limiting and signup_ip: the BFF-supplied X-Client-IP when the
       * request carries the internal service key, otherwise req.ip (TRUST_PROXY_HOPS-aware).
       */
      clientIp?: string | null;
    }
  }
}

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
    /** Extra machine-readable fields merged into the JSON error body. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}
