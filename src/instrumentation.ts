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
  warnMissingClientIpHeader();
}
