"use client";

import { useCallback, useState, type FormEvent } from "react";
import Link from "next/link";
import { Loader2, Mail } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { forgotPasswordRequest } from "@/lib/auth/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordPage() {
  const { ui, isWhiteLab } = useTheme();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [doneMessage, setDoneMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!EMAIL_RE.test(email.trim())) {
        setError("Enter a valid email address.");
        return;
      }
      setError(null);
      setBusy(true);
      try {
        const result = await forgotPasswordRequest(email.trim());
        setDoneMessage(result.message);
        toast.success(result.message);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Request failed.";
        setError(msg);
        toast.error(msg);
      } finally {
        setBusy(false);
      }
    },
    [email],
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
        <h1 className={cn("text-xl font-semibold", ui.typography.title)}>Reset password</h1>
        <p className={cn("mt-2 text-sm", ui.typography.muted)}>
          Enter your account email and we&apos;ll send a recovery link if it exists.
        </p>

        {doneMessage ? (
          <div className="mt-6 space-y-4">
            <p className={cn("text-sm rounded-xl border px-3 py-3", ui.borders.divider, ui.typography.muted)}>
              {doneMessage}
            </p>
            <Link href="/" className={cn("text-sm font-medium underline-offset-2 hover:underline", isWhiteLab ? "text-teal-700" : "text-teal-400")}>
              Back to home
            </Link>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <label className="block space-y-1.5">
              <span className={cn("text-xs font-medium", ui.typography.label)}>Email</span>
              <div className="relative">
                <Mail className={cn("absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2", ui.typography.iconMuted)} />
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  className={inputClass}
                  placeholder="you@example.com"
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
              Send reset link
            </button>
          </form>
        )}
      </div>
    </main>
  );
}
