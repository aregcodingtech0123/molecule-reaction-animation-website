import { authFetch } from "@/lib/api/auth-interceptor";
import { safeJson } from "@/lib/api/safe-json";
import type {
  AuthApiResponse,
  AuthSuccessData,
  AuthUser,
  BalanceApiResponse,
  BalanceData,
  ProfileApiResponse,
  ProfileUpdateInput,
  RegisterProfileInput,
} from "./types";

export type RegisterRequestResult =
  | AuthSuccessData
  | { message: string };

/**
 * Never call res.json() directly: an HTML 404/502 body throws a SyntaxError
 * before the caller's `!res.ok` guard can run. safeJson() degrades to a
 * { success:false, error } shape so those guards report the real failure.
 */
async function parseJson<T>(res: Response): Promise<T> {
  return safeJson<T>(res);
}

function extractError(data: unknown, fallback: string): string {
  if (data && typeof data === "object" && "error" in data && typeof (data as { error: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  return fallback;
}

export async function loginRequest(email: string, password: string): Promise<AuthSuccessData> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email, password }),
  });

  const data = await parseJson<AuthApiResponse>(res);
  if (!res.ok || !data.success || !data.data) {
    throw new Error(extractError(data, "Invalid credentials."));
  }
  return data.data;
}

export async function registerRequest(
  email: string,
  password: string,
  profile: RegisterProfileInput,
): Promise<RegisterRequestResult> {
  const res = await fetch("/api/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      email,
      password,
      firstName: profile.firstName,
      lastName: profile.lastName,
      dateOfBirth: profile.dateOfBirth,
    }),
  });

  const data = await parseJson<AuthApiResponse>(res);
  if (!res.ok || !data.success || !data.data) {
    throw new Error(extractError(data, "Registration could not be completed."));
  }

  // Since FINDING-09 registration never signs in; kept tolerant of a user payload.
  if ("user" in data.data && data.data.user) {
    return data.data;
  }

  return { message: data.data.message ?? "If this email address is new, your account has been created." };
}

export async function googleLoginRequest(idToken: string): Promise<AuthSuccessData> {
  const res = await fetch("/api/auth/google", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ idToken }),
  });

  const data = await parseJson<AuthApiResponse>(res);
  if (!res.ok || !data.success || !data.data) {
    throw new Error(extractError(data, "Google sign-in could not be completed."));
  }
  return data.data;
}

export async function fetchBalanceRequest(): Promise<BalanceData> {
  const res = await authFetch("/api/billing/balance", {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });

  const data = await parseJson<BalanceApiResponse>(res);
  if (!res.ok || !data.success || !data.data) {
    throw new Error(extractError(data, "Unable to load balance."));
  }
  return data.data;
}

export async function fetchProfileRequest(): Promise<AuthUser> {
  const res = await authFetch("/api/users/profile", {
    method: "GET",
    cache: "no-store",
    credentials: "include",
  });

  const data = await parseJson<ProfileApiResponse>(res);
  if (!res.ok || !data.success || !data.data) {
    throw new Error(extractError(data, "Unable to load profile."));
  }
  return data.data;
}

export async function updateProfileRequest(updates: ProfileUpdateInput): Promise<AuthUser> {
  const res = await authFetch("/api/users/profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(updates),
  });

  const data = await parseJson<ProfileApiResponse>(res);
  if (!res.ok || !data.success || !data.data) {
    throw new Error(extractError(data, "Profile could not be updated."));
  }
  return data.data;
}

export async function verifyEmailRequest(token: string): Promise<AuthSuccessData> {
  const res = await fetch("/api/auth/verify-email", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token }),
  });

  const data = await parseJson<AuthApiResponse>(res);
  if (!res.ok || !data.success || !data.data) {
    throw new Error(extractError(data, "Email verification failed."));
  }
  return data.data;
}

export async function resendVerificationRequest(email: string): Promise<{ message: string }> {
  const res = await fetch("/api/auth/resend-verification", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email }),
  });

  const data = await parseJson<{ success?: boolean; data?: { message?: string }; error?: string }>(res);
  if (!res.ok || !data.success) {
    throw new Error(extractError(data, "Unable to resend verification email."));
  }
  return { message: data.data?.message ?? "If an unverified account exists, a new link has been sent." };
}

export async function forgotPasswordRequest(email: string): Promise<{ message: string }> {
  const res = await fetch("/api/auth/forgot-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ email }),
  });

  const data = await parseJson<{ success?: boolean; data?: { message?: string }; error?: string }>(res);
  if (!res.ok || !data.success) {
    throw new Error(extractError(data, "Unable to start password reset."));
  }
  return { message: data.data?.message ?? "If an account exists, a reset link has been sent." };
}

export async function resetPasswordRequest(token: string, password: string): Promise<{ message: string }> {
  const res = await fetch("/api/auth/reset-password", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token, password }),
  });

  const data = await parseJson<{ success?: boolean; data?: { message?: string }; error?: string }>(res);
  if (!res.ok || !data.success) {
    throw new Error(extractError(data, "Password reset failed."));
  }
  return { message: data.data?.message ?? "Password has been reset." };
}
