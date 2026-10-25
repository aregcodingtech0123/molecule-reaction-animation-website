/**
 * Log-safe form of an email address (SEC-19): first character of the local part and the domain, enough to
 * correlate a support request, not enough to harvest addresses from logs. Null stays null.
 */
export function maskEmail(email: string | null | undefined): string | null {
  if (email === null || email === undefined) return null;
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf("@");
  if (at < 1 || at === trimmed.length - 1) return "***";
  return `${trimmed[0]}***@${trimmed.slice(at + 1)}`;
}
