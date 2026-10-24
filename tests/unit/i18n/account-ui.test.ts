/**
 * FINDING-27: the account UI (auth, billing, dashboard, profile) is translated in
 * every locale, and docs/testing/I18N_REVIEW.md lists every added string for
 * native-speaker review. Regenerate the review file after changing translations:
 *   I18N_REVIEW_UPDATE=1 npx vitest run tests/unit/i18n/account-ui.test.ts
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_UI, type NonSourceLocale } from "@/lib/i18n/account-ui";
import { LANGUAGE_OPTIONS } from "@/lib/i18n/languages";
import { getDictionary } from "@/lib/i18n/localize";
import { LOCALES } from "@/lib/i18n/types";

const en = getDictionary("en");
const OTHERS = LOCALES.filter((l): l is NonSourceLocale => l !== "en");
const KEYS = Object.keys(ACCOUNT_UI.tr).sort();
const REVIEW_PATH = path.join(process.cwd(), "docs/testing/I18N_REVIEW.md");

/** Reviewed: the correct translation is spelled exactly like the English source. */
const SAME_AS_ENGLISH: Partial<Record<NonSourceLocale, string[]>> = {
  de: ["auth_credits_label"], // "Credits" is the usual German UI term
  fr: ["dashboard_col_date", "dashboard_col_description", "dashboard_col_type"],
  it: ["auth_email_label", "auth_password_label"],
};

/** At least one character of the locale's own script (catches an English value pasted by mistake). */
const NATIVE_SCRIPT: Partial<Record<NonSourceLocale, RegExp>> = {
  ru: /[Ѐ-ӿ]/,
  ja: /[぀-ヿ一-鿿]/,
  zh: /[一-鿿]/,
  ko: /[가-힯]/,
  hi: /[ऀ-ॿ]/,
};

const placeholders = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort();

function reviewMarkdown(): string {
  const name = (code: string) => LANGUAGE_OPTIONS.find((o) => o.code === code)?.nativeName ?? code;
  const cell = (s: string) => s.replace(/\|/g, "\\|");
  const lines = [
    "# I18N review — account UI strings (FINDING-27)",
    "",
    "> **Machine-translated.** Every string below was added in Phase 1.5 and has **not** been reviewed by",
    "> a native speaker. Please check meaning, tone and length (buttons and table headers must stay short).",
    "> Brand and product names are intentionally untranslated: MoleculeStudio, AI Lab, Lemon Squeezy, MoR",
    "> (merchant of record), USD, Google.",
    "",
    "Source of truth: `src/lib/i18n/content/account-ui.json` (English: `src/lib/i18n/ui-extensions.ts`).",
    "This file is generated and checked by `tests/unit/i18n/account-ui.test.ts`; after editing a translation run",
    "`I18N_REVIEW_UPDATE=1 npx vitest run tests/unit/i18n/account-ui.test.ts`.",
    "",
    `${KEYS.length} keys × ${OTHERS.length} locales = ${KEYS.length * OTHERS.length} strings` +
      " (the 83 keys of FINDING-27 plus `dashboard_load_more`, added with the dashboard pagination of FINDING-17).",
    "",
    "Kept identical to English after review: " +
      Object.entries(SAME_AS_ENGLISH)
        .map(([l, keys]) => `${l}: ${keys!.map((k) => `\`${k}\``).join(", ")}`)
        .join("; ") +
      ".",
    "",
    "To correct a string, edit `account-ui.json` and regenerate this file; record the reviewer per locale in the PR.",
    "",
    "Out of scope (open, not part of FINDING-27): other UI groups (AI Lab, toasts, measurement and atom-focus",
    "labels, studio CTA cards) exist in every locale but still show the English text in most of them.",
  ];
  for (const locale of OTHERS) {
    lines.push("", `## ${locale} — ${name(locale)}`, "", "| Key | English | Translation |", "| --- | --- | --- |");
    for (const key of KEYS) lines.push(`| \`${key}\` | ${cell(en[key]!)} | ${cell(ACCOUNT_UI[locale][key]!)} |`);
  }
  return lines.join("\n") + "\n";
}

describe("account UI translations (FINDING-27)", () => {
  it("covers the 83 previously missing keys plus dashboard_load_more, all known to English", () => {
    expect(KEYS).toHaveLength(84);
    expect(KEYS.filter((k) => !(k in en))).toEqual([]);
    expect(KEYS).toContain("dashboard_load_more");
  });

  it.each(OTHERS)("%s has exactly the same keys", (locale) => {
    expect(Object.keys(ACCOUNT_UI[locale]).sort()).toEqual(KEYS);
  });

  it.each(OTHERS)("%s values are non-empty, trimmed, keep every placeholder, and are what the UI shows", (locale) => {
    const dict = getDictionary(locale);
    for (const key of KEYS) {
      const value = ACCOUNT_UI[locale][key]!;
      expect(value.trim(), `${locale}.${key}`).toBe(value);
      expect(value.length, `${locale}.${key}`).toBeGreaterThan(0);
      expect(placeholders(value), `${locale}.${key}`).toEqual(placeholders(en[key]!));
      expect(dict[key], `${locale}.${key}`).toBe(value);
    }
  });

  it.each(OTHERS)("%s is translated, not an English copy (except reviewed identical terms)", (locale) => {
    const same = KEYS.filter((k) => ACCOUNT_UI[locale][k] === en[k]);
    expect(same).toEqual(SAME_AS_ENGLISH[locale] ?? []);
  });

  it.each(Object.keys(NATIVE_SCRIPT) as NonSourceLocale[])("%s strings are written in the locale's script", (locale) => {
    const latinOnly = KEYS.filter((k) => !NATIVE_SCRIPT[locale]!.test(ACCOUNT_UI[locale][k]!));
    expect(latinOnly).toEqual([]);
  });

  it("docs/testing/I18N_REVIEW.md lists every added string per locale and is up to date", () => {
    const expected = reviewMarkdown();
    if (process.env.I18N_REVIEW_UPDATE === "1") fs.writeFileSync(REVIEW_PATH, expected, "utf8");
    const actual = fs.existsSync(REVIEW_PATH) ? fs.readFileSync(REVIEW_PATH, "utf8").replace(/\r\n/g, "\n") : "";
    expect(actual).toBe(expected);
  });
});
