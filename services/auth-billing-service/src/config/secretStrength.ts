/**
 * Strength check for shared secrets (JWT_SECRET, INTERNAL_SERVICE_SECRET).
 *
 * Rejects documented placeholders by exact match (case-insensitive, trimmed)
 * rather than by substring, so a strong random key that happens to contain a
 * word like "secret" is not refused. Low-variety values ("aaaa…", "abababab…")
 * are rejected by a Shannon-entropy floor.
 */
export const MIN_SECRET_LENGTH = 32;
/** Bits per character. Random hex ≈ 4.0, base64 ≈ 6.0, a repeated pair = 1.0. */
export const MIN_SECRET_ENTROPY_BITS_PER_CHAR = 3;

const PLACEHOLDER_SECRETS = new Set(
  [
    "replace-with-at-least-32-characters-secret-key",
    "replace-with-at-least-32-characters-internal-key",
    "replace-with-another-32-characters-email-tombstone-key",
    "replace-with-another-32-characters-settlement-key",
    "changeme",
    "secret",
    "your-secret-here",
    "jwt-secret",
  ].map((s) => s.toLowerCase()),
);

export function shannonEntropyPerChar(value: string): number {
  if (!value) return 0;
  const counts = new Map<string, number>();
  for (const ch of value) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const length = [...value].length;
  let entropy = 0;
  for (const n of counts.values()) {
    const p = n / length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/** Returns a human-readable reason when the secret is unacceptable, otherwise null. */
export function weakSecretReason(name: string, value: string | undefined): string | null {
  const secret = value?.trim() ?? "";
  if (!secret) return `${name} is not set.`;
  if (PLACEHOLDER_SECRETS.has(secret.toLowerCase())) {
    return `${name} is a documented placeholder value.`;
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return `${name} must be at least ${MIN_SECRET_LENGTH} characters.`;
  }
  if (shannonEntropyPerChar(secret) < MIN_SECRET_ENTROPY_BITS_PER_CHAR) {
    return `${name} has too little variety (low entropy); generate it randomly, e.g. \`openssl rand -base64 48\`.`;
  }
  return null;
}
