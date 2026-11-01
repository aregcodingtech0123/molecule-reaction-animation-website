import type { Request } from "express";
import rateLimit from "express-rate-limit";

/** Trusted client address (resolveClientIp) - never a raw X-Forwarded-For value. */
const ip = (req: Request) => req.clientIp ?? req.ip ?? "unknown";
/** X-Forwarded-For is resolved deliberately via TRUST_PROXY_HOPS; silence the library guess. */
const validate = { xForwardedForHeader: false } as const;
/**
 * The account an email-keyed limit protects, normalised exactly like normalizeEmail() (trim +
 * lower-case) — otherwise whitespace/case variants of one address each get a fresh bucket (SEC-06).
 */
const emailKey = (req: Request) => {
  const email = req.body?.email;
  return typeof email === "string" ? email.trim().toLowerCase() : "";
};

/** Login: 5 attempts per 15 minutes per IP + email. */
export const loginRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${ip(req)}:${emailKey(req)}`,
  message: { success: false, error: "TOO_MANY_ATTEMPTS", retryAfter: 900 },
  validate,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Register: 3 registrations per hour per IP. */
export const registerRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => ip(req),
  message: { success: false, error: "TOO_MANY_REGISTRATIONS", retryAfter: 3600 },
  validate,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Google OAuth: 10 per 15 minutes per IP. */
export const googleRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => ip(req),
  message: { success: false, error: "TOO_MANY_ATTEMPTS", retryAfter: 900 },
  validate,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Forgot password / resend verification: 5 per hour per IP. */
export const emailActionRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `${ip(req)}:${emailKey(req)}`,
  message: { success: false, error: "TOO_MANY_ATTEMPTS", retryAfter: 3600 },
  validate,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Verify / reset with token: 20 per hour per IP. */
export const tokenActionRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => ip(req),
  message: { success: false, error: "TOO_MANY_ATTEMPTS", retryAfter: 3600 },
  validate,
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * Personal-data export: 5 requests per hour per account (counted whether or not the password was right, so it also
 * limits password guessing through this route). Mounted after requireAuth, so req.user is set.
 */
export const exportRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => `export:${req.user?.sub ?? ip(req)}`,
  message: { success: false, error: "TOO_MANY_ATTEMPTS", retryAfter: 3600 },
  validate,
  standardHeaders: true,
  legacyHeaders: false,
});

