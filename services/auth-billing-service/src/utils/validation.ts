const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: unknown): string {
  if (typeof email !== "string") {
    throw new ValidationError("Email is required.");
  }
  const normalized = email.trim().toLowerCase();
  if (!normalized || normalized.length > 320) {
    throw new ValidationError("Email is invalid.");
  }
  if (!EMAIL_RE.test(normalized)) {
    throw new ValidationError("Email format is invalid.");
  }
  return normalized;
}

export function validatePassword(password: unknown): string {
  if (typeof password !== "string") {
    throw new ValidationError("Password is required.");
  }
  if (password.length < 8) {
    throw new ValidationError(
      "Password must be at least 8 characters and contain a letter and a number.",
    );
  }
  if (password.length > 128) {
    throw new ValidationError("Password must be at most 128 characters.");
  }
  if (!/[A-Za-z]/.test(password)) {
    throw new ValidationError(
      "Password must be at least 8 characters and contain a letter and a number.",
    );
  }
  if (!/[0-9]/.test(password)) {
    throw new ValidationError(
      "Password must be at least 8 characters and contain a letter and a number.",
    );
  }
  return password;
}

export function validateGoogleIdToken(token: unknown): string {
  if (typeof token !== "string") {
    throw new ValidationError("Google ID token is required.");
  }
  const trimmed = token.trim();
  if (!trimmed || trimmed.length > 8192) {
    throw new ValidationError("Google ID token is invalid.");
  }
  return trimmed;
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}
