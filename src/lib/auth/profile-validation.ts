const NAME_RE = /^[\p{L}\p{M}' -]+$/u;

export function validateFirstName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "First name is required.";
  if (trimmed.length > 100) return "First name must be at most 100 characters.";
  if (!NAME_RE.test(trimmed)) return "First name contains invalid characters.";
  return null;
}

export function validateLastName(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Last name is required.";
  if (trimmed.length > 100) return "Last name must be at most 100 characters.";
  if (!NAME_RE.test(trimmed)) return "Last name contains invalid characters.";
  return null;
}

export function validateDateOfBirth(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return "Date of birth is required.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return "Date of birth must be in YYYY-MM-DD format.";
  }

  const [year, month, day] = trimmed.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return "Date of birth is not a valid calendar date.";
  }

  const today = new Date();
  const minAgeDate = new Date(
    Date.UTC(today.getUTCFullYear() - 13, today.getUTCMonth(), today.getUTCDate()),
  );
  const maxAgeDate = new Date(
    Date.UTC(today.getUTCFullYear() - 120, today.getUTCMonth(), today.getUTCDate()),
  );

  if (date > minAgeDate) return "You must be at least 13 years old to register.";
  if (date < maxAgeDate) return "Date of birth is out of allowed range.";
  return null;
}
