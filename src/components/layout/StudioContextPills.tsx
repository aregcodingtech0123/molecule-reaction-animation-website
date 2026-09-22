"use client";

import Link from "next/link";
import { BookOpen, Grid3X3 } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

/**
 * Compact glassmorphic pills for Explore / AI Lab headers — routes to
 * Periodic Table and Learn without crowding the main Navbar.
 */
export function StudioContextPills({ className }: { className?: string }) {
  const { t } = useLanguage();
  const { isWhiteLab } = useTheme();

  const pills = [
    {
      href: "/periodic-table",
      label: t.cta_periodic_table ?? "Interactive Periodic Table 🧪",
      icon: Grid3X3,
      primary: true,
    },
    {
      href: "/learn",
      label: t.cta_learn_theory ?? "Learn & Theory 📚",
      icon: BookOpen,
      primary: false,
    },
  ] as const;

  return (
    <nav
      aria-label={t.cta_studio_context ?? "Studio resources"}
      className={cn("flex flex-wrap items-center gap-2", className)}
    >
      {pills.map((pill) => {
        const Icon = pill.icon;
        return (
          <Link
            key={pill.href}
            href={pill.href}
            className={cn(
              "inline-flex max-w-full items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold whitespace-nowrap transition-all sm:text-xs",
              "active:scale-[0.98]",
              pill.primary
                ? isWhiteLab
                  ? "border-teal-300/90 bg-teal-50 text-teal-900 shadow-sm hover:bg-teal-100 hover:shadow-[0_0_18px_rgba(13,148,136,0.2)]"
                  : "border-teal-400/45 bg-teal-500/15 text-teal-100 shadow-[0_0_18px_rgba(45,212,191,0.22)] hover:border-teal-300/60 hover:bg-teal-500/25"
                : isWhiteLab
                  ? "border-slate-200 bg-white/90 text-neutral-800 hover:border-teal-300/70 hover:bg-teal-50/80"
                  : "border-white/12 bg-white/5 text-gray-200 backdrop-blur-md hover:border-teal-400/35 hover:bg-teal-500/10 hover:text-teal-100",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0 opacity-90" aria-hidden />
            <span className="truncate">{pill.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
