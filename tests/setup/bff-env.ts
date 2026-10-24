/**
 * Next.js-side environment for BFF tests. JWT_SECRET is shared with the Express
 * service (set by the service env setup that runs first). Service URLs are
 * filled in per-suite once the in-process Express server has a port.
 */
for (const key of [
  "AUTH_SERVICE_URL",
  "BILLING_SERVICE_URL",
  "USERS_SERVICE_URL",
  "AI_ENGINE_URL",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "GEMINI_MODEL",
]) {
  delete process.env[key];
}
process.env.GEMINI_API_KEY = "test-gemini-key-not-real";
process.env.FRONTEND_URL = "http://localhost:3000";
