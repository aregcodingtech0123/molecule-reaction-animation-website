/**
 * Validation and resolution of the settlement capability signing key (Phase 2C, step 1).
 *
 * Pure checks over an env-like object, like productionConfig.ts: nothing here loads `.env`, reads global state other
 * than the optional `source` default, or logs. settlementStartupGuard.ts turns the problems into a refusal to start.
 *
 * SETTLEMENT_CAPABILITY_SECRET lives only in the billing service. The Next.js app must never have it, otherwise it
 * could mint its own capabilities and the capability would prove nothing.
 *
 * No reason returned from here ever contains a secret value.
 */
import { weakSecretReason } from "./secretStrength.js";

export const SETTLEMENT_SECRET_NAME = "SETTLEMENT_CAPABILITY_SECRET";
/** Rotation only: the key that was current before the last change, kept for at least the hold TTL plus the expiry grace. */
export const SETTLEMENT_PREVIOUS_SECRET_NAME = "SETTLEMENT_CAPABILITY_SECRET_PREVIOUS";

/** Secrets the capability key must never share a value with (rotating one would silently rotate the other). */
const OTHER_SECRET_NAMES = ["JWT_SECRET", "INTERNAL_SERVICE_SECRET", "EMAIL_TOMBSTONE_SECRET"] as const;

export interface SettlementKeys {
  /** Signs new capabilities and verifies existing ones. Empty means "not configured". */
  current: string;
  /** Verifies capabilities signed before a rotation. Absent when blank. */
  previous?: string;
}

/**
 * The configured keys, trimmed. A missing current key is returned as "" so the caller decides what to do; the
 * capability module refuses to mint or verify with it, and `settlementSecretProblems` reports it.
 */
export function resolveSettlementKeys(source: NodeJS.ProcessEnv = process.env): SettlementKeys {
  const current = source[SETTLEMENT_SECRET_NAME]?.trim() ?? "";
  const previous = source[SETTLEMENT_PREVIOUS_SECRET_NAME]?.trim() ?? "";
  return previous ? { current, previous } : { current };
}

function sharedWithOther(name: string, value: string, source: NodeJS.ProcessEnv): string[] {
  if (!value) return [];
  return OTHER_SECRET_NAMES.filter((other) => value === (source[other]?.trim() ?? "")).map(
    (other) => `${name} must not be the same value as ${other}; generate a separate secret.`,
  );
}

/**
 * Every reason this configuration cannot be used for settlement capabilities (empty = fine).
 *  - the current key is required and must be strong (not missing, empty, a placeholder, short or low-entropy);
 *  - it must differ from JWT_SECRET, INTERNAL_SERVICE_SECRET and EMAIL_TOMBSTONE_SECRET;
 *  - the previous key is optional (blank is simply "not set"), but when present it gets the same checks and
 *    must also differ from the current key.
 */
export function settlementSecretProblems(source: NodeJS.ProcessEnv = process.env): string[] {
  const keys = resolveSettlementKeys(source);
  const problems: string[] = [];

  const currentReason = weakSecretReason(SETTLEMENT_SECRET_NAME, source[SETTLEMENT_SECRET_NAME]);
  if (currentReason) problems.push(currentReason);
  problems.push(...sharedWithOther(SETTLEMENT_SECRET_NAME, keys.current, source));

  if (keys.previous !== undefined) {
    const previousReason = weakSecretReason(SETTLEMENT_PREVIOUS_SECRET_NAME, keys.previous);
    if (previousReason) problems.push(previousReason);
    if (keys.previous === keys.current) {
      problems.push(`${SETTLEMENT_PREVIOUS_SECRET_NAME} must differ from ${SETTLEMENT_SECRET_NAME}; remove it once the rotation window has passed.`);
    }
    problems.push(...sharedWithOther(SETTLEMENT_PREVIOUS_SECRET_NAME, keys.previous, source));
  }

  return problems;
}
