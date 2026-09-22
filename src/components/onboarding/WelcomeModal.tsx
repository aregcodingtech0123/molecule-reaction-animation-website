"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { usePathname, useRouter } from "next/navigation";
import {
  Building2,
  MessageSquare,
  Sparkles,
  X,
  Atom,
  Zap,
} from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { useNeedsOnboarding } from "@/hooks/useNeedsOnboarding";
import { AI_OPERATION_COSTS } from "@/lib/billing/ai-operation-costs";
import { hasSeenOnboarding, markOnboardingSeen } from "@/lib/onboarding/storage";
import { safeNavigate } from "@/lib/navigation/safe-navigate";
import { cn } from "@/lib/utils";

const CREDIT_BREAKDOWN = [
  {
    key: "chat",
    icon: MessageSquare,
    emoji: "💬",
    title: "AI Lab Assistant",
    detail: `${AI_OPERATION_COSTS.AI_CHAT_QUERY} Credit / Query`,
  },
  {
    key: "atom",
    icon: Atom,
    emoji: "⚛️",
    title: "Atom/Molecule Model",
    detail: `${AI_OPERATION_COSTS.ATOM_GENERATE} Credits`,
  },
  {
    key: "arch",
    icon: Building2,
    emoji: "🏛️",
    title: "Standard Architecture Render",
    detail: `${AI_OPERATION_COSTS.ARCH_RENDER_STD} Credits`,
  },
  {
    key: "hd",
    icon: Sparkles,
    emoji: "🌟",
    title: "Ultra HD 4K Render",
    detail: `${AI_OPERATION_COSTS.ARCH_RENDER_HD} Credits`,
  },
] as const;

/** Home + dashboard are the primary first-paint surfaces for welcome. */
function isOnboardingSurface(pathname: string | null): boolean {
  if (!pathname) return false;
  return pathname === "/" || pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

export function WelcomeModal() {
  const router = useRouter();
  const pathname = usePathname();
  const { ui, isWhiteLab } = useTheme();
  const { ready, needsOnboarding, userId } = useNeedsOnboarding();
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    setAcknowledged(false);
  }, [userId]);

  useEffect(() => {
    if (!ready || !userId || acknowledged || !isOnboardingSurface(pathname)) {
      setOpen(false);
      return;
    }
    if (!needsOnboarding || hasSeenOnboarding(userId)) {
      setOpen(false);
      return;
    }
    setOpen(true);
  }, [ready, needsOnboarding, userId, pathname, acknowledged]);

  const dismiss = useCallback(() => {
    if (userId) markOnboardingSeen(userId);
    setAcknowledged(true);
    setOpen(false);
  }, [userId]);

  const startExploring = useCallback(() => {
    dismiss();
    safeNavigate(router, "/explore");
  }, [dismiss, router]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };
    document.addEventListener("keydown", onKeyDown);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = prev;
    };
  }, [open, dismiss]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close welcome dialog"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.28 }}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-md"
            onClick={dismiss}
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="welcome-modal-title"
            initial={{ opacity: 0, y: 24, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.97 }}
            transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "fixed left-1/2 top-1/2 z-[101] w-[min(100vw-1.25rem,34rem)] -translate-x-1/2 -translate-y-1/2",
              "max-h-[min(92vh,42rem)] overflow-y-auto rounded-3xl border shadow-2xl backdrop-blur-xl",
              isWhiteLab
                ? "border-teal-200/80 bg-white/95 shadow-teal-900/10"
                : "border-teal-400/25 bg-slate-900/85 shadow-[0_0_48px_rgba(45,212,191,0.14),0_24px_64px_rgba(0,0,0,0.55)]",
            )}
          >
            <div
              className={cn(
                "pointer-events-none absolute inset-0 rounded-3xl opacity-90",
                isWhiteLab
                  ? "bg-gradient-to-br from-teal-50/80 via-transparent to-cyan-50/40"
                  : "bg-gradient-to-br from-teal-500/10 via-transparent to-emerald-500/5",
              )}
              aria-hidden
            />

            <div className="relative border-b border-teal-400/15 px-5 pb-5 pt-6 sm:px-7 sm:pt-7">
              <button
                type="button"
                onClick={dismiss}
                className={cn(
                  "absolute right-4 top-4 rounded-lg p-1.5 transition-colors sm:right-5 sm:top-5",
                  ui.controls.iconButton,
                  isWhiteLab ? "hover:bg-slate-100" : "hover:bg-white/10",
                )}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex items-start gap-3 pr-10">
                <div
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border text-2xl",
                    isWhiteLab
                      ? "border-teal-200/80 bg-teal-50"
                      : "border-teal-400/40 bg-teal-500/15 shadow-[0_0_28px_rgba(45,212,191,0.28)]",
                  )}
                  aria-hidden
                >
                  🧪
                </div>
                <div>
                  <h2
                    id="welcome-modal-title"
                    className={cn(
                      "font-display text-xl font-bold tracking-tight sm:text-2xl",
                      ui.typography.title,
                    )}
                  >
                    Welcome to MoleculeStudio! 🧪
                  </h2>
                  <p
                    className={cn(
                      "mt-2 text-sm leading-relaxed sm:text-[0.95rem]",
                      ui.typography.subtitle,
                    )}
                  >
                    We&apos;ve gifted you{" "}
                    <strong
                      className={cn(
                        "font-semibold",
                        isWhiteLab ? "text-teal-800" : "text-teal-200",
                      )}
                    >
                      10 Free Welcome Credits
                    </strong>{" "}
                    to explore the universe of 3D molecular architecture.
                  </p>
                </div>
              </div>
            </div>

            <div className="relative px-5 py-5 sm:px-7 sm:py-6">
              <p
                className={cn(
                  "mb-3 text-[11px] font-semibold uppercase tracking-[0.14em]",
                  ui.typography.muted,
                )}
              >
                Credit usage guide
              </p>

              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {CREDIT_BREAKDOWN.map((item, index) => {
                  const Icon = item.icon;
                  return (
                    <motion.div
                      key={item.key}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.08 + index * 0.05, duration: 0.28 }}
                      className={cn(
                        "flex items-start gap-3 rounded-2xl border px-3.5 py-3 backdrop-blur-md",
                        isWhiteLab
                          ? "border-slate-200 bg-white/90"
                          : "border-white/10 bg-slate-950/40",
                      )}
                    >
                      <div
                        className={cn(
                          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border text-base",
                          isWhiteLab
                            ? "border-teal-200/70 bg-teal-50 text-teal-700"
                            : "border-teal-400/30 bg-teal-500/10 text-teal-200",
                        )}
                        aria-hidden
                      >
                        <span className="sm:hidden">{item.emoji}</span>
                        <Icon className="hidden h-4 w-4 sm:block" />
                      </div>
                      <div className="min-w-0">
                        <p className={cn("text-sm font-semibold", ui.typography.title)}>
                          <span className="mr-1 sm:hidden" aria-hidden>
                            {item.emoji}
                          </span>
                          {item.title}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 text-xs font-medium",
                            isWhiteLab ? "text-teal-700" : "text-teal-300/90",
                          )}
                        >
                          {item.detail}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={startExploring}
                className={cn(
                  "mt-6 inline-flex w-full items-center justify-center gap-2 rounded-full border px-5 py-3.5 text-sm font-semibold transition-all active:scale-[0.99]",
                  isWhiteLab
                    ? "border-teal-500 bg-teal-600 text-white shadow-md shadow-teal-900/15 hover:bg-teal-500"
                    : "border-teal-400/50 bg-gradient-to-r from-teal-500/25 to-emerald-500/20 text-teal-50 shadow-[0_0_28px_rgba(45,212,191,0.28)] hover:border-teal-300/70 hover:from-teal-400/35 hover:to-emerald-400/30",
                )}
              >
                <Zap className="h-4 w-4 shrink-0" />
                Start Exploring (10 Credits Ready) →
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
