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

export interface PersonalDataExport {
  exportedAt: string;
  account: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
    dateOfBirth: string | null;
    isVerified: boolean;
    createdAt: string;
    /** The address the account was created from; cleared automatically after 90 days once the purge job runs. */
    signupIpAddress: string | null;
  };
  linkedSignIn: { provider: string; linkedAt: string }[];
  credits: { balance: number };
  creditLedger: {
    id: string;
    amount: number;
    type: string;
    referenceId: string | null;
    provider: string | null;
    createdAt: string;
  }[];
  checkoutOrders: {
    id: string;
    packageId: string;
    provider: string;
    currency: string;
    amountMinor: number;
    credits: number;
    status: string;
    createdAt: string;
    completedAt: string | null;
  }[];
  aiCreditHolds: {
    referenceId: string;
    operation: string;
    amount: number;
    status: string;
    createdAt: string;
    settledAt: string | null;
  }[];
  notes: string[];
}

const iso = (value: Date | string | null): string | null =>
  value === null ? null : value instanceof Date ? value.toISOString() : new Date(value).toISOString();

/**
 * The signed-in user's own data, and nothing else: no password hash, no token or token hash, no Google subject id, no stored
 * payment-provider message, no row of another user. Read-only: it SELECTs from the ledger and never writes anywhere.
 */
export async function buildExport(userId: string): Promise<PersonalDataExport> {
  const user = await pool.query<{
    id: string;
    email: string;
    first_name: string | null;
    last_name: string | null;
    date_of_birth: Date | string | null;
    is_verified: boolean;
    created_at: Date;
    signup_ip: string | null;
  }>(
    `SELECT id::text, email, first_name, last_name, date_of_birth::text AS date_of_birth, is_verified, created_at,
            host(signup_ip) AS signup_ip
       FROM users WHERE id = $1`,
    [userId],
  );
  const u = user.rows[0];
  if (!u) throw new AppError(404, "User not found.", "USER_NOT_FOUND");

  const [oauth, balance, ledger, orders, holds] = await Promise.all([
    pool.query<{ provider: string; created_at: Date }>(
      `SELECT provider, created_at FROM oauth_accounts WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    ),
    pool.query<{ balance: number }>(`SELECT balance FROM user_balances WHERE user_id = $1`, [userId]),
    pool.query<{
      id: string;
      amount: number;
      transaction_type: string;
      reference_id: string | null;
      provider: string | null;
      created_at: Date;
    }>(
      `SELECT id::text, amount, transaction_type::text, reference_id, provider, created_at
         FROM credit_ledger_transactions WHERE user_id = $1 ORDER BY id`,
      [userId],
    ),
    pool.query<{
      id: string;
      package_id: string;
      provider: string;
      currency: string;
      amount_minor: number;
      credits: number;
      status: string;
      created_at: Date;
      completed_at: Date | null;
    }>(
      `SELECT id::text, package_id, provider, currency, amount_minor, credits, status, created_at, completed_at
         FROM pending_checkout_orders WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    ),
    pool.query<{
      reference_id: string;
      operation_type: string;
      amount: number;
      status: string;
      created_at: Date;
      settled_at: Date | null;
    }>(
      `SELECT reference_id, operation_type, amount, status, created_at, settled_at
         FROM ai_credit_holds WHERE user_id = $1 ORDER BY created_at`,
      [userId],
    ),
  ]);

  return {
    exportedAt: new Date().toISOString(),
    account: {
      id: u.id,
      email: u.email,
      firstName: u.first_name,
      lastName: u.last_name,
      dateOfBirth: u.date_of_birth === null ? null : String(u.date_of_birth).slice(0, 10),
      isVerified: u.is_verified,
      createdAt: u.created_at.toISOString(),
      signupIpAddress: u.signup_ip,
    },
    linkedSignIn: oauth.rows.map((r) => ({ provider: r.provider, linkedAt: r.created_at.toISOString() })),
    credits: { balance: balance.rows[0]?.balance ?? 0 },
    creditLedger: ledger.rows.map((r) => ({
      id: r.id,
      amount: r.amount,
      type: r.transaction_type,
      referenceId: r.reference_id,
      provider: r.provider,
      createdAt: r.created_at.toISOString(),
    })),
    checkoutOrders: orders.rows.map((r) => ({
      id: r.id,
      packageId: r.package_id,
      provider: r.provider,
      currency: r.currency,
      amountMinor: r.amount_minor,
      credits: r.credits,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      completedAt: iso(r.completed_at),
    })),
    aiCreditHolds: holds.rows.map((r) => ({
      referenceId: r.reference_id,
      operation: r.operation_type,
      amount: r.amount,
      status: r.status,
      createdAt: r.created_at.toISOString(),
      settledAt: iso(r.settled_at),
    })),
    notes: [
      "AI Lab conversations are not stored by MoleculeStudio and are therefore not part of this file.",
      "Payment details (card numbers, billing address) are held by the payment provider, not by MoleculeStudio.",
    ],
  };
}
