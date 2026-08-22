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

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}
