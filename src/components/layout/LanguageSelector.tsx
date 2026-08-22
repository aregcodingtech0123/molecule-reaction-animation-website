"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Globe, Check } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/languages";
import type { Locale } from "@/lib/i18n/types";
import { cn } from "@/lib/utils";

interface MenuPosition {
  top: number;
  left: number;
  minWidth: number;
}

export function LanguageSelector({ compact }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLanguage();
  const { isWhiteLab } = useTheme();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<MenuPosition | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLUListElement>(null);

  const current = LANGUAGE_OPTIONS.find((l) => l.code === locale);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    setMounted(true);
  }, []);

  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const menuWidth = Math.max(rect.width, 176);
    const gap = 8;
    const padding = 12;

    let left = rect.right - menuWidth;
    left = Math.max(padding, Math.min(left, window.innerWidth - menuWidth - padding));

    const spaceBelow = window.innerHeight - rect.bottom - gap;
    const preferBelow = spaceBelow >= 160 || spaceBelow >= rect.top;
    const top = preferBelow ? rect.bottom + gap : Math.max(padding, rect.top - gap);

    setPosition({
      top,
      left,
      minWidth: menuWidth,
    });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target)) return;
      if (menuRef.current?.contains(target)) return;
      close();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };

    const onReposition = () => updatePosition();

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open, close, updatePosition]);

  const select = (code: Locale) => {
    setLocale(code);
    close();
  };

  return (
    <div className="relative flex-shrink-0">
      <button
        ref={triggerRef}
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

      {mounted &&
        createPortal(
          <AnimatePresence>
            {open && position && (
              <motion.ul
                key="language-menu"
                ref={menuRef}
                role="listbox"
                aria-label={t.aria_languages}
                initial={{ opacity: 0, y: -6, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -4, scale: 0.98 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                style={{
                  position: "fixed",
                  top: position.top,
                  left: position.left,
                  minWidth: position.minWidth,
                  zIndex: 200,
                }}
                className={cn(
                  "max-h-[min(20rem,70vh)] overflow-y-auto rounded-xl py-1 shadow-2xl backdrop-blur-md",
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
                              ? "bg-indigo-100 font-semibold text-neutral-900"
                              : "bg-indigo-500/15 text-white"
                            : isWhiteLab
                              ? "text-neutral-700 hover:bg-slate-100 hover:text-neutral-900"
                              : "text-gray-400 hover:bg-neutral-800/60 hover:text-gray-100",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
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
              </motion.ul>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  );
}
