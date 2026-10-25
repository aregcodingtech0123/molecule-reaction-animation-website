/**
 * Next.js-side environment for BFF tests. JWT_SECRET is shared with the Express
 * service (set by the service env setup that runs first). Service URLs are
 * filled in per-suite once the in-process Express server has a port.
 */
for (const key of [
  "AUTH_SERVICE_URL",
  "BILLING_SERVICE_URL",
  "USERS_SERVICE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "GEMINI_MODEL",
]) {
  delete process.env[key];
}
process.env.GEMINI_API_KEY = "test-gemini-key-not-real";
// INTERNAL_SERVICE_SECRET comes from the service env setup (same value on both sides).
// Short, fixed backoff keeps capture/release retry tests fast and deterministic.
process.env.BILLING_RETRY_DELAYS_MS = "5,5,5";
// The platform header the BFF trusts for the end-user IP (Vercel-style).
process.env.CLIENT_IP_HEADER = "x-forwarded-for";
delete process.env.GEMINI_TIMEOUT_MS;
process.env.FRONTEND_URL = "http://localhost:3000";
