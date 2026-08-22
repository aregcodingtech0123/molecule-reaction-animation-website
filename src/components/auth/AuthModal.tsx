"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Atom, Loader2, Lock, Mail, Sparkles, User, X, Calendar } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { useAuth, type AuthModalMode } from "@/context/AuthContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import type { TranslationDictionary } from "@/lib/i18n/types";
import {
  validateDateOfBirth,
  validateFirstName,
  validateLastName,
} from "@/lib/auth/profile-validation";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const inputFocus =
  "focus:outline-none focus:ring-2 focus:ring-teal-500/35 focus:border-teal-400/55";

function validateForm(
  email: string,
  password: string,
  mode: AuthModalMode,
  t: TranslationDictionary,
  profile?: { firstName: string; lastName: string; dateOfBirth: string },
): string | null {
  if (!email.trim()) return t.auth_val_email_required ?? "Email is required.";
  if (!EMAIL_RE.test(email.trim())) return t.auth_val_email_invalid ?? "Enter a valid email address.";
  if (!password) return t.auth_val_password_required ?? "Password is required.";
  if (password.length < 8) return t.auth_val_password_length ?? "Password must be at least 8 characters.";
  if (mode === "register" && !/[A-Za-z]/.test(password)) {
    return t.auth_val_password_letter ?? "Password must include a letter.";
  }
  if (mode === "register" && !/[0-9]/.test(password)) {
    return t.auth_val_password_number ?? "Password must include a number.";
  }
  if (mode === "register" && profile) {
    const firstNameError = validateFirstName(profile.firstName);
    if (firstNameError) return t.auth_val_first_name ?? firstNameError;
    const lastNameError = validateLastName(profile.lastName);
    if (lastNameError) return t.auth_val_last_name ?? lastNameError;
    const dobError = validateDateOfBirth(profile.dateOfBirth);
    if (dobError) return t.auth_val_dob ?? dobError;
  }
  return null;
}

export function AuthModal() {
  const {
    authModalOpen,
    authModalMode,
    sessionExpired,
    sessionExpiredMessage,
    closeAuthModal,
    openAuthModal,
    login,
    register,
    loginWithGoogle,
    isAuthLoading,
    isGoogleLoading,
  } = useAuth();
  const { ui, isWhiteLab } = useTheme();
  const { t } = useLanguage();

  const [mode, setMode] = useState<AuthModalMode>(authModalMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [error, setError] = useState<string | null>(null);

  const busy = isAuthLoading || isGoogleLoading;

  useEffect(() => {
    if (authModalOpen) {
      setMode(authModalMode);
      setError(null);
    }
  }, [authModalOpen, authModalMode]);

  useEffect(() => {
    if (!authModalOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [authModalOpen]);

  const switchMode = useCallback(
    (next: AuthModalMode) => {
      setMode(next);
      setError(null);
      if (next === "login") {
        setFirstName("");
        setLastName("");
        setDateOfBirth("");
      }
      openAuthModal(next);
    },
    [openAuthModal],
  );

  const clearForm = useCallback(() => {
    setEmail("");
    setPassword("");
    setFirstName("");
    setLastName("");
    setDateOfBirth("");
  }, []);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const validationError = validateForm(email, password, mode, t, {
        firstName,
        lastName,
        dateOfBirth,
      });
      if (validationError) {
        setError(validationError);
        return;
      }

      setError(null);
      try {
        if (mode === "login") {
          await login(email.trim(), password);
        } else {
          await register(email.trim(), password, {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            dateOfBirth,
          });
        }
        clearForm();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : (t.auth_error_generic ?? "Request could not be completed.");
        setError(
          mode === "login" && message.toLowerCase().includes("invalid")
            ? (t.auth_error_invalid ?? "Invalid credentials.")
            : message,
        );
      }
    },
    [email, password, firstName, lastName, dateOfBirth, mode, login, register, clearForm, t],
  );

  const handleGoogleCredential = useCallback(
    async (idToken: string) => {
      setError(null);
      try {
        await loginWithGoogle(idToken);
        clearForm();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : (t.auth_error_generic ?? "Request could not be completed.");
        setError(message);
      }
    },
    [loginWithGoogle, clearForm, t.auth_error_generic],
  );

  const inputClass = cn(
    "w-full rounded-xl border py-2.5 pr-3 text-sm transition-colors",
    inputFocus,
    "disabled:opacity-60",
    isWhiteLab
      ? "border-slate-300 bg-white text-neutral-900 placeholder:text-neutral-400"
      : "border-white/10 bg-black/30 text-white placeholder:text-gray-600 [color-scheme:dark]",
  );

  return (
    <AnimatePresence>
      {authModalOpen && (
        <>
          <motion.button
            type="button"
            aria-label="Close authentication dialog"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-black/55 backdrop-blur-md"
            onClick={closeAuthModal}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="auth-modal-title"
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "fixed left-1/2 top-1/2 z-[101] -translate-x-1/2 -translate-y-1/2",
              "rounded-2xl border shadow-2xl backdrop-blur-xl overflow-hidden",
              mode === "register"
                ? "w-[min(100vw-2rem,28rem)] max-h-[min(92vh,44rem)] flex flex-col"
                : "w-[min(100vw-2rem,26rem)]",
              isWhiteLab
                ? "border-slate-200/90 bg-white/92 shadow-slate-300/40"
                : "border-white/12 bg-neutral-950/88 shadow-black/60",
            )}
          >
            <div
              className={cn(
                "relative px-6 pt-6 pb-4 border-b",
                isWhiteLab
                  ? "border-slate-200/80 bg-gradient-to-br from-teal-50/70 via-white to-white"
                  : "border-white/10 bg-gradient-to-br from-teal-950/35 via-neutral-950/20 to-black/40",
              )}
            >
              <button
                type="button"
                onClick={closeAuthModal}
                className={cn(
                  "absolute right-4 top-4 rounded-lg p-1.5 transition-colors",
                  ui.controls.iconButton,
                  isWhiteLab ? "hover:bg-slate-100" : "hover:bg-white/10",
                )}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-3 mb-3">
                <div
                  className={cn(
                    "flex h-11 w-11 items-center justify-center rounded-xl border",
                    isWhiteLab
                      ? "bg-teal-50 border-teal-200/80"
                      : "bg-teal-500/15 border-teal-400/35 shadow-[0_0_18px_rgba(45,212,191,0.18)]",
                  )}
                >
                  <Atom className={cn("h-5 w-5", isWhiteLab ? "text-teal-700" : "text-teal-300")} />
                </div>
                <div>
                  <h2 id="auth-modal-title" className={cn("text-lg font-semibold", ui.typography.title)}>
                    {mode === "login"
                      ? (t.auth_login_title ?? "Sign in to your lab")
                      : (t.auth_register_title ?? "Create your account")}
                  </h2>
                  <p className={cn("text-xs", ui.typography.muted)}>
                    {t.auth_modal_subtitle ?? "Access AI structure generation and credit balance"}
                  </p>
                </div>
              </div>

              <div
                className={cn(
                  "flex rounded-full p-1 border",
                  isWhiteLab ? "bg-slate-100 border-slate-200" : "bg-white/5 border-white/10",
                )}
              >
                {(["login", "register"] as const).map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => switchMode(tab)}
                    className={cn(
                      "flex-1 rounded-full py-2 text-xs font-semibold transition-all duration-200",
                      mode === tab
                        ? isWhiteLab
                          ? "bg-white text-teal-900 shadow-sm border border-teal-200/60"
                          : "bg-teal-500/25 text-teal-100 border border-teal-400/40 shadow-[0_0_20px_rgba(45,212,191,0.22)]"
                        : cn(ui.typography.muted, "hover:opacity-90"),
                    )}
                  >
                    {tab === "login" ? (t.auth_tab_login ?? "Log In") : (t.auth_tab_register ?? "Sign Up")}
                  </button>
                ))}
              </div>
            </div>

            <div className={cn("px-6 py-5 space-y-4", mode === "register" && "overflow-y-auto flex-1")}>
              {sessionExpired && sessionExpiredMessage && (
                <p
                  className="text-xs text-amber-200 rounded-lg border border-amber-400/25 bg-amber-500/10 px-3 py-2"
                  role="status"
                >
                  {sessionExpiredMessage}
                </p>
              )}

              <GoogleSignInButton
                onCredential={handleGoogleCredential}
                disabled={busy}
              />

              <div className="flex items-center gap-3">
                <div className={cn("h-px flex-1", isWhiteLab ? "bg-slate-200" : "bg-white/10")} />
                <span className={cn("text-[10px] uppercase tracking-widest", ui.typography.muted)}>
                  {t.auth_google_divider ?? "or continue with email"}
                </span>
                <div className={cn("h-px flex-1", isWhiteLab ? "bg-slate-200" : "bg-white/10")} />
              </div>

              <form onSubmit={(e) => void onSubmit(e)} className="space-y-4">
                {mode === "register" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="block space-y-1.5 sm:col-span-1">
                      <span className={cn("text-xs font-medium", ui.typography.label)}>
                        {t.auth_first_name_label ?? "First Name"}
                      </span>
                      <div className="relative">
                        <User
                          className={cn(
                            "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                            ui.typography.iconMuted,
                          )}
                        />
                        <input
                          type="text"
                          autoComplete="given-name"
                          value={firstName}
                          onChange={(e) => setFirstName(e.target.value)}
                          disabled={busy}
                          className={cn(inputClass, "pl-10")}
                          placeholder="Jane"
                        />
                      </div>
                    </label>

                    <label className="block space-y-1.5 sm:col-span-1">
                      <span className={cn("text-xs font-medium", ui.typography.label)}>
                        {t.auth_last_name_label ?? "Last Name"}
                      </span>
                      <div className="relative">
                        <User
                          className={cn(
                            "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                            ui.typography.iconMuted,
                          )}
                        />
                        <input
                          type="text"
                          autoComplete="family-name"
                          value={lastName}
                          onChange={(e) => setLastName(e.target.value)}
                          disabled={busy}
                          className={cn(inputClass, "pl-10")}
                          placeholder="Doe"
                        />
                      </div>
                    </label>

                    <label className="block space-y-1.5 sm:col-span-2">
                      <span className={cn("text-xs font-medium", ui.typography.label)}>
                        {t.auth_dob_label ?? "Date of Birth"}
                      </span>
                      <div className="relative">
                        <Calendar
                          className={cn(
                            "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                            ui.typography.iconMuted,
                          )}
                        />
                        <input
                          type="date"
                          value={dateOfBirth}
                          onChange={(e) => setDateOfBirth(e.target.value)}
                          disabled={busy}
                          className={cn(inputClass, "pl-10")}
                        />
                      </div>
                    </label>
                  </div>
                )}

                <label className="block space-y-1.5">
                  <span className={cn("text-xs font-medium", ui.typography.label)}>
                    {t.auth_email_label ?? "Email"}
                  </span>
                  <div className="relative">
                    <Mail
                      className={cn(
                        "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                        ui.typography.iconMuted,
                      )}
                    />
                    <input
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      disabled={busy}
                      className={cn(inputClass, "pl-10")}
                      placeholder="you@molecule.studio"
                    />
                  </div>
                </label>

                <label className="block space-y-1.5">
                  <span className={cn("text-xs font-medium", ui.typography.label)}>
                    {t.auth_password_label ?? "Password"}
                  </span>
                  <div className="relative">
                    <Lock
                      className={cn(
                        "absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2",
                        ui.typography.iconMuted,
                      )}
                    />
                    <input
                      type="password"
                      autoComplete={mode === "login" ? "current-password" : "new-password"}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      disabled={busy}
                      className={cn(inputClass, "pl-10")}
                      placeholder="••••••••"
                    />
                  </div>
                </label>

                {mode === "login" && (
                  <div className="flex justify-end -mt-1">
                    <a
                      href="/forgot-password"
                      className={cn(
                        "text-[11px] font-medium underline-offset-2 hover:underline",
                        isWhiteLab ? "text-teal-700" : "text-teal-400",
                      )}
                    >
                      {t.auth_forgot_password ?? "Forgot password?"}
                    </a>
                  </div>
                )}

                {mode === "register" && (
                  <p className={cn("text-[11px] leading-relaxed", ui.typography.muted)}>
                    <Sparkles className={cn("inline h-3 w-3 mr-1", isWhiteLab ? "text-teal-700" : "text-teal-400")} />
                    {t.auth_signup_bonus ??
                      "Verify your email after signup to unlock 10 free AI credits."}
                  </p>
                )}

                {error && (
                  <p
                    className="text-xs text-red-500 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2"
                    role="alert"
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className={cn(
                    "w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold transition-all border",
                    ui.nav.cta,
                    "disabled:opacity-50 disabled:cursor-not-allowed",
                  )}
                >
                  {isAuthLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t.auth_loading ?? "Please wait…"}
                    </>
                  ) : mode === "login" ? (
                    (t.auth_submit_login ?? "Log In")
                  ) : (
                    (t.auth_submit_register ?? "Create Account")
                  )}
                </button>
              </form>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
