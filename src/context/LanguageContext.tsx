"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { getDictionary } from "@/lib/i18n/localize";
import { loadContentBundle } from "@/lib/i18n/content";
import {
  DEFAULT_LOCALE,
  isLocale,
  LOCALE_STORAGE_KEY,
} from "@/lib/i18n/languages";
import type { Locale, TranslationDictionary } from "@/lib/i18n/types";

interface LanguageContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: TranslationDictionary;
  /** Shorthand for `t[key]` */
  translate: (key: string) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

function readStoredLocale(): Locale {
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return stored && isLocale(stored) ? stored : DEFAULT_LOCALE;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  /** Match SSR defaults on first render to avoid hydration mismatch. */
  const [locale, setLocaleState] = useState<Locale>(DEFAULT_LOCALE);
  const latestRequest = useRef(0);

  /**
   * Switches once the locale's content has loaded (PERF-26: only English is built in), so a page never shows a
   * mix of the new UI strings and English content. If loading fails the switch still happens and content falls
   * back to English. Only the most recent request applies when several are in flight.
   */
  const applyLocale = useCallback((next: Locale) => {
    const request = ++latestRequest.current;
    const apply = () => {
      if (request !== latestRequest.current) return;
      setLocaleState(next);
      document.documentElement.lang = next;
    };
    loadContentBundle(next).then(apply, apply);
  }, []);

  useEffect(() => {
    applyLocale(readStoredLocale());
  }, [applyLocale]);

  const setLocale = useCallback(
    (next: Locale) => {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, next);
      applyLocale(next);
    },
    [applyLocale],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const t = useMemo(() => getDictionary(locale), [locale]);

  const translate = useCallback((key: string) => t[key] ?? key, [t]);

  const value = useMemo(
    () => ({ locale, setLocale, t, translate }),
    [locale, setLocale, t, translate],
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useLanguage must be used within LanguageProvider");
  }
  return ctx;
}
