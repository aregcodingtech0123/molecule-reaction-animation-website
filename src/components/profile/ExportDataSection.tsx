"use client";

import { useCallback, useState, type FormEvent } from "react";
import { Download, Loader2 } from "lucide-react";
import { GoogleSignInButton } from "@/components/auth/GoogleSignInButton";
import { useTheme } from "@/context/ThemeContext";
import { exportDataRequest } from "@/lib/auth/api";
import type { PersonalDataExport, ReauthSecret } from "@/lib/auth/types";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

/** The browser saves the JSON itself; nothing is uploaded and the file name carries no personal data. */
function downloadJson(data: PersonalDataExport): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `moleculestudio-my-data-${data.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/**
 * "Download my data" (GDPR Art. 15/20, KVKK Art. 11): the user re-enters the password - or signs in with Google again, for an
 * account created with Google - and receives one JSON file with their own data.
 */
export function ExportDataSection() {
  const { ui, isWhiteLab } = useTheme();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (secret: ReauthSecret) => {
    setBusy(true);
    setError(null);
    try {
      downloadJson(await exportDataRequest(secret));
      setPassword("");
      toast.success("Your data file was downloaded.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your data could not be exported.");
    } finally {
      setBusy(false);
    }
  }, []);

  const onSubmit = useCallback(
    (e: FormEvent) => {
      e.preventDefault();
      if (!password) {
        setError("Enter your password to download your data.");
        return;
      }
      void run({ password });
    },
    [password, run],
  );

  return (
    <section
      aria-labelledby="export-data-heading"
      className={cn(
        "space-y-4 rounded-3xl border p-6 sm:p-8",
        isWhiteLab ? "border-slate-200 bg-white/80" : "border-white/10 bg-white/5",
      )}
    >
      <div className="space-y-1">
        <h2 id="export-data-heading" className={cn("text-lg font-semibold", ui.typography.title)}>
          Download my data
        </h2>
        <p className={cn("text-sm", ui.typography.subtitle)}>
          Get a copy of the data we hold about your account as one JSON file: your profile, sign-in methods, credit balance,
          every credit transaction, checkout orders and AI credit reservations. It never contains your password or any token. AI Lab
          conversations are not stored, so they are not in it.
        </p>
      </div>

      <form onSubmit={onSubmit} className="space-y-3" noValidate>
        <label className="block space-y-1.5">
          <span className={cn("text-xs font-medium", ui.typography.muted)}>Confirm with your password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            className={cn(
              "w-full rounded-xl border px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500/35",
              isWhiteLab ? "border-slate-300 bg-white text-neutral-900" : "border-white/15 bg-black/30 text-white",
            )}
          />
        </label>
        <button
          type="submit"
          disabled={busy}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm font-semibold disabled:opacity-50",
            ui.nav.cta,
          )}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Download my data
        </button>
      </form>

      <div className="space-y-2">
        <p className={cn("text-xs", ui.typography.muted)}>
          Signed up with Google and have no password? Confirm by signing in with Google again:
        </p>
        <GoogleSignInButton onCredential={(idToken) => run({ idToken })} disabled={busy} />
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-400" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
