import type { SettlementClaims } from "../utils/settlementCapability.js";

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

declare module "express-serve-static-core" {
  interface Request {
    user?: JwtPayload;
    /** Authenticated user's UUID — mirrors `req.user.sub`. */
    userId?: string;
    /**
     * Client IP used for rate limiting and signup_ip: the BFF-supplied X-Client-IP when the
     * request carries the internal service key, otherwise req.ip (TRUST_PROXY_HOPS-aware).
     */
    clientIp?: string | null;
    /** Verified settlement capability claims, set only by requireSettlementCapability. Never comes from the request as is. */
    settlement?: SettlementClaims;
  }
}

/**
 * A payment-provider failure with no more specific answer: what the error handler's payment path means. It is chosen by this type
 * alone, never by an error's text. The message is fixed so it cannot carry the provider's words. The Lemon integration's own
 * refusals are AppErrors with their own status and code, and do not use this.
 */
export class PaymentProviderError extends Error {
  constructor(public readonly code: string = "PAYMENT_PROVIDER_ERROR") {
    super("Payment provider error.");
    this.name = "PaymentProviderError";
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
