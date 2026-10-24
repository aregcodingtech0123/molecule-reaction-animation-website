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

export function register(): void {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  assertServerSecrets();
}
