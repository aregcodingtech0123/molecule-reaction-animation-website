import { env } from "../config/env.js";
import { pool } from "../db/index.js";
import { buildDeletionRequestedEmail, sendEmail } from "../lib/email.js";
import { AppError } from "../types/index.js";
import { DELETION_GRACE_DAYS } from "../utils/profile.js";
import { reauthenticate } from "./reauth.service.js";

export interface DeletionStatus {
  /** When the account will be anonymised unless the request is cancelled. */
  scheduledFor: string;
}

/**
 * The user asks for deletion (docs/seo/ACCOUNT_DELETION_DESIGN.md). Nothing is deleted now: the request is recorded, every session
 * is revoked (token_version + 1), and the daily job anonymises the account once the request is DELETION_GRACE_DAYS old.
 * Ledger rows and balances are not touched here or by the job.
 */
export async function requestDeletion(
  userId: string,
  secrets: { password?: unknown; idToken?: unknown },
): Promise<DeletionStatus> {
  await reauthenticate(userId, secrets);

  const current = await pool.query<{ is_admin: boolean; anonymised_at: Date | null }>(
    `SELECT is_admin, anonymised_at FROM users WHERE id = $1`,
    [userId],
  );
  const user = current.rows[0];
  if (!user || user.anonymised_at) throw new AppError(404, "User not found.", "USER_NOT_FOUND");
  if (user.is_admin) {
    throw new AppError(403, "Administrator accounts cannot be deleted from here.", "ADMIN_CANNOT_SELF_DELETE");
  }

  // COALESCE: asking again keeps the original date (it cannot be pushed back). Bumping token_version signs out every device.
  const updated = await pool.query<{ email: string; first_name: string | null; deletion_requested_at: Date }>(
    `UPDATE users
        SET deletion_requested_at = COALESCE(deletion_requested_at, NOW()),
            token_version = token_version + 1,
            updated_at = NOW()
      WHERE id = $1 AND anonymised_at IS NULL AND NOT is_admin
      RETURNING email, first_name, deletion_requested_at`,
    [userId],
  );
  const row = updated.rows[0];
  if (!row) throw new AppError(404, "User not found.", "USER_NOT_FOUND");

  const scheduledFor = new Date(row.deletion_requested_at.getTime() + DELETION_GRACE_DAYS * 86_400_000);
  // Best effort: the request itself is already recorded; a mail failure must not make the user think it was not.
  try {
    await sendEmail(
      buildDeletionRequestedEmail({
        email: row.email,
        firstName: row.first_name ?? "",
        scheduledFor,
        accountUrl: `${env.frontendUrl}/profile`,
      }),
    );
  } catch {
    console.error("[auth] Deletion confirmation e-mail could not be sent (the request is recorded)", { userId });
  }
  return { scheduledFor: scheduledFor.toISOString() };
}

/** Cancel a pending request during the grace period. Returns false when there was nothing to cancel. */
export async function cancelDeletion(userId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE users SET deletion_requested_at = NULL, updated_at = NOW()
      WHERE id = $1 AND anonymised_at IS NULL AND deletion_requested_at IS NOT NULL`,
    [userId],
  );
  return (result.rowCount ?? 0) > 0;
}
