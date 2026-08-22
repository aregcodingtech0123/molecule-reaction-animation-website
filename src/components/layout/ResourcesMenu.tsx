"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, ExternalLink } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

const RESOURCE_LINKS = [
  { href: "/learn", labelKey: "nav_learn" as const, external: false },
  { href: "/showcase", labelKey: "nav_showcase" as const, external: false },
  { href: "https://github.com", labelKey: "footer_github" as const, external: true },
] as const;

export function ResourcesMenu({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useLanguage();
  const { ui, isWhiteLab } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const isActive = RESOURCE_LINKS.some(
    (link) => !link.external && (pathname === link.href || pathname.startsWith(`${link.href}/`)),
  );

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) close();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.nav_resources ?? "Resources"}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          "inline-flex items-center gap-1 transition-colors",
          isActive ? ui.nav.linkActive : cn(ui.nav.link, "[@media(hover:hover)]:hover:text-white"),
        )}
      >
        {t.nav_resources ?? "Resources"}
        <ChevronDown
          className={cn("h-3.5 w-3.5 opacity-70 transition-transform", open && "rotate-180")}
        />
      </button>

      {open && (
        <div
          role="menu"
          className={cn(
            "absolute left-0 top-[calc(100%+0.5rem)] z-[60] min-w-[12rem] rounded-lg border py-1 shadow-xl",
            isWhiteLab
              ? "border-slate-200 bg-white shadow-slate-200/40"
              : "border-white/10 bg-neutral-950/98 shadow-black/50 backdrop-blur-xl",
          )}
        >
          {RESOURCE_LINKS.map((link) => {
            const label = t[link.labelKey] ?? link.labelKey;
            const active = !link.external && pathname === link.href;

            if (link.external) {
              return (
                <a
                  key={link.href}
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  role="menuitem"
                  onClick={() => {
                    close();
                    onNavigate?.();
                  }}
                  className={cn(
                    "flex items-center justify-between gap-3 px-3 py-2.5 text-sm transition-colors",
                    ui.nav.link,
                    isWhiteLab ? "hover:bg-slate-50" : "hover:bg-white/5",
                  )}
                >
                  {label}
                  <ExternalLink className="h-3.5 w-3.5 opacity-50" aria-hidden />
                </a>
              );
            }

            return (
              <Link
                key={link.href}
                href={link.href}
                role="menuitem"
                onClick={() => {
                  close();
                  onNavigate?.();
                }}
                className={cn(
                  "block px-3 py-2.5 text-sm transition-colors",
                  active
                    ? cn(ui.nav.linkActive, isWhiteLab ? "bg-slate-50" : "bg-white/5")
                    : cn(ui.nav.link, isWhiteLab ? "hover:bg-slate-50" : "hover:bg-white/5"),
                )}
              >
                {label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ResourcesMobileLinks({
  pathname,
  ui,
  t,
  onNavigate,
}: {
  pathname: string;
  ui: ReturnType<typeof useTheme>["ui"];
  t: ReturnType<typeof useLanguage>["t"];
  onNavigate: () => void;
}) {
  const { isWhiteLab } = useTheme();

  return (
    <div className="space-y-1">
      <p className={cn("text-[10px] uppercase tracking-widest px-3 py-1", ui.typography.muted)}>
        {t.nav_resources ?? "Resources"}
      </p>
      {RESOURCE_LINKS.map((link) => {
        const label = t[link.labelKey] ?? link.labelKey;
        const active = !link.external && pathname === link.href;

        if (link.external) {
          return (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              onClick={onNavigate}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-all",
                ui.nav.link,
                isWhiteLab ? "hover:bg-slate-50" : "hover:bg-white/5",
              )}
            >
              {label}
              <ExternalLink className="h-4 w-4 opacity-50" aria-hidden />
            </a>
          );
        }

        return (
          <Link
            key={link.href}
            href={link.href}
            onClick={onNavigate}
            className={cn(
              "block rounded-xl px-3 py-3 text-sm font-medium transition-all",
              active
                ? cn(ui.nav.linkActive, isWhiteLab ? "bg-slate-100" : "bg-white/5")
                : cn(ui.nav.link, isWhiteLab ? "hover:bg-slate-50" : "hover:bg-white/5"),
            )}
          >
            {label}
          </Link>
        );
      })}
    </div>
  );
}
