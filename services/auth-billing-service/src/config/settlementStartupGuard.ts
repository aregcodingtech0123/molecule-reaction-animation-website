import { settlementSecretProblems } from "./settlementSecret.js";

/**
 * Refuse to run with an unusable settlement capability secret: the whole list of problems, then exit 1.
 * An explicit call with no import-time effect, so importing this file cannot break an unrelated test. Each problem names a
 * variable and a rule, never a value (see settlementSecretProblems).
 *
 * Called from enforceProductionSecurityGuards() in src/index.ts, in every mode, before the service binds its port.
 */
export function enforceSettlementSecret(source: NodeJS.ProcessEnv = process.env): void {
  const problems = settlementSecretProblems(source);
  if (problems.length === 0) return;
  for (const problem of problems) console.error(`FATAL: ${problem}`);
  console.error("FATAL: refusing to start without a valid settlement capability secret. Exiting.");
  process.exit(1);
}
