"use client";

import Link from "next/link";
import { Atom, ExternalLink } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { formatMessage } from "@/lib/i18n/localize";
import { cn } from "@/lib/utils";

type FooterLink = {
  label: string;
  href: string;
  external?: boolean;
};

export function Footer() {
  const { t } = useLanguage();
  const { ui } = useTheme();
  const year = new Date().getFullYear();

  const productLinks: FooterLink[] = [
    { label: t.nav_ai_lab ?? "AI Lab", href: "/ai-lab" },
    { label: t.nav_explore, href: "/explore" },
    { label: t.nav_atom_models ?? "Atom Models", href: "/atom-models" },
    { label: t.nav_pricing ?? "Pricing", href: "/pricing" },
  ];

  const resourceLinks: FooterLink[] = [
    { label: t.nav_learn, href: "/learn" },
    { label: t.nav_showcase, href: "/showcase" },
    { label: t.nav_periodic_table ?? "Periodic Table", href: "/periodic-table" },
    { label: t.footer_canvas_guide, href: "/explore" },
  ];

  const accountLinks: FooterLink[] = [
    { label: t.nav_profile ?? "Profile", href: "/profile" },
    { label: t.nav_dashboard ?? "Dashboard", href: "/dashboard" },
    { label: t.nav_pricing ?? "Pricing", href: "/pricing" },
  ];

  const companyLinks: FooterLink[] = [
    { label: t.footer_about, href: "/" },
    { label: t.footer_github, href: "https://github.com", external: true },
  ];

  const columns: { title: string; links: FooterLink[] }[] = [
    { title: t.footer_col_product ?? "Product", links: productLinks },
    { title: t.footer_col_resources ?? "Resources", links: resourceLinks },
    { title: t.footer_col_account ?? "Account", links: accountLinks },
    { title: t.footer_col_company ?? "Company", links: companyLinks },
  ];

  return (
    <footer
      className={cn("mt-auto w-full border-t transition-colors duration-500", ui.footer)}
      role="contentinfo"
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-10 px-4 py-8 sm:px-6 md:py-10">
        <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:justify-between lg:gap-12">
          <div className="flex min-w-0 max-w-xs flex-col gap-2">
            <Link
              href="/"
              className={cn("group inline-flex w-fit items-center gap-2 transition-colors", ui.nav.brand)}
            >
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
            <p className={cn("text-xs leading-relaxed", ui.typography.muted)}>
              {formatMessage(t.footer_copyright, { year })}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-4 sm:gap-x-6 md:gap-x-10">
            {columns.map((column) => (
              <nav key={column.title} className="flex min-w-0 flex-col gap-2.5" aria-label={column.title}>
                <p className={cn("text-[10px] font-semibold uppercase tracking-widest", ui.typography.muted)}>
                  {column.title}
                </p>
                <div className="flex flex-col gap-2 text-xs font-medium">
                  {column.links.map(({ label, href, external }) =>
                    external ? (
                      <a
                        key={`${column.title}-${href}`}
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(
                          "inline-flex items-center gap-1 whitespace-nowrap transition-colors",
                          ui.nav.link,
                        )}
                      >
                        {label}
                        <ExternalLink className="h-3 w-3 shrink-0 opacity-60" aria-hidden />
                      </a>
                    ) : (
                      <Link
                        key={`${column.title}-${href}-${label}`}
                        href={href}
                        className={cn("whitespace-nowrap transition-colors", ui.nav.link)}
                      >
                        {label}
                      </Link>
                    ),
                  )}
                </div>
              </nav>
            ))}
          </div>
        </div>
      </div>
    </footer>
  );
}
