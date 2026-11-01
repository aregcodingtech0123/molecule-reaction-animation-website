export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  isAdmin: boolean;
  isVerified: boolean;
  createdAt: string;
  /** When the account will be deleted if the user asked for deletion (request + 14 days), otherwise null/absent. */
  deletionScheduledFor?: string | null;
}

export interface RegisterProfileInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

/** A string sets the value, `null` clears it, an absent key leaves it alone. */
export interface ProfileUpdateInput {
  firstName?: string | null;
  lastName?: string | null;
  dateOfBirth?: string | null;
}

/** The signed-in user's own data, as returned by POST /api/users/export. */
export interface PersonalDataExport {
  exportedAt: string;
  account: Record<string, unknown>;
  linkedSignIn: unknown[];
  credits: { balance: number };
  creditLedger: unknown[];
  checkoutOrders: unknown[];
  aiCreditHolds: unknown[];
  notes: string[];
}

/** Proof of identity for the export: the account password, or a fresh Google ID token (accounts created with Google). */
export type ReauthSecret = { password: string } | { idToken: string };

/**
 * Successful sign-in as seen by the browser. The session JWT is NOT here: the BFF puts it in the
 * httpOnly `session_token` cookie and strips it from the body (FINDING-24).
 */
export interface AuthSuccessData {
  message: string;
  user: AuthUser;
}

export interface AuthApiResponse {
  success: boolean;
  data?: AuthSuccessData;
  error?: string;
  code?: string;
}

export interface BalanceData {
  userId: string;
  balance: number;
  hasCredits: boolean;
}

export interface BalanceApiResponse {
  success: boolean;
  data?: BalanceData;
  error?: string;
  code?: string;
}

export interface ProfileApiResponse {
  success: boolean;
  data?: AuthUser;
  error?: string;
  code?: string;
}

export const AUTH_TOKEN_STORAGE_KEY = "moleculestudio_auth_token";
export const AUTH_USER_STORAGE_KEY = "moleculestudio_auth_user";
