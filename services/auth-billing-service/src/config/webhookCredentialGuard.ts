/**
 * C14a: the main service must never hold the webhook-ingest database credential.
 *
 * `moleculestudio_webhook` is the login of the separate ingest component (Step 7.5). If the main service carried
 * WEBHOOK_DATABASE_URL, one process would hold both the settlement credential and the ingest credential, which is the
 * separation the two roles exist to enforce. Nothing in this service reads the variable, so refusing it cannot break a working
 * deployment; it only catches a mis-copied environment.
 *
 * Pure checks over an env-like object, like settlementSecret.ts: nothing here loads `.env`. A problem names the variable and
 * the rule, never a value.
 */

export const WEBHOOK_DATABASE_URL_NAME = "WEBHOOK_DATABASE_URL";

/** Why this process must not start (empty = fine). A blank or whitespace-only value carries no credential and is ignored. */
export function webhookCredentialProblems(source: NodeJS.ProcessEnv = process.env): string[] {
  if ((source[WEBHOOK_DATABASE_URL_NAME]?.trim() ?? "") === "") return [];
  return [
    `${WEBHOOK_DATABASE_URL_NAME} must not be set for this service: the webhook-ingest database credential belongs to the ingest component only.`,
  ];
}

/**
 * Refuse to run when the webhook credential is present: the problem, then exit 1. An explicit call with no import-time effect.
 * Called from enforceProductionSecurityGuards() in src/index.ts, in every mode, before the service binds its port.
 */
export function enforceNoWebhookCredential(source: NodeJS.ProcessEnv = process.env): void {
  const problems = webhookCredentialProblems(source);
  if (problems.length === 0) return;
  for (const problem of problems) console.error(`FATAL: ${problem}`);
  console.error("FATAL: refusing to start with the webhook-ingest database credential in the main service. Exiting.");
  process.exit(1);
}
