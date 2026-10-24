import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CONTENT_BY_LOCALE } from "@/lib/i18n/content";
import { ATOM_MODELS_BY_LOCALE } from "@/lib/atom-models/content";
import { getUiExtensions } from "@/lib/i18n/ui-extensions";
import { formatMessage, getDictionary } from "@/lib/i18n/localize";
import { LANGUAGE_OPTIONS, LOCALE_STORAGE_KEY, isLocale } from "@/lib/i18n/languages";
import { LOCALES, type Locale } from "@/lib/i18n/types";
import { LanguageProvider, useLanguage } from "@/context/LanguageContext";

const SOURCE: Locale = "en";
const OTHERS = LOCALES.filter((l) => l !== SOURCE);

type Flat = Map<string, unknown>;
function flatten(value: unknown, prefix = "", out: Flat = new Map()): Flat {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) flatten(v, prefix ? `${prefix}.${k}` : k, out);
  } else {
    out.set(prefix, value);
  }
  return out;
}

/** Leaf paths whose empty string is an intentional "not applicable" (empty in the source locale too). */
const OPTIONAL_EMPTY = /\.quickFacts\.highlight$/;
const placeholders = (s: unknown) => (typeof s === "string" ? (s.match(/\{\w+\}/g) ?? []).sort() : []);

describe("locale registry", () => {
  it("exposes exactly 12 locales, each with a native name, and isLocale agrees", () => {
    expect(LOCALES).toHaveLength(12);
    expect(LANGUAGE_OPTIONS.map((o) => o.code)).toEqual([...LOCALES]);
    expect(LANGUAGE_OPTIONS.every((o) => o.nativeName.trim().length > 0)).toBe(true);
    expect(LOCALES.every(isLocale)).toBe(true);
    expect(isLocale("xx")).toBe(false);
  });
});

describe.each([
  ["content JSON (molecules, reactions, categories, ui)", (l: Locale) => CONTENT_BY_LOCALE[l]],
  ["atom-model bundles", (l: Locale) => ATOM_MODELS_BY_LOCALE[l]],
])("%s", (_name, bundleFor) => {
  const source = flatten(bundleFor(SOURCE));

  it.each(OTHERS)("%s has exactly the source key set", (locale) => {
    const keys = [...flatten(bundleFor(locale)).keys()].sort();
    expect(keys).toEqual([...source.keys()].sort());
  });

  it.each(LOCALES)("%s has no empty values (except intentional optional fields)", (locale) => {
    const empty = [...flatten(bundleFor(locale))].filter(([k, v]) => typeof v === "string" && !v.trim() && !OPTIONAL_EMPTY.test(k)).map(([k]) => k);
    expect(empty).toEqual([]);
  });

  it.each(OTHERS)("%s keeps every interpolation placeholder of the source", (locale) => {
    const target = flatten(bundleFor(locale));
    const mismatched = [...source].filter(([k, v]) => JSON.stringify(placeholders(v)) !== JSON.stringify(placeholders(target.get(k)))).map(([k]) => k);
    expect(mismatched).toEqual([]);
  });

  it("optional-empty fields are empty in the source too (so they are 'not applicable', not untranslated)", () => {
    for (const locale of OTHERS) {
      const target = flatten(bundleFor(locale));
      for (const [k, v] of target) {
        if (OPTIONAL_EMPTY.test(k) && typeof v === "string" && !v.trim()) expect(source.get(k)).toBe("");
      }
    }
  });
});

describe("assembled UI dictionary (JSON ui + extensions + atom-model nav)", () => {
  const sourceKeys = Object.keys(getDictionary(SOURCE)).sort();

  // FINDING-27 (Medium): 83 UI keys (auth modal, credits chip, pricing/billing, toasts …) exist only
  // in the English extension bundle; every other locale falls back to the inline English default.
  it.each(OTHERS)("%s resolves every key the English UI uses (FINDING-27)", (locale) => {
    expect(Object.keys(getDictionary(locale)).sort()).toEqual(sourceKeys);
  });

  it.each(LOCALES)("%s: every key that is present has a non-empty value", (locale) => {
    expect(Object.entries(getDictionary(locale)).filter(([, v]) => !String(v).trim())).toEqual([]);
  });

  it("no key is missing in any non-English locale (was 83 per locale, FINDING-27)", () => {
    for (const l of OTHERS) expect(sourceKeys.filter((k) => !(k in getDictionary(l)))).toEqual([]);
  });

  it.each(OTHERS)("%s locale-specific extensions do not introduce keys unknown to English", (locale) => {
    const extra = Object.keys(getUiExtensions(locale)).filter((k) => !(k in getUiExtensions(SOURCE)));
    expect(extra).toEqual([]);
  });

  it("reports (does not fail on) English strings shared verbatim by other locales — translation gap metric", () => {
    const en = getDictionary(SOURCE);
    const report = OTHERS.map((l) => {
      const d = getDictionary(l);
      const same = Object.keys(en).filter((k) => d[k] === en[k] && /[a-z]{4,}/i.test(en[k]!));
      return `${l}:${same.length}`;
    });
    // Visible in the test output for FINDINGS (i18n coverage); hard parity is enforced above.
    console.info(`[i18n] untranslated-looking UI strings per locale → ${report.join(" ")}`);
    expect(report).toHaveLength(OTHERS.length);
  });

  it("formatMessage replaces every occurrence and leaves unknown placeholders intact", () => {
    expect(formatMessage("{n} of {n} — {missing}", { n: 3 })).toBe("3 of 3 — {missing}");
  });
});

describe("language switching", () => {
  function Switcher() {
    const { locale, setLocale, t } = useLanguage();
    return (
      <>
        <span data-testid="locale">{locale}</span>
        <span data-testid="sample">{t.nav_explore}</span>
        <button onClick={() => setLocale("de")}>de</button>
      </>
    );
  }

  it("defaults to English, switches, persists to localStorage and updates <html lang>", () => {
    const { unmount } = render(
      <LanguageProvider>
        <Switcher />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
    const english = screen.getByTestId("sample").textContent;

    act(() => screen.getByRole("button", { name: "de" }).click());
    expect(screen.getByTestId("locale")).toHaveTextContent("de");
    expect(screen.getByTestId("sample").textContent).not.toBe(english);
    expect(localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("de");
    expect(document.documentElement.lang).toBe("de");
    unmount();

    // A fresh mount (page reload) restores the persisted locale.
    render(
      <LanguageProvider>
        <Switcher />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("locale")).toHaveTextContent("de");
  });

  it("ignores an invalid persisted locale", () => {
    localStorage.setItem(LOCALE_STORAGE_KEY, "klingon");
    render(
      <LanguageProvider>
        <Switcher />
      </LanguageProvider>,
    );
    expect(screen.getByTestId("locale")).toHaveTextContent("en");
  });
});
