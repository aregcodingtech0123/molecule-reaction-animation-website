"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Globe, Check } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/languages";
import type { Locale } from "@/lib/i18n/types";
import { cn } from "@/lib/utils";

export function LanguageSelector({ compact }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLanguage();
  const { isWhiteLab } = useTheme();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const current = LANGUAGE_OPTIONS.find((l) => l.code === locale);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, close]);

  const select = (code: Locale) => {
    setLocale(code);
    close();
  };

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t.aria_select_language}
        className={cn(
          "flex items-center gap-1.5 rounded-full border transition-all duration-200 cursor-pointer",
          isWhiteLab
            ? "border-slate-300 bg-white text-neutral-800 hover:border-slate-400 hover:bg-slate-50 hover:text-neutral-900 shadow-sm"
            : "border-white/10 bg-white/5 text-gray-300 hover:border-white/20 hover:bg-white/10 hover:text-white",
          compact ? "px-2.5 py-1.5 text-[11px]" : "px-3 py-1.5 text-xs font-medium",
        )}
      >
        <Globe
          className={cn(
            isWhiteLab ? "text-indigo-700" : "text-indigo-400/90",
            compact ? "h-3.5 w-3.5" : "h-4 w-4",
          )}
        />
        <span
          className={cn(
            "uppercase tracking-wider text-[10px] font-semibold",
            isWhiteLab ? "text-neutral-900" : "text-gray-200",
          )}
        >
          {locale}
        </span>
        {!compact && current && (
          <span
            className={cn(
              "hidden lg:inline max-w-[5rem] truncate",
              isWhiteLab ? "text-neutral-600" : "text-gray-500",
            )}
          >
            {current.nativeName}
          </span>
        )}
      </button>

      {open && (
        <ul
          role="listbox"
          aria-label={t.aria_languages}
          className={cn(
            "absolute right-0 top-[calc(100%+0.5rem)] z-[60] min-w-[11rem]",
            "max-h-[min(20rem,70vh)] overflow-y-auto rounded-xl py-1 shadow-xl backdrop-blur-md",
            isWhiteLab
              ? "border border-slate-200 bg-white/95"
              : "border border-neutral-800 bg-neutral-950/95",
          )}
        >
          {LANGUAGE_OPTIONS.map(({ code, nativeName }) => {
            const active = code === locale;
            return (
              <li key={code} role="option" aria-selected={active}>
                <button
                  type="button"
                  onClick={() => select(code)}
                  className={cn(
                    "flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left text-sm",
                    "transition-colors duration-200",
                    active
                      ? isWhiteLab
                        ? "bg-indigo-100 text-neutral-900 font-semibold"
                        : "bg-indigo-500/15 text-white"
                      : isWhiteLab
                        ? "text-neutral-700 hover:bg-slate-100 hover:text-neutral-900"
                        : "text-gray-400 hover:bg-neutral-800/60 hover:text-gray-100",
                  )}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={cn(
                        "w-7 text-[10px] font-bold uppercase tracking-wider",
                        isWhiteLab ? "text-neutral-600" : "text-gray-500",
                      )}
                    >
                      {code}
                    </span>
                    <span className="truncate">{nativeName}</span>
                  </span>
                  {active && (
                    <Check
                      className={cn(
                        "h-3.5 w-3.5 flex-shrink-0",
                        isWhiteLab ? "text-indigo-700" : "text-indigo-400",
                      )}
                    />
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
