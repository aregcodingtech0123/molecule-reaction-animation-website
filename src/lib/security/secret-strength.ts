/**
 * Strength check for shared secrets on the Next.js side (INTERNAL_SERVICE_SECRET).
 * Mirrors services/auth-billing-service/src/config/secretStrength.ts — both are
 * covered by the same test vectors so they cannot drift apart unnoticed.
 */
export const MIN_SECRET_LENGTH = 32;
export const MIN_SECRET_ENTROPY_BITS_PER_CHAR = 3;

const PLACEHOLDER_SECRETS = new Set(
  [
    "replace-with-at-least-32-characters-secret-key",
    "replace-with-at-least-32-characters-internal-key",
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

export function weakSecretReason(name: string, value: string | undefined): string | null {
  const secret = value?.trim() ?? "";
  if (!secret) return `${name} is not set.`;
  if (PLACEHOLDER_SECRETS.has(secret.toLowerCase())) return `${name} is a documented placeholder value.`;
  if (secret.length < MIN_SECRET_LENGTH) return `${name} must be at least ${MIN_SECRET_LENGTH} characters.`;
  if (shannonEntropyPerChar(secret) < MIN_SECRET_ENTROPY_BITS_PER_CHAR) {
    return `${name} has too little variety (low entropy); generate it randomly, e.g. \`openssl rand -base64 48\`.`;
  }
  return null;
}
