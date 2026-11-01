"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2, Undo2 } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { cancelDeletionRequest, fetchBalanceRequest, requestDeletionRequest } from "@/lib/auth/api";
import type { ReauthSecret } from "@/lib/auth/types";
import { safeNavigate } from "@/lib/navigation/safe-navigate";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** The warning shown before the user confirms. N is the account's current balance. Kept in one place so tests pin the wording. */
export function forfeitWarning(credits: number): string {
  return `If you delete your account, your remaining ${credits} credits are permanently lost and cannot be restored. Deletion takes effect after a 14-day grace period, during which you can cancel.`;
}

const formatDate = (iso: string) => {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "long", timeZone: "UTC" }).format(new Date(iso));
  } catch {
    return iso;
  }
};

/**
 * "Delete my account": asks for the account to be anonymised after a 14-day grace period (GDPR Art. 17 / KVKK Art. 7). The user
 * re-enters the password - or signs in with Google again, for an account created with Google. On success every session is
 * revoked, so the page signs out. While a request is pending the section shows the date and a "Cancel deletion" button.
 */
export function DeleteAccountSection({
  scheduledFor,
  onCancelled,
}: {
  /** ISO date the account will be deleted, when a request is pending. */
  scheduledFor: string | null | undefined;
  onCancelled: () => void;
}) {
  const router = useRouter();
  const { ui, isWhiteLab } = useTheme();
  const { logout } = useAuth();
  const [credits, setCredits] = useState<number | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetchBalanceRequest()
      .then((b) => alive && setCredits(b.balance))
      .catch(() => alive && setError("Your credit balance could not be loaded, so deletion is unavailable for now. Please reload the page."));
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(
    async (secret: ReauthSecret) => {
      setBusy(true);
      setError(null);
      try {
        await requestDeletionRequest(secret);
        toast.success("Your account is scheduled for deletion. We sent you an email with the date.");
        logout();
        safeNavigate(router, "/", "replace");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Your deletion request could not be sent.");
        setBusy(false);
      }
    },
    [logout, router],
  );

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (!password) {
        setError("Enter your password to confirm.");
        return;
      }
      void run({ password });
    },
    [password, run],
  );

  const onCancel = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelDeletionRequest();
      toast.success("Deletion cancelled. Your account stays as it is.");
      onCancelled();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The deletion request could not be cancelled.");
    } finally {
      setBusy(false);
    }
  }, [onCancelled]);

  const box = cn("space-y-4 rounded-3xl border p-6 sm:p-8", isWhiteLab ? "border-red-200 bg-red-50/60" : "border-red-400/25 bg-red-500/5");

  if (scheduledFor) {
    return (
      <section aria-labelledby="delete-account-heading" className={box}>
        <h2 id="delete-account-heading" className={cn("text-lg font-semibold", ui.typography.title)}>
          Account deletion scheduled
        </h2>
        <p className={cn("text-sm", ui.typography.subtitle)}>
          Your account will be deleted on <strong>{formatDate(scheduledFor)}</strong>. Your remaining credits are lost at that point and cannot be
          restored. Until then you can cancel and nothing changes.
        </p>
        <button
          type="button"
          onClick={() => void onCancel()}
          disabled={busy}
          className={cn("inline-flex items-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-50", ui.nav.cta)}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
          Cancel deletion
        </button>
        {error && (
          <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400" role="alert">
            {error}
          </p>
        )}
      </section>
    );
  }

  return (
    <section aria-labelledby="delete-account-heading" className={box}>
      <div className="space-y-1">
        <h2 id="delete-account-heading" className={cn("text-lg font-semibold", ui.typography.title)}>
          Delete my account
        </h2>
        <p className={cn("text-sm", ui.typography.subtitle)} data-testid="forfeit-warning">
          {credits === null ? "Checking your credit balance…" : forfeitWarning(credits)}
        </p>
        <p className={cn("text-xs", ui.typography.muted)}>
          Your name, date of birth, sign-in methods and email address are removed. Purchase and credit records are kept as the accounting
          record (see the privacy policy). Download your data first if you want a copy.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <label className="block space-y-1.5">
          <span className={cn("text-xs font-medium", ui.typography.muted)}>Confirm deletion with your password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy || credits === null}
            className={cn(
              "w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-red-500/35",
              isWhiteLab ? "border-slate-300 bg-white text-neutral-900" : "border-white/15 bg-black/30 text-white",
            )}
          />
        </label>
        <button
          type="submit"
          disabled={busy || credits === null}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-500/50 bg-red-600/90 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          Delete my account after 14 days
        </button>
      </form>

      <div className="space-y-2">
        <p className={cn("text-xs", ui.typography.muted)}>Signed up with Google and have no password? Confirm by signing in with Google again:</p>
        <GoogleSignInButton onCredential={(idToken) => run({ idToken })} disabled={busy || credits === null} />
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
