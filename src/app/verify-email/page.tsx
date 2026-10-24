"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Loader2, MailWarning } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
import { verifyEmailRequest } from "@/lib/auth/api";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";

function VerifyEmailInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { completeSignIn, fetchBalance, openAuthModal } = useAuth();
  const { ui, isWhiteLab } = useTheme();

  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  /** Tokens already submitted: a one-time token must be posted exactly once (FINDING-32). */
  const submittedRef = useRef<Set<string>>(new Set());

  const runVerify = useCallback(async () => {
    const token = searchParams.get("token")?.trim();
    if (token) {
      // The effect re-runs whenever auth callbacks change identity (and twice in React Strict
      // Mode); re-posting a consumed token answered 400 and could overwrite the success state.
      if (submittedRef.current.has(token)) return;
      submittedRef.current.add(token);
    }
    if (!token) {
      setStatus("error");
      setMessage("Missing verification token. Open the link from your email.");
      return;
    }

    setStatus("loading");
    try {
      // The BFF set the httpOnly session cookie on this response (FINDING-24); the page only
      // adopts the public profile. Verification is also how a new account first signs in (FINDING-09).
      const data = await verifyEmailRequest(token);
      if (data.user) {
        await completeSignIn(data.user);
      } else {
        await fetchBalance();
      }
      setStatus("success");
      setMessage(data.message || "Email verified. Starter credits have been added.");
      toast.success("Email verified. 10 AI credits unlocked.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Verification failed.";
      setStatus("error");
      setMessage(msg);
      toast.error(msg);
    }
  }, [searchParams, completeSignIn, fetchBalance]);

  useEffect(() => {
    void runVerify();
  }, [runVerify]);

  return (
    <main className="min-h-[calc(100vh-8rem)] flex flex-col items-center justify-center px-4 py-16">
      <div
        className={cn(
          "w-full max-w-md rounded-3xl border p-8 text-center backdrop-blur-md",
          isWhiteLab
            ? "border-slate-200 bg-white/90 shadow-lg"
            : "border-white/10 bg-white/5 shadow-2xl",
        )}
      >
        {status === "loading" || status === "idle" ? (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-teal-400" />
            <h1 className={cn("mt-4 text-xl font-semibold", ui.typography.title)}>
              Verifying your email…
            </h1>
            <p className={cn("mt-2 text-sm", ui.typography.muted)}>
              Please wait while we confirm your address.
            </p>
          </>
        ) : status === "success" ? (
          <>
            <CheckCircle2 className="mx-auto h-10 w-10 text-teal-400" />
            <h1 className={cn("mt-4 text-xl font-semibold", ui.typography.title)}>
              Email verified
            </h1>
            <p className={cn("mt-2 text-sm", ui.typography.muted)}>{message}</p>
            <button
              type="button"
              onClick={() => router.push("/ai-lab")}
              className={cn("mt-6 w-full rounded-xl border py-3 text-sm font-semibold", ui.nav.cta)}
            >
              Open AI Lab
            </button>
          </>
        ) : (
          <>
            <MailWarning className="mx-auto h-10 w-10 text-amber-400" />
            <h1 className={cn("mt-4 text-xl font-semibold", ui.typography.title)}>
              Verification failed
            </h1>
            <p className={cn("mt-2 text-sm", ui.typography.muted)}>{message}</p>
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => openAuthModal("login")}
                className={cn("w-full rounded-xl border py-3 text-sm font-semibold", ui.nav.cta)}
              >
                Sign in to resend
              </button>
              <Link href="/" className={cn("text-sm underline-offset-2 hover:underline", ui.typography.muted)}>
                Back to home
              </Link>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-[calc(100vh-8rem)] flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-teal-400" />
        </main>
      }
    >
      <VerifyEmailInner />
    </Suspense>
  );
}
