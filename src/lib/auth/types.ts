export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  isAdmin: boolean;
  isVerified: boolean;
  createdAt: string;
}

export interface RegisterProfileInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
}

export interface ProfileUpdateInput {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
}

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
