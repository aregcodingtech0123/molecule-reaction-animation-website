import type { Locale } from "./types";
import ACCOUNT_UI_TRANSLATIONS from "./content/account-ui.json";

/**
 * Auth, billing, dashboard and profile strings for the non-English locales
 * (FINDING-27). English lives in ui-extensions.ts; these were missing in all
 * 11 other locales, which fell back to inline English defaults.
 *
 * Machine-translated — pending native-speaker review: docs/testing/I18N_REVIEW.md.
 */
export type NonSourceLocale = Exclude<Locale, "en">;

export const ACCOUNT_UI: Record<NonSourceLocale, Record<string, string>> = ACCOUNT_UI_TRANSLATIONS;

export function getAccountUi(locale: Locale): Record<string, string> {
  return locale === "en" ? {} : ACCOUNT_UI[locale];
}
