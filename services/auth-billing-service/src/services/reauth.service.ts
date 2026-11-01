import { pool } from "../db/index.js";
import { AppError } from "../types/index.js";
import { verifyGoogleIdToken } from "../utils/google.js";
import { verifyPassword } from "../utils/password.js";
import { ValidationError } from "../utils/validation.js";

/** A Google sign-in counts as "fresh" for this long (seconds); the same window Google documents for re-authentication prompts. */
const FRESH_GOOGLE_TOKEN_SECONDS = 300;
/** Tolerated clock difference between Google and this server (seconds). */
const CLOCK_SKEW_SECONDS = 60;
const MAX_SECRET_LENGTH = 8192;

const REAUTH_FAILED = () =>
  new AppError(403, "Password or Google sign-in did not match this account.", "REAUTH_FAILED");

/**
 * Proves the person at the keyboard still holds the account's credential before personal data leaves the service:
 * the account password, or - for accounts created with Google, which have no password of their own - a Google ID token
 * issued within the last five minutes for the Google identity linked to this very account.
 * Every failure is the same 403 (never 401: the browser would treat that as an expired session and sign out).
 */
export async function reauthenticate(
  userId: string,
  secrets: { password?: unknown; idToken?: unknown },
): Promise<void> {
  const { password, idToken } = secrets;
  const hasPassword = password !== undefined && password !== null && password !== "";
  const hasToken = idToken !== undefined && idToken !== null && idToken !== "";
  if (hasPassword === hasToken) {
    throw new ValidationError("Provide either your password or a fresh Google sign-in.");
  }

  if (hasPassword) {
    if (typeof password !== "string" || password.length > MAX_SECRET_LENGTH) {
      throw new ValidationError("Password is invalid.");
    }
    const { rows } = await pool.query<{ password_hash: string }>(`SELECT password_hash FROM users WHERE id = $1`, [userId]);
    const hash = rows[0]?.password_hash;
    // Always run a comparison so a missing row costs the same as a wrong password.
    const ok = await verifyPassword(password, hash ?? "$2b$04$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidi");
    if (!hash || !ok) throw REAUTH_FAILED();
    return;
  }

  if (typeof idToken !== "string" || idToken.length > MAX_SECRET_LENGTH) {
    throw new ValidationError("Google sign-in token is invalid.");
  }
  let identity;
  try {
    identity = await verifyGoogleIdToken(idToken);
  } catch (err) {
    // An invalid/expired Google token is a failed re-authentication (403), not an expired session (401).
    if (err instanceof AppError && err.statusCode === 401) throw REAUTH_FAILED();
    throw err;
  }
  const age = Math.floor(Date.now() / 1000) - identity.issuedAt;
  if (identity.issuedAt === 0 || age > FRESH_GOOGLE_TOKEN_SECONDS || age < -CLOCK_SKEW_SECONDS) throw REAUTH_FAILED();

  const linked = await pool.query(
    `SELECT 1 FROM oauth_accounts WHERE user_id = $1 AND provider = 'google' AND provider_account_id = $2 LIMIT 1`,
    [userId, identity.googleSub],
  );
  if ((linked.rowCount ?? 0) === 0) throw REAUTH_FAILED();
}
