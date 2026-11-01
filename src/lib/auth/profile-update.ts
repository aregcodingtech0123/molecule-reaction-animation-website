import type { ProfileUpdateInput } from "./types";
import { validateDateOfBirth, validateFirstName, validateLastName } from "./profile-validation";

export interface ProfileFormValues {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

/**
 * What the profile form should send. An account created with Google starts with all three fields empty, and a user may
 * remove a value they entered, so:
 *  - a field that is empty and was empty stays out of the request (nothing to say, nothing to validate);
 *  - a field that is empty but had a value is sent as `null` (the service clears it);
 *  - a filled field is validated, and sent only if it differs from what is stored.
 * Returns the first validation message instead of an update when a filled field is invalid.
 */
export function buildProfileUpdate(
  current: ProfileFormValues,
  form: ProfileFormValues,
): { updates: ProfileUpdateInput; error: null } | { updates: null; error: string } {
  const updates: ProfileUpdateInput = {};
  const fields: [keyof ProfileFormValues, (v: string) => string | null][] = [
    ["firstName", validateFirstName],
    ["lastName", validateLastName],
    ["dateOfBirth", validateDateOfBirth],
  ];
  for (const [key, validate] of fields) {
    const value = form[key].trim();
    if (!value) {
      if (current[key]) updates[key] = null;
      continue;
    }
    const error = validate(value);
    if (error) return { updates: null, error };
    if (value !== current[key]) updates[key] = value;
  }
  return { updates, error: null };
}
