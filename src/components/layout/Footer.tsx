"use client";

import Link from "next/link";
import { Atom, ExternalLink } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { formatMessage } from "@/lib/i18n/localize";
import { cn } from "@/lib/utils";

export function Footer() {
  const { t } = useLanguage();
  const { ui } = useTheme();
  const year = new Date().getFullYear();

  const productLinks = [
    { label: t.footer_canvas_guide, href: "/explore", external: false as const },
    { label: t.nav_learn, href: "/learn", external: false as const },
    { label: t.nav_showcase, href: "/showcase", external: false as const },
  ];

  const resourceLinks = [
    { label: t.footer_about, href: "/", external: false as const },
    { label: t.footer_github, href: "https://github.com", external: true as const },
  ];

  return (
    <footer
      className={cn("mt-auto w-full border-t transition-colors duration-500", ui.footer)}
      role="contentinfo"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-8 px-6 py-8 md:flex-row md:items-start md:justify-between md:gap-6 md:py-9">
        <div className="flex min-w-0 flex-col gap-2">
          <Link href="/" className={cn("group inline-flex w-fit items-center gap-2 transition-colors", ui.nav.brand)}>
            <Atom
              className={cn(
                "h-4 w-4 transition-colors",
                ui.typography.iconAccent,
                "group-hover:opacity-90",
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

        <div className="flex flex-col gap-6 sm:flex-row sm:gap-10 md:items-start">
          <nav className="flex flex-col gap-2" aria-label={t.aria_footer}>
            <p className={cn("text-[10px] uppercase tracking-widest", ui.typography.muted)}>
              {t.nav_explore}
            </p>
            <div className="flex flex-col gap-2 text-xs font-medium">
              {productLinks.map(({ label, href }) => (
                <Link key={href} href={href} className={ui.nav.link}>
                  {label}
                </Link>
              ))}
            </div>
          </nav>

          <nav className="flex flex-col gap-2" aria-label={t.nav_resources ?? "Resources"}>
            <p className={cn("text-[10px] uppercase tracking-widest", ui.typography.muted)}>
              {t.nav_resources ?? "Resources"}
            </p>
            <div className="flex flex-col gap-2 text-xs font-medium">
              {resourceLinks.map(({ label, href, external }) =>
                external ? (
                  <a
                    key={href}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={cn("inline-flex items-center gap-1 transition-colors", ui.nav.link)}
                  >
                    {label}
                    <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
                  </a>
                ) : (
                  <Link key={href} href={href} className={ui.nav.link}>
                    {label}
                  </Link>
                ),
              )}
            </div>
          </nav>
        </div>
      </div>
    </footer>
  );
}
