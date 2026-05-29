export const LOCALES = [
  "en",
  "tr",
  "de",
  "es",
  "pt",
  "ko",
  "ja",
  "fr",
  "ru",
  "zh",
  "it",
  "hi",
] as const;

export type Locale = (typeof LOCALES)[number];

/** All UI string keys (from locale JSON `ui` + extensions) */
export type TranslationDictionary = Record<string, string>;

export type TranslationKey = string;

export interface LanguageOption {
  code: Locale;
  nativeName: string;
}
