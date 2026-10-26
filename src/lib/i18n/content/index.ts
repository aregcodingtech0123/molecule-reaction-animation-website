import type { Locale } from "../types";
import en from "./en.json";

export interface MoleculeContentI18n {
  name: string;
  description: string;
  category: string;
  disciplineTag: string | null;
  bondTypes: string[];
  uses: string[];
  funFacts: string[];
}

export interface ReactionSpeciesI18n {
  name: string;
  formula?: string;
  count?: number;
}

export interface ReactionContentI18n {
  name: string;
  description: string;
  reactionType: string;
  category: string;
  reactants: ReactionSpeciesI18n[];
  products: ReactionSpeciesI18n[];
  quickFacts: {
    summary: string;
    energyProfile?: string;
    conditions?: string;
    mechanism?: string;
    highlight?: string;
  };
  steps: { caption: string }[];
}

export interface LocaleContentBundle {
  molecules: Record<string, MoleculeContentI18n>;
  reactions: Record<string, ReactionContentI18n>;
  categories: Record<string, string>;
  ui: Record<string, string>;
}

/**
 * Locale content is loaded on demand (PERF-26): English is built in; each other locale is its own chunk, fetched
 * by LanguageProvider before it switches to that locale. Before, all 12 locales (~110 KiB compressed) were in
 * every route's initial load for every visitor.
 */
const LOADERS: Record<Exclude<Locale, "en">, () => Promise<{ default: unknown }>> = {
  tr: () => import("./tr.json"),
  de: () => import("./de.json"),
  es: () => import("./es.json"),
  pt: () => import("./pt.json"),
  ko: () => import("./ko.json"),
  ja: () => import("./ja.json"),
  fr: () => import("./fr.json"),
  ru: () => import("./ru.json"),
  zh: () => import("./zh.json"),
  it: () => import("./it.json"),
  hi: () => import("./hi.json"),
};

const loaded: Partial<Record<Locale, LocaleContentBundle>> = { en: en as LocaleContentBundle };

/** The locale's content if it has been loaded, otherwise English (synchronous, safe during render). */
export function getContentBundle(locale: Locale): LocaleContentBundle {
  return loaded[locale] ?? (loaded.en as LocaleContentBundle);
}

export function isContentBundleLoaded(locale: Locale): boolean {
  return loaded[locale] !== undefined;
}

/** Fetches a locale's content once; later calls resolve immediately. */
export async function loadContentBundle(locale: Locale): Promise<LocaleContentBundle> {
  const ready = loaded[locale];
  if (ready) return ready;
  const imported = await LOADERS[locale as Exclude<Locale, "en">]();
  const bundle = imported.default as LocaleContentBundle;
  loaded[locale] = bundle;
  return bundle;
}
