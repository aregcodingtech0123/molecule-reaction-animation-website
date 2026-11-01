import { randomBytes } from "node:crypto";
import type { PoolClient } from "../db/index.js";
import { pool, withTransaction } from "../db/index.js";
import { env } from "../config/env.js";
import { AppError } from "../types/index.js";
import { verifyGoogleIdToken } from "../utils/google.js";
import { hashPassword, verifyPassword } from "../utils/password.js";
import { signToken } from "../utils/jwt.js";
import { isEmailTombstoned } from "../utils/emailTombstone.js";
import { normalizeEmail, validateGoogleIdToken, validatePassword } from "../utils/validation.js";
import {
  toPublicUserProfile,
  validateProfileInput,
  type UserProfileInput,
  type UserRow,
} from "../utils/profile.js";
import { generateSecureToken, hashToken, hoursFromNow } from "../utils/secureToken.js";
import {
  buildPasswordResetEmail,
  buildVerificationEmail,
  sendEmail,
} from "../lib/email.js";
import { revokeJti } from "./tokenRevocation.service.js";

interface UserCredentialsRow extends UserRow {
  password_hash: string;
}

const GOOGLE_PROVIDER = "google";
const SIGNUP_CREDITS = 10;
const VERIFICATION_TTL_HOURS = 24;
const RESET_TTL_HOURS = 1;

const GENERIC_REGISTER_MESSAGE =
  "If this email address is new, your account has been created. Check your inbox to verify your email.";

const GENERIC_FORGOT_MESSAGE =
  "If an account exists for that email, a password reset link has been sent.";

let dummyHash: Promise<string> | null = null;

/**
 * bcrypt hash of a random string, at the configured cost — compared against when the user is not
 * found so an unknown email takes as long as a wrong password (SEC-07: a hard-coded cost-10 hash
 * made unknown emails measurably faster or slower whenever BCRYPT_ROUNDS was not 10).
 */
export function dummyPasswordHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString("base64url"));
  return dummyHash;
}

/**
 * Send an account email without awaiting it: the response's timing and status must not depend on
 * the mail provider, because only some branches (account exists / unverified) send mail (SEC-07).
 */
function sendInBackground(kind: string, send: () => Promise<void>): void {
  void send().catch((err: unknown) => {
    console.error(`[auth] Failed to send ${kind} email:`, err instanceof Error ? err.message : err);
  });
}

const USER_PUBLIC_COLUMNS =
  "id, email, first_name, last_name, date_of_birth, is_admin, is_verified, created_at, token_version, deletion_requested_at";

function authResponse(user: UserRow, message: string) {
  const token = signToken({ sub: user.id, email: user.email, tv: user.token_version ?? 0 });
  return {
    message,
    token,
    user: toPublicUserProfile(user),
  };
}

/** Registration answers identically for new and existing emails (FINDING-09). */
export interface RegisterResult {
  message: string;
}

async function createOAuthPasswordHash(): Promise<string> {
  const placeholder = randomBytes(48).toString("base64url");
  return hashPassword(placeholder);
}

async function insertUser(
  client: PoolClient,
  params: {
    email: string;
    passwordHash: string;
    /** Absent for accounts created with Google: Google gives us no name or date of birth, so none is stored. */
    profile?: UserProfileInput;
    signupIp: string | null;
    isVerified: boolean;
  },
): Promise<UserRow> {
  const inserted = await client.query<UserRow>(
    `INSERT INTO users (
       email, password_hash, signup_ip, first_name, last_name, date_of_birth, is_admin, is_verified
     )
     VALUES ($1, $2, $3::inet, $4, $5, $6::date, false, $7)
     RETURNING ${USER_PUBLIC_COLUMNS}`,
    [
      params.email,
      params.passwordHash,
      params.signupIp,
      params.profile?.firstName ?? null,
      params.profile?.lastName ?? null,
      params.profile?.dateOfBirth ?? null,
      params.isVerified,
    ],
  );

  const row = inserted.rows[0];
  if (!row) {
    throw new AppError(500, "Failed to create user.", "USER_CREATE_FAILED");
  }

  await client.query(`INSERT INTO user_balances (user_id, balance) VALUES ($1, 0)`, [row.id]);
  return row;
}

/**
 * Posts the one-time signup bonus. Returns false when it is NOT granted because the e-mail belongs to an account that was
 * deleted less than 12 months ago (the re-registration guard; EMAIL_TOMBSTONE_GUARD=false turns it off). Nothing is written
 * to the ledger in that case. All four ways a bonus is granted (verify e-mail, verified upgrade, Google takeover link,
 * new Google user) go through here, so the guard cannot be bypassed by choosing another sign-up route.
 */
async function grantSignupBonus(client: PoolClient, userId: string): Promise<boolean> {
  const existing = await client.query<{ id: string }>(
    `SELECT id::text FROM credit_ledger_transactions
     WHERE user_id = $1 AND transaction_type = 'SIGNUP_BONUS'
     LIMIT 1`,
    [userId],
  );
  if ((existing.rowCount ?? 0) > 0) return true;

  if (env.emailTombstoneGuardEnabled) {
    const who = await client.query<{ email: string }>(`SELECT email FROM users WHERE id = $1`, [userId]);
    if (who.rows[0] && (await isEmailTombstoned(client, who.rows[0].email))) {
      console.warn("[auth] Signup bonus skipped: this e-mail belonged to an account deleted within the last 12 months", { userId });
      return false;
    }
  }

  await client.query(`SELECT post_credit_transaction($1, $2, $3, $4)`, [
    userId,
    SIGNUP_CREDITS,
    "SIGNUP_BONUS",
    "signup",
  ]);
  return true;
}

async function replaceVerificationToken(
  client: PoolClient,
  userId: string,
): Promise<string> {
  await client.query(`DELETE FROM verification_tokens WHERE user_id = $1`, [userId]);
  const { rawToken, tokenHash } = generateSecureToken();
  await client.query(
    `INSERT INTO verification_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, hoursFromNow(VERIFICATION_TTL_HOURS)],
  );
  return rawToken;
}

async function sendVerificationLink(user: UserRow, rawToken: string): Promise<void> {
  const verifyUrl = `${env.frontendUrl}/verify-email?token=${encodeURIComponent(rawToken)}`;
  await sendEmail(
    buildVerificationEmail({
      email: user.email,
      firstName: user.first_name ?? "",
      verifyUrl,
    }),
  );
}

export async function registerUser(
  emailInput: unknown,
  passwordInput: unknown,
  profileInput: { firstName: unknown; lastName: unknown; dateOfBirth: unknown },
  signupIp: string | null = null,
): Promise<RegisterResult> {
  const email = normalizeEmail(emailInput);
  const password = validatePassword(passwordInput);
  const profile = validateProfileInput(profileInput);
  const passwordHash = await hashPassword(password);

  const existing = await pool.query<{ id: string }>(
    `SELECT id FROM users WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1`,
    [email],
  );

  if (existing.rowCount && existing.rowCount > 0) {
    return { message: GENERIC_REGISTER_MESSAGE };
  }

  let user: UserRow;
  let rawToken: string;
  try {
    const created = await withTransaction(async (client: PoolClient) => {
      const row = await insertUser(client, {
        email,
        passwordHash,
        profile,
        signupIp,
        isVerified: false,
      });
      const token = await replaceVerificationToken(client, row.id);
      return { row, token };
    });
    user = created.row;
    rawToken = created.token;
  } catch (err: unknown) {
    const pgCode =
      err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : null;
    if (pgCode === "23505") {
      return { message: GENERIC_REGISTER_MESSAGE };
    }
    throw err;
  }

  // Not awaited (SEC-07); on failure the user can request a resend.
  sendInBackground("verification", () => sendVerificationLink(user, rawToken));

  // No session here: the verification link signs the user in. Issuing a token only for new
  // emails would reveal which addresses already have an account (FINDING-09).
  return { message: GENERIC_REGISTER_MESSAGE };
}

export async function verifyEmailWithToken(rawTokenInput: unknown) {
  if (typeof rawTokenInput !== "string" || !rawTokenInput.trim()) {
    throw new AppError(400, "Verification token is required.", "INVALID_TOKEN");
  }

  const tokenHash = hashToken(rawTokenInput.trim());

  let bonusGranted = true;
  const outcome = await withTransaction(async (client) => {
    const tokenRow = await client.query<{
      id: string;
      user_id: string;
      expires_at: Date;
    }>(
      `SELECT id::text, user_id::text, expires_at
       FROM verification_tokens
       WHERE token_hash = $1
       LIMIT 1
       FOR UPDATE`,
      [tokenHash],
    );

    const token = tokenRow.rows[0];
    if (!token) {
      throw new AppError(400, "Invalid or expired verification link.", "INVALID_TOKEN");
    }

    if (token.expires_at.getTime() < Date.now()) {
      await client.query(`DELETE FROM verification_tokens WHERE id = $1`, [token.id]);
      throw new AppError(400, "Invalid or expired verification link.", "TOKEN_EXPIRED");
    }

    const userResult = await client.query<UserRow>(
      `SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [token.user_id],
    );
    const user = userResult.rows[0];
    if (!user) {
      throw new AppError(404, "User not found.", "USER_NOT_FOUND");
    }

    if (!user.is_verified) {
      await client.query(
        `UPDATE users SET is_verified = true, updated_at = NOW() WHERE id = $1`,
        [user.id],
      );
      user.is_verified = true;
    }

    bonusGranted = await grantSignupBonus(client, user.id);
    await client.query(`DELETE FROM verification_tokens WHERE user_id = $1`, [user.id]);

    return user;
  });

  return authResponse(
    outcome,
    bonusGranted ? "Email verified. Starter credits have been added to your balance." : "Email verified.",
  );
}

export async function resendVerificationEmail(emailInput: unknown): Promise<{ message: string }> {
  const email = normalizeEmail(emailInput);
  const generic = {
    message: "If an unverified account exists for that email, a new link has been sent.",
  };

  const result = await pool.query<UserRow>(
    `SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1`,
    [email],
  );
  const user = result.rows[0];
  if (!user || user.is_verified) {
    return generic;
  }

  const rawToken = await withTransaction(async (client) => {
    return replaceVerificationToken(client, user.id);
  });

  // Not awaited, and a delivery failure is not reported: a 502 only for unverified accounts
  // revealed that the account exists (SEC-07).
  sendInBackground("verification (resend)", () => sendVerificationLink(user, rawToken));

  return generic;
}

export async function loginUser(emailInput: unknown, passwordInput: unknown) {
  const email = normalizeEmail(emailInput);
  const password = validatePassword(passwordInput);

  const result = await pool.query<UserCredentialsRow>(
    `SELECT ${USER_PUBLIC_COLUMNS}, password_hash
     FROM users
     WHERE lower(trim(email)) = lower(trim($1))
     LIMIT 1`,
    [email],
  );

  const user = result.rows[0];
  if (!user) {
    await verifyPassword(password, await dummyPasswordHash());
    throw new AppError(401, "Invalid email or password.", "INVALID_CREDENTIALS");
  }

  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    throw new AppError(401, "Invalid email or password.", "INVALID_CREDENTIALS");
  }

  return authResponse(user, "Login successful.");
}

async function linkOAuthAccount(
  client: PoolClient,
  userId: string,
  provider: string,
  providerAccountId: string,
): Promise<void> {
  // ON CONFLICT instead of catching 23505: a caught error would leave the caller's transaction
  // aborted, so the owner lookup below failed with 25P02 and a concurrent first sign-in got a
  // 500 (FINDING-35). A concurrent uncommitted link of the same subject is waited for, so the
  // owner read below sees it.
  await client.query(
    `INSERT INTO oauth_accounts (user_id, provider, provider_account_id)
     VALUES ($1, $2, $3)
     ON CONFLICT (provider, provider_account_id) DO NOTHING`,
    [userId, provider, providerAccountId],
  );

  const existing = await client.query<{ user_id: string }>(
    `SELECT user_id::text
     FROM oauth_accounts
     WHERE provider = $1 AND provider_account_id = $2
     LIMIT 1`,
    [provider, providerAccountId],
  );
  const ownerId = existing.rows[0]?.user_id;
  if (ownerId !== userId) {
    throw new AppError(
      409,
      "This Google account is already linked to another user.",
      "OAUTH_ALREADY_LINKED",
    );
  }
  // Linked to this user — newly, or already (idempotent).
}

async function findUserByOAuth(
  provider: string,
  providerAccountId: string,
): Promise<UserRow | null> {
  const result = await pool.query<UserRow>(
    `SELECT u.id, u.email, u.first_name, u.last_name, u.date_of_birth,
            u.is_admin, u.is_verified, u.created_at, u.token_version
     FROM oauth_accounts oa
     INNER JOIN users u ON u.id = oa.user_id
     WHERE oa.provider = $1
       AND oa.provider_account_id = $2
     LIMIT 1`,
    [provider, providerAccountId],
  );
  return result.rows[0] ?? null;
}

async function ensureVerifiedWithSignupBonus(user: UserRow): Promise<UserRow> {
  if (user.is_verified) return user;

  await withTransaction(async (client) => {
    await client.query(
      `UPDATE users SET is_verified = true, updated_at = NOW() WHERE id = $1 AND is_verified = false`,
      [user.id],
    );
    await grantSignupBonus(client, user.id);
  });
  user.is_verified = true;
  return user;
}

/**
 * First Google sign-in for an email that already has an account: link the Google subject to it.
 *
 * Pre-account takeover guard (FINDING-34): an UNVERIFIED password account with this email may have
 * been registered by someone else before the real owner arrived. Google has just proven ownership
 * of the address, so the Google user takes the account over: the old password is replaced with an
 * unguessable one, every existing session is revoked, and outstanding verification / reset tokens
 * are deleted. Verified accounts are linked as before.
 */
async function linkGoogleToExistingAccount(existingEmailUser: UserRow, googleSub: string) {
  const takeoverPasswordHash = existingEmailUser.is_verified ? null : await createOAuthPasswordHash();
  try {
    await withTransaction(async (client) => {
      await linkOAuthAccount(client, existingEmailUser.id, GOOGLE_PROVIDER, googleSub);
      if (!existingEmailUser.is_verified) {
        const updated = await client.query<{ token_version: number }>(
          `UPDATE users
           SET is_verified = true, password_hash = $2, token_version = token_version + 1, updated_at = NOW()
           WHERE id = $1 AND is_verified = false
           RETURNING token_version`,
          [existingEmailUser.id, takeoverPasswordHash],
        );
        if (updated.rows[0]) {
          await client.query(`DELETE FROM verification_tokens WHERE user_id = $1`, [existingEmailUser.id]);
          await client.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [existingEmailUser.id]);
          existingEmailUser.token_version = updated.rows[0].token_version;
          console.warn(
            "[auth] Google sign-in took over an unverified password account; password invalidated, sessions revoked",
            { userId: existingEmailUser.id },
          );
        }
        await grantSignupBonus(client, existingEmailUser.id);
        existingEmailUser.is_verified = true;
      }
    });
  } catch (err: unknown) {
    const pgCode =
      err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : null;
    // Concurrent link won the unique (provider, provider_account_id) race — re-resolve by sub.
    if (pgCode === "23505") {
      const raced = await findUserByOAuth(GOOGLE_PROVIDER, googleSub);
      if (raced) {
        return authResponse(raced, "Google sign-in successful.");
      }
    }
    throw err;
  }

  return authResponse(existingEmailUser, "Google account linked.");
}

export async function loginWithGoogle(idTokenInput: unknown, signupIp: string | null = null) {
  const idToken = validateGoogleIdToken(idTokenInput);
  const identity = await verifyGoogleIdToken(idToken);
  const email = normalizeEmail(identity.email);
  const googleSub = identity.googleSub;

  // 1) Stable identity: provider + Google `sub` (never email alone).
  const linked = await findUserByOAuth(GOOGLE_PROVIDER, googleSub);
  if (linked) {
    const user = await ensureVerifiedWithSignupBonus(linked);
    return authResponse(user, "Google sign-in successful.");
  }

  // 2) First-time Google for an existing local email — link under Google-verified ownership.
  const byEmail = await pool.query<UserRow>(
    `SELECT ${USER_PUBLIC_COLUMNS}
     FROM users
     WHERE lower(trim(email)) = lower(trim($1))
     LIMIT 1`,
    [email],
  );
  const existingEmailUser = byEmail.rows[0];

  if (existingEmailUser) {
    return linkGoogleToExistingAccount(existingEmailUser, googleSub);
  }

  // 3) Brand-new user: create users + oauth_accounts atomically.
  const passwordHash = await createOAuthPasswordHash();
  let user: UserRow;
  try {
    user = await withTransaction(async (client: PoolClient) => {
      const row = await insertUser(client, {
        email,
        passwordHash,
        signupIp,
        isVerified: true,
      });
      await linkOAuthAccount(client, row.id, GOOGLE_PROVIDER, googleSub);
      await grantSignupBonus(client, row.id);
      return row;
    });
  } catch (err: unknown) {
    const pgCode =
      err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : null;
    if (pgCode === "23505") {
      const bySub = await findUserByOAuth(GOOGLE_PROVIDER, googleSub);
      if (bySub) {
        return authResponse(bySub, "Google sign-in successful.");
      }
      const again = await pool.query<UserRow>(
        `SELECT ${USER_PUBLIC_COLUMNS} FROM users WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1`,
        [email],
      );
      const raced = again.rows[0];
      if (raced) {
        // A password registration for this email committed after step 2 looked: same policy as
        // step 2, including the FINDING-34 takeover of an unverified account (SEC-05).
        return linkGoogleToExistingAccount(raced, googleSub);
      }
    }
    throw err;
  }

  return authResponse(user, "Google account registered.");
}

/**
 * Revoke the caller's current JWT (`jti`) until its natural `exp`.
 * Cookie clearing is performed by the Next.js BFF (`/api/auth/clear-cookie`).
 */
export async function logoutCurrentToken(jti: string, expUnixSeconds: number): Promise<{ message: string }> {
  if (!jti || !Number.isFinite(expUnixSeconds)) {
    throw new AppError(401, "Invalid or expired token.", "INVALID_TOKEN");
  }

  const expiresAt = new Date(expUnixSeconds * 1000);
  if (expiresAt.getTime() <= Date.now()) {
    // Already expired — nothing useful to blacklist; treat as successful logout.
    return { message: "Logged out." };
  }

  await revokeJti(jti, expiresAt);
  return { message: "Logged out." };
}

export async function forgotPassword(emailInput: unknown): Promise<{ message: string }> {
  const email = normalizeEmail(emailInput);

  const result = await pool.query<{ id: string; email: string }>(
    `SELECT id::text, email FROM users WHERE lower(trim(email)) = lower(trim($1)) LIMIT 1`,
    [email],
  );
  const user = result.rows[0];
  if (!user) {
    return { message: GENERIC_FORGOT_MESSAGE };
  }

  const { rawToken, tokenHash } = generateSecureToken();
  await withTransaction(async (client) => {
    await client.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [user.id]);
    await client.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [user.id, tokenHash, hoursFromNow(RESET_TTL_HOURS)],
    );
  });

  const resetUrl = `${env.frontendUrl}/reset-password?token=${encodeURIComponent(rawToken)}`;
  // Not awaited (SEC-07): the unknown-email branch sends nothing, so waiting here would reveal
  // that the account exists through response time.
  sendInBackground("password reset", () => sendEmail(buildPasswordResetEmail({ email: user.email, resetUrl })));

  return { message: GENERIC_FORGOT_MESSAGE };
}

export async function resetPassword(rawTokenInput: unknown, passwordInput: unknown) {
  if (typeof rawTokenInput !== "string" || !rawTokenInput.trim()) {
    throw new AppError(400, "Reset token is required.", "INVALID_TOKEN");
  }
  const password = validatePassword(passwordInput);
  const passwordHash = await hashPassword(password);
  const tokenHash = hashToken(rawTokenInput.trim());

  await withTransaction(async (client) => {
    const tokenRow = await client.query<{
      id: string;
      user_id: string;
      expires_at: Date;
    }>(
      `SELECT id::text, user_id::text, expires_at
       FROM password_reset_tokens
       WHERE token_hash = $1
       LIMIT 1
       FOR UPDATE`,
      [tokenHash],
    );

    const token = tokenRow.rows[0];
    if (!token) {
      throw new AppError(400, "Invalid or expired reset link.", "INVALID_TOKEN");
    }

    if (token.expires_at.getTime() < Date.now()) {
      await client.query(`DELETE FROM password_reset_tokens WHERE id = $1`, [token.id]);
      throw new AppError(400, "Invalid or expired reset link.", "TOKEN_EXPIRED");
    }

    // Bumping token_version revokes every session issued before the reset (FINDING-18).
    await client.query(
      `UPDATE users SET password_hash = $2, token_version = token_version + 1, updated_at = NOW() WHERE id = $1`,
      [token.user_id, passwordHash],
    );

    await client.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [token.user_id]);
  });

  return { message: "Password has been reset. You can sign in with your new password." };
}

export async function getUserVerificationStatus(userId: string): Promise<{
  userId: string;
  email: string;
  isVerified: boolean;
}> {
  const result = await pool.query<{ id: string; email: string; is_verified: boolean }>(
    `SELECT id::text, email, is_verified FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, "User not found.", "USER_NOT_FOUND");
  }
  return {
    userId: row.id,
    email: row.email,
    isVerified: Boolean(row.is_verified),
  };
}
