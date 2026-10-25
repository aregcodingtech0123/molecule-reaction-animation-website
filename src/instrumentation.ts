import { weakSecretReason } from "@/lib/security/secret-strength";

/**
 * Next.js calls register() once when a server instance starts. Refuse to start
 * without a strong INTERNAL_SERVICE_SECRET: without it every AI Lab turn would
 * fail at the billing service (FINDING-03). Never runs the check during
 * `next build` (NEXT_PHASE=phase-production-build), which has no runtime secrets.
 */
export function assertServerSecrets(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NEXT_PHASE === "phase-production-build") return;
  const reason = weakSecretReason("INTERNAL_SERVICE_SECRET", env.INTERNAL_SERVICE_SECRET);
  if (reason) {
    throw new Error(`FATAL: ${reason} The BFF cannot call the billing service without it.`);
  }
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function frontendUrlProblem(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return "FRONTEND_URL is not set (the public origin; every state-changing request is checked against it).";
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return "FRONTEND_URL must be an absolute URL such as https://studio.example.";
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) {
    return "FRONTEND_URL must use https (http is accepted for localhost only).";
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    return "FRONTEND_URL must be an origin only (scheme://host[:port]), without a path, query or fragment.";
  }
  return null;
}

function serviceUrlProblem(name: string, raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return `${name} is not set.`;
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") return null;
  } catch {
    /* fall through */
  }
  return `${name} must be an absolute http(s) URL.`;
}

/** The checks behind assertProductionConfig, as a list (also used by `npm run check:config`). */
export function bffProductionConfigProblems(env: NodeJS.ProcessEnv): string[] {
  return [
    weakSecretReason("JWT_SECRET", env.JWT_SECRET),
    frontendUrlProblem(env.FRONTEND_URL),
    serviceUrlProblem("AUTH_SERVICE_URL", env.AUTH_SERVICE_URL),
    serviceUrlProblem("BILLING_SERVICE_URL", env.BILLING_SERVICE_URL),
    serviceUrlProblem("USERS_SERVICE_URL", env.USERS_SERVICE_URL),
  ].filter((p): p is string => p !== null);
}

/**
 * Production start (`next start`): every secret and URL the BFF relies on must be present and
 * sane, reported as one list (SEC-08). Without JWT_SECRET no session can be verified; without
 * FRONTEND_URL the CSRF guard falls back to localhost and refuses every real browser; without
 * the service URLs every API call fails. Skipped in development/test and during `next build`.
 */
export function assertProductionConfig(env: NodeJS.ProcessEnv = process.env): void {
  if (env.NODE_ENV !== "production" || env.NEXT_PHASE === "phase-production-build") return;
  const problems = bffProductionConfigProblems(env);
  if (problems.length > 0) {
    throw new Error(`FATAL: refusing to start in production:\n- ${problems.join("\n- ")}`);
  }
}

/** Loud (non-fatal) production warning: without it, every user shares one rate-limit bucket. */
export function warnMissingClientIpHeader(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.NODE_ENV !== "production" || env.NEXT_PHASE === "phase-production-build") return false;
  if (env.CLIENT_IP_HEADER?.trim()) return false;
  console.warn(
    "[startup] CLIENT_IP_HEADER is not set: the BFF cannot forward end-user IPs, so all users share one " +
      "rate-limit bucket at the auth service (FINDING-04). See docs/ops/PRODUCTION_RUNBOOK.md.",
  );
  return true;
}

export function register(): void {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  assertServerSecrets();
  assertProductionConfig();
  warnMissingClientIpHeader();
}
