"use client";

import { Suspense, useCallback, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Loader2, Lock } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { resetPasswordRequest } from "@/lib/auth/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const { openAuthModal } = useAuth();
  const { ui, isWhiteLab } = useTheme();

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      const token = searchParams.get("token")?.trim();
      if (!token) {
        setError("Missing reset token. Open the link from your email.");
        return;
      }
      if (password.length < 8) {
        setError("Password must be at least 8 characters.");
        return;
      }
      if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
        setError("Password must include a letter and a number.");
        return;
      }
      if (password !== confirm) {
        setError("Passwords do not match.");
        return;
      }

      setError(null);
      setBusy(true);
      try {
        const result = await resetPasswordRequest(token, password);
        setDone(true);
        toast.success(result.message);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Password reset failed.";
        setError(msg);
        toast.error(msg);
      } finally {
        setBusy(false);
      }
    },
    [searchParams, password, confirm],
  );

  const inputClass = cn(
    "w-full rounded-xl border py-2.5 pl-10 pr-3 text-sm transition-colors",
    "focus:outline-none focus:ring-2 focus:ring-teal-500/35 focus:border-teal-400/55",
    isWhiteLab
      ? "border-slate-300 bg-white text-neutral-900"
      : "border-white/10 bg-black/30 text-white [color-scheme:dark]",
  );

  return (
    <main className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center px-4 py-16">
      <div
        className={cn(
          "w-full max-w-md rounded-3xl border p-8 backdrop-blur-md",
          isWhiteLab
            ? "border-slate-200 bg-white/90 shadow-lg"
            : "border-white/10 bg-white/5 shadow-2xl",
        )}
      >
        <h1 className={cn("text-xl font-semibold", ui.typography.title)}>Choose a new password</h1>
        <p className={cn("mt-2 text-sm", ui.typography.muted)}>
          Pick a strong password to regain access to your account.
        </p>

        {done ? (
          <div className="mt-6 space-y-4">
            <p className={cn("text-sm", ui.typography.muted)}>
              Your password has been updated. You can sign in now.
            </p>
            <button
              type="button"
              onClick={() => openAuthModal("login")}
              className={cn("w-full rounded-xl border py-3 text-sm font-semibold", ui.nav.cta)}
            >
              Sign in
            </button>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <label className="block space-y-1.5">
              <span className={cn("text-xs font-medium", ui.typography.label)}>New password</span>
              <div className="relative">
                <Lock className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", ui.typography.iconMuted)} />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={busy}
                  className={inputClass}
                  placeholder="••••••••"
                />
              </div>
            </label>

            <label className="block space-y-1.5">
              <span className={cn("text-xs font-medium", ui.typography.label)}>Confirm password</span>
              <div className="relative">
                <Lock className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", ui.typography.iconMuted)} />
                <input
                  type="password"
                  autoComplete="new-password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  disabled={busy}
                  className={inputClass}
                  placeholder="••••••••"
                />
              </div>
            </label>

            {error && (
              <p className="text-xs text-red-500 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className={cn(
                "w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold border",
                ui.nav.cta,
                "disabled:opacity-50",
              )}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Update password
            </button>

            <Link href="/forgot-password" className={cn("block text-center text-xs underline-offset-2 hover:underline", ui.typography.muted)}>
              Request a new link
            </Link>
          </form>
        )}
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
        </main>
      }
    >
      <ResetPasswordInner />
    </Suspense>
  );
}
