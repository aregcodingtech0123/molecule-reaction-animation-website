"use client";

import Link from "next/link";
import { Atom, ExternalLink } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { formatMessage } from "@/lib/i18n/localize";
import { cn } from "@/lib/utils";

export function Footer() {
  const { t } = useLanguage();
  const { ui, isWhiteLab } = useTheme();
  const year = new Date().getFullYear();

  const links = [
    { label: t.footer_about, href: "/", external: false as const },
    { label: t.footer_github, href: "https://github.com", external: true as const },
    { label: t.footer_canvas_guide, href: "/explore", external: false as const },
  ];

  return (
    <footer
      className={cn("mt-auto w-full border-t transition-colors duration-500", ui.footer)}
      role="contentinfo"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-8 md:flex-row md:items-center md:justify-between md:gap-6 md:py-9">
        <div className="flex min-w-0 flex-col gap-2">
          <Link
            href="/"
            className={cn(
              "group inline-flex w-fit items-center gap-2 transition-colors",
              isWhiteLab ? "hover:text-indigo-800" : "hover:text-white",
            )}
          >
            <Atom
              className={cn(
                "h-4 w-4 transition-colors",
                isWhiteLab
                  ? "text-indigo-700 group-hover:text-indigo-800"
                  : "text-indigo-400/90 group-hover:text-indigo-300",
              )}
            />
            <span className={cn("text-sm font-semibold tracking-wide", ui.typography.title)}>
              {t.footer_brand}
            </span>
          </Link>
          <p className={cn("text-xs", ui.typography.muted)}>
            {formatMessage(t.footer_copyright, { year })}
          </p>
        </div>

        <div className="flex flex-col gap-5 sm:items-end md:items-end">
          <nav
            className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs font-medium"
            aria-label={t.aria_footer}
          >
            {links.map(({ label, href, external }) =>
              external ? (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn("inline-flex items-center gap-1 transition-colors", ui.nav.link)}
                >
                  {label}
                  <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
                </a>
              ) : (
                <Link
                  key={label}
                  href={href}
                  className={ui.nav.link}
                >
                  {label}
                </Link>
              ),
            )}
          </nav>

          <p
            className={cn(
              "rounded-full border px-3 py-1 text-[10px] font-medium tracking-wide",
              isWhiteLab
                ? "border-slate-200 bg-slate-100 text-neutral-700"
                : "border-neutral-800/80 bg-neutral-900/40 text-neutral-600",
            )}
          >
            {t.footer_tech_badge}
          </p>
        </div>
      </div>
    </footer>
  );
}
