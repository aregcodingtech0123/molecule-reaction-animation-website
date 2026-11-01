import { ValidationError } from "./validation.js";

const NAME_RE = /^[\p{L}\p{M}' -]+$/u;

/** Days between a deletion request and the anonymisation (the SQL default of anonymise_user() is the same). */
export const DELETION_GRACE_DAYS = 14;

export interface UserProfileInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

export interface PublicUserProfile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  isAdmin: boolean;
  isVerified: boolean;
  createdAt: string;
  /** When the account will be anonymised (request + 14 days) if the user asked for deletion, otherwise null. */
  deletionScheduledFor: string | null;
}

export function validateFirstName(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("First name is required.");
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    throw new ValidationError("First name must be between 1 and 100 characters.");
  }
  if (!NAME_RE.test(trimmed)) {
    throw new ValidationError("First name contains invalid characters.");
  }
  return trimmed;
}

export function validateLastName(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("Last name is required.");
  }
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > 100) {
    throw new ValidationError("Last name must be between 1 and 100 characters.");
  }
  if (!NAME_RE.test(trimmed)) {
    throw new ValidationError("Last name contains invalid characters.");
  }
  return trimmed;
}

export function validateDateOfBirth(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("Date of birth is required.");
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    throw new ValidationError("Date of birth must be in YYYY-MM-DD format.");
  }

  const [year, month, day] = trimmed.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ValidationError("Date of birth is not a valid calendar date.");
  }

  const today = new Date();
  const minAgeDate = new Date(Date.UTC(today.getUTCFullYear() - 13, today.getUTCMonth(), today.getUTCDate()));
  const maxAgeDate = new Date(Date.UTC(today.getUTCFullYear() - 120, today.getUTCMonth(), today.getUTCDate()));

  if (date > minAgeDate) {
    throw new ValidationError("You must be at least 13 years old to register.");
  }
  if (date < maxAgeDate) {
    throw new ValidationError("Date of birth is out of allowed range.");
  }

  return trimmed;
}

export function validateProfileInput(input: {
  firstName: unknown;
  lastName: unknown;
  dateOfBirth: unknown;
}): UserProfileInput {
  return {
    firstName: validateFirstName(input.firstName),
    lastName: validateLastName(input.lastName),
    dateOfBirth: validateDateOfBirth(input.dateOfBirth),
  };
}

/**
 * A profile update: a field that is absent is left alone, a string is validated and stored, and `null` clears the stored
 * value (the user removing their own data; accounts created with Google start with all three empty).
 */
export type ProfileUpdate = { [K in keyof UserProfileInput]?: string | null };

export function validateProfileUpdateInput(input: {
  firstName?: unknown;
  lastName?: unknown;
  dateOfBirth?: unknown;
}): ProfileUpdate {
  const result: ProfileUpdate = {};
  if (input.firstName !== undefined) {
    result.firstName = input.firstName === null ? null : validateFirstName(input.firstName);
  }
  if (input.lastName !== undefined) {
    result.lastName = input.lastName === null ? null : validateLastName(input.lastName);
  }
  if (input.dateOfBirth !== undefined) {
    result.dateOfBirth = input.dateOfBirth === null ? null : validateDateOfBirth(input.dateOfBirth);
  }
  if (Object.keys(result).length === 0) {
    throw new ValidationError("At least one profile field must be provided.");
  }
  return result;
}

export interface UserRow {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: Date | string | null;
  is_admin: boolean;
  is_verified: boolean;
  created_at: Date;
  /** Set when the user asked for deletion (see deletionScheduledFor). */
  deletion_requested_at?: Date | null;
  /** Session generation (not part of the public profile). */
  token_version?: number;
}

function formatDateOfBirth(value: Date | string | null): string {
  if (!value) return "";
  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

export function toPublicUserProfile(row: UserRow): PublicUserProfile {
  return {
    id: row.id,
    email: row.email,
    firstName: row.first_name ?? "",
    lastName: row.last_name ?? "",
    dateOfBirth: formatDateOfBirth(row.date_of_birth),
    isAdmin: Boolean(row.is_admin),
    isVerified: Boolean(row.is_verified),
    createdAt: row.created_at.toISOString(),
    deletionScheduledFor: row.deletion_requested_at
      ? new Date(row.deletion_requested_at.getTime() + DELETION_GRACE_DAYS * 86_400_000).toISOString()
      : null,
  };
}
