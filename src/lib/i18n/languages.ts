import type { LanguageOption, Locale } from "./types";

export const LANGUAGE_OPTIONS: LanguageOption[] = [
  { code: "en", nativeName: "English" },
  { code: "tr", nativeName: "Türkçe" },
  { code: "de", nativeName: "Deutsch" },
  { code: "es", nativeName: "Español" },
  { code: "pt", nativeName: "Português" },
  { code: "ko", nativeName: "한국어" },
  { code: "ja", nativeName: "日本語" },
  { code: "fr", nativeName: "Français" },
  { code: "ru", nativeName: "Русский" },
  { code: "zh", nativeName: "汉语" },
  { code: "it", nativeName: "Italiano" },
  { code: "hi", nativeName: "हिन्दी" },
];

export function isLocale(value: string): value is Locale {
  return LANGUAGE_OPTIONS.some((l) => l.code === value);
}

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_STORAGE_KEY = "moleculestudio-locale";
