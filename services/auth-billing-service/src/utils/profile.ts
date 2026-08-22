import { ValidationError } from "./validation.js";

const NAME_RE = /^[\p{L}\p{M}' -]+$/u;

const FIRST_NAMES = [
  "Emma", "Liam", "Olivia", "Noah", "Ava", "Ethan", "Sophia", "Mason", "Isabella", "Lucas",
  "Mia", "James", "Charlotte", "Benjamin", "Amelia", "Henry", "Harper", "Alexander", "Evelyn", "Daniel",
  "Ayşe", "Mehmet", "Zeynep", "Can", "Elif", "Yuki", "Hiro", "Sakura", "Carlos", "Maria",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
  "Wilson", "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White",
  "Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Tanaka", "Suzuki", "Sato", "Fernandez", "Lopez",
];

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

export function validateProfileUpdateInput(input: {
  firstName?: unknown;
  lastName?: unknown;
  dateOfBirth?: unknown;
}): Partial<UserProfileInput> {
  const result: Partial<UserProfileInput> = {};
  if (input.firstName !== undefined) {
    result.firstName = validateFirstName(input.firstName);
  }
  if (input.lastName !== undefined) {
    result.lastName = validateLastName(input.lastName);
  }
  if (input.dateOfBirth !== undefined) {
    result.dateOfBirth = validateDateOfBirth(input.dateOfBirth);
  }
  if (Object.keys(result).length === 0) {
    throw new ValidationError("At least one profile field must be provided.");
  }
  return result;
}

function randomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

/** Assign realistic placeholder profile data for legacy or OAuth-created accounts. */
export function generateRandomProfile(): UserProfileInput {
  const today = new Date();
  const ageYears = 18 + Math.floor(Math.random() * 52);
  const birthYear = today.getUTCFullYear() - ageYears;
  const birthMonth = 1 + Math.floor(Math.random() * 12);
  const birthDay = 1 + Math.floor(Math.random() * 28);

  const dateOfBirth = [
    String(birthYear),
    String(birthMonth).padStart(2, "0"),
    String(birthDay).padStart(2, "0"),
  ].join("-");

  return {
    firstName: randomItem(FIRST_NAMES),
    lastName: randomItem(LAST_NAMES),
    dateOfBirth,
  };
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
  };
}
