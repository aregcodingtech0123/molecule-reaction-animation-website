import { pool } from "../db/index.js";
import { AppError } from "../types/index.js";
import {
  toPublicUserProfile,
  type PublicUserProfile,
  type ProfileUpdate,
  type UserRow,
} from "../utils/profile.js";

const USER_COLUMNS = `id, email, first_name, last_name, date_of_birth, is_admin, is_verified, created_at, deletion_requested_at`;

export async function getProfileByUserId(userId: string): Promise<PublicUserProfile> {
  const result = await pool.query<UserRow>(
    `SELECT ${USER_COLUMNS} FROM users WHERE id = $1 LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, "User not found.", "USER_NOT_FOUND");
  }
  return toPublicUserProfile(row);
}

export async function updateProfileByUserId(
  userId: string,
  updates: ProfileUpdate,
): Promise<PublicUserProfile> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let param = 1;

  if (updates.firstName !== undefined) {
    sets.push(`first_name = $${param++}`);
    values.push(updates.firstName);
  }
  if (updates.lastName !== undefined) {
    sets.push(`last_name = $${param++}`);
    values.push(updates.lastName);
  }
  if (updates.dateOfBirth !== undefined) {
    sets.push(`date_of_birth = $${param++}::date`);
    values.push(updates.dateOfBirth);
  }

  values.push(userId);

  const result = await pool.query<UserRow>(
    `UPDATE users SET ${sets.join(", ")}, updated_at = NOW()
     WHERE id = $${param}
     RETURNING ${USER_COLUMNS}`,
    values,
  );

  const row = result.rows[0];
  if (!row) {
    throw new AppError(404, "User not found.", "USER_NOT_FOUND");
  }

  return toPublicUserProfile(row);
}
