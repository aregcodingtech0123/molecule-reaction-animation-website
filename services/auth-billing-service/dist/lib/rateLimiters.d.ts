/** Login: 5 attempts per 15 minutes per IP + email. */
export declare const loginRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
/** Register: 3 registrations per hour per IP. */
export declare const registerRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
/** Google OAuth: 10 per 15 minutes per IP. */
export declare const googleRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
/** Forgot password / resend verification: 5 per hour per IP. */
export declare const emailActionRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
/** Verify / reset with token: 20 per hour per IP. */
export declare const tokenActionRateLimiter: import("express-rate-limit").RateLimitRequestHandler;
