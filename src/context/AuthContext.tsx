"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useLanguage } from "@/context/LanguageContext";
import { registerUnauthorizedHandler } from "@/lib/api/auth-interceptor";
import {
  fetchBalanceRequest,
  fetchProfileRequest,
  googleLoginRequest,
  loginRequest,
  registerRequest,
  type RegisterRequestResult,
} from "@/lib/auth/api";
import { toast } from "@/lib/toast";
import { AUTH_TOKEN_STORAGE_KEY, AUTH_USER_STORAGE_KEY, type AuthUser } from "@/lib/auth/types";

export type AuthModalMode = "login" | "register";

const GENERIC_REGISTER_MESSAGE =
  "If this email address is new, your account has been created. Check your inbox to verify your email.";

const VERIFY_EMAIL_REGISTER_MESSAGE =
  "Account created. Check your inbox to verify your email and unlock 10 free AI credits.";

interface AuthContextValue {
  user: AuthUser | null;
  /** @deprecated JWT is httpOnly-only — never available to client JS. */
  token: null;
  credits: number | null;
  isAuthenticated: boolean;
  isHydrated: boolean;
  isAuthLoading: boolean;
  isGoogleLoading: boolean;
  authModalOpen: boolean;
  authModalMode: AuthModalMode;
  sessionExpired: boolean;
  sessionExpiredMessage: string | null;
  billingModalOpen: boolean;
  openAuthModal: (mode?: AuthModalMode) => void;
  closeAuthModal: () => void;
  openBillingModal: () => void;
  closeBillingModal: () => void;
  login: (email: string, password: string) => Promise<void>;
  register: (
    email: string,
    password: string,
    profile: { firstName: string; lastName: string; dateOfBirth: string },
  ) => Promise<void>;
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => void;
  fetchBalance: () => Promise<void>;
  patchUser: (updates: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredUser(): AuthUser | null {
  if (typeof window === "undefined") return null;

  const rawUser = window.localStorage.getItem(AUTH_USER_STORAGE_KEY);
  if (!rawUser) return null;

  try {
    const parsed = JSON.parse(rawUser) as Partial<AuthUser>;
    if (!parsed?.id || !parsed?.email) return null;
    return {
      id: parsed.id,
      email: parsed.email,
      firstName: parsed.firstName ?? "",
      lastName: parsed.lastName ?? "",
      dateOfBirth: parsed.dateOfBirth ?? "",
      isAdmin: parsed.isAdmin ?? false,
      isVerified: parsed.isVerified ?? false,
      createdAt: parsed.createdAt ?? "",
    };
  } catch {
    return null;
  }
}

function persistUser(user: AuthUser): void {
  window.localStorage.setItem(AUTH_USER_STORAGE_KEY, JSON.stringify(user));
}

function clearPersistedUser(): void {
  window.localStorage.removeItem(AUTH_USER_STORAGE_KEY);
  window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
}

async function syncSessionCookie(token: string): Promise<void> {
  const res = await fetch("/api/auth/set-cookie", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    throw new Error("Failed to establish session.");
  }
}

async function clearSessionCookie(): Promise<void> {
  try {
    await fetch("/api/auth/clear-cookie", {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Best-effort cookie clear.
  }
}

function isAuthSuccess(
  result: RegisterRequestResult,
): result is { token: string; user: AuthUser; message: string } {
  return "token" in result && "user" in result;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const [isAuthLoading, setIsAuthLoading] = useState(false);
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalMode, setAuthModalMode] = useState<AuthModalMode>("login");
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionExpiredMessage, setSessionExpiredMessage] = useState<string | null>(null);
  const [billingModalOpen, setBillingModalOpen] = useState(false);

  const fetchBalance = useCallback(async () => {
    if (!readStoredUser() && !user) {
      setCredits(null);
      return;
    }

    try {
      const data = await fetchBalanceRequest();
      setCredits(data.balance);
    } catch {
      setCredits(null);
    }
  }, [user]);

  useEffect(() => {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);

    const storedUser = readStoredUser();
    if (storedUser) {
      setUser(storedUser);
      void Promise.all([fetchBalanceRequest(), fetchProfileRequest()])
        .then(([balance, profile]) => {
          setCredits(balance.balance);
          persistUser(profile);
          setUser(profile);
        })
        .catch(() => {
          clearPersistedUser();
          setUser(null);
          setCredits(null);
        });
    }
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    registerUnauthorizedHandler(({ sessionExpired: expired }) => {
      if (!expired) return;
      clearPersistedUser();
      void clearSessionCookie();
      setUser(null);
      setCredits(null);
      setSessionExpired(true);
      setSessionExpiredMessage("Your session has expired. Please sign in again.");
      setAuthModalMode("login");
      setAuthModalOpen(true);
    });
    return () => registerUnauthorizedHandler(null);
  }, []);

  useEffect(() => {
    if (!isHydrated) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("auth") === "required") {
      setAuthModalMode("login");
      setAuthModalOpen(true);
      params.delete("auth");
      const next = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
      window.history.replaceState({}, "", next);
    }
  }, [isHydrated]);

  useEffect(() => {
    if (!isHydrated || !user) return;
    void fetchBalance();
  }, [isHydrated, user, fetchBalance]);

  useEffect(() => {
    if (!isHydrated) return;
    const params = new URLSearchParams(window.location.search);
    const billingStatus = params.get("billing");
    if (billingStatus === "success") {
      void fetchBalance();
      setBillingModalOpen(false);
      toast.success(t.toast_credits_purchased ?? "Credits applied to your balance.");
      params.delete("billing");
      const next = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
      window.history.replaceState({}, "", next);
    } else if (billingStatus === "cancel") {
      params.delete("billing");
      const next = `${window.location.pathname}${params.size ? `?${params}` : ""}`;
      window.history.replaceState({}, "", next);
    }
  }, [isHydrated, fetchBalance, t.toast_credits_purchased]);

  const applySession = useCallback(
    async (nextToken: string, nextUser: AuthUser, mode: "login" | "register") => {
      await syncSessionCookie(nextToken);
      persistUser(nextUser);
      setUser(nextUser);
      setSessionExpired(false);
      setSessionExpiredMessage(null);
      setAuthModalOpen(false);

      try {
        const data = await fetchBalanceRequest();
        setCredits(data.balance);
        if (mode === "register") {
          toast.success(VERIFY_EMAIL_REGISTER_MESSAGE);
        } else {
          toast.success(t.toast_signed_in ?? "You're signed in.");
        }
      } catch {
        setCredits(null);
        toast.success(
          mode === "register"
            ? VERIFY_EMAIL_REGISTER_MESSAGE
            : (t.toast_signed_in ?? "You're signed in."),
        );
      }
    },
    [t.toast_signed_in],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      setIsAuthLoading(true);
      try {
        const data = await loginRequest(email, password);
        await applySession(data.token, data.user, "login");
      } catch (err) {
        const message =
          err instanceof Error ? err.message : (t.toast_sign_in_failed ?? "Sign in failed. Check your credentials.");
        toast.error(message);
        throw err;
      } finally {
        setIsAuthLoading(false);
      }
    },
    [applySession, t.toast_sign_in_failed],
  );

  const register = useCallback(
    async (
      email: string,
      password: string,
      profile: { firstName: string; lastName: string; dateOfBirth: string },
    ) => {
      setIsAuthLoading(true);
      try {
        const data = await registerRequest(email, password, profile);
        if (!isAuthSuccess(data)) {
          setAuthModalOpen(false);
          toast.success(data.message ?? GENERIC_REGISTER_MESSAGE);
          return;
        }
        await applySession(data.token, data.user, "register");
      } catch (err) {
        const message =
          err instanceof Error
            ? err.message
            : (t.toast_registration_failed ?? "Registration could not be completed.");
        toast.error(message);
        throw err;
      } finally {
        setIsAuthLoading(false);
      }
    },
    [applySession, t.toast_registration_failed],
  );

  const loginWithGoogle = useCallback(
    async (idToken: string) => {
      setIsGoogleLoading(true);
      try {
        const data = await googleLoginRequest(idToken);
        const mode = data.message.toLowerCase().includes("registered") ? "register" : "login";
        await applySession(data.token, data.user, mode);
      } catch (err) {
        const message =
          err instanceof Error ? err.message : (t.toast_sign_in_failed ?? "Sign in failed. Check your credentials.");
        toast.error(message);
        throw err;
      } finally {
        setIsGoogleLoading(false);
      }
    },
    [applySession, t.toast_sign_in_failed],
  );

  const logout = useCallback(() => {
    void (async () => {
      try {
        await fetch("/api/auth/logout", {
          method: "POST",
          credentials: "include",
        });
      } catch {
        // Best-effort server-side revocation.
      }
      clearPersistedUser();
      await clearSessionCookie();
      setUser(null);
      setCredits(null);
      setSessionExpired(false);
      setSessionExpiredMessage(null);
      toast.info(t.toast_signed_out ?? "Signed out of your session.");
    })();
  }, [t.toast_signed_out]);

  const openAuthModal = useCallback((mode: AuthModalMode = "login") => {
    setAuthModalMode(mode);
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalOpen(false);
    setSessionExpired(false);
    setSessionExpiredMessage(null);
  }, []);

  const openBillingModal = useCallback(() => {
    setBillingModalOpen(true);
  }, []);

  const closeBillingModal = useCallback(() => {
    setBillingModalOpen(false);
  }, []);

  const patchUser = useCallback((updates: Partial<AuthUser>) => {
    setUser((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ...updates };
      persistUser(next);
      return next;
    });
  }, []);

  const value = useMemo(
    (): AuthContextValue => ({
      user,
      token: null,
      credits,
      isAuthenticated: Boolean(user),
      isHydrated,
      isAuthLoading,
      isGoogleLoading,
      authModalOpen,
      authModalMode,
      sessionExpired,
      sessionExpiredMessage,
      billingModalOpen,
      openAuthModal,
      closeAuthModal,
      openBillingModal,
      closeBillingModal,
      login,
      register,
      loginWithGoogle,
      logout,
      fetchBalance,
      patchUser,
    }),
    [
      user,
      credits,
      isHydrated,
      isAuthLoading,
      isGoogleLoading,
      authModalOpen,
      authModalMode,
      sessionExpired,
      sessionExpiredMessage,
      billingModalOpen,
      openAuthModal,
      closeAuthModal,
      openBillingModal,
      closeBillingModal,
      login,
      register,
      loginWithGoogle,
      logout,
      fetchBalance,
      patchUser,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
