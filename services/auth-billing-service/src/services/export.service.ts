import { pool } from "../db/index.js";
import { AppError } from "../types/index.js";

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
