import type { Locale } from "../types";
import en from "./en.json";
import tr from "./tr.json";
import de from "./de.json";
import es from "./es.json";
import pt from "./pt.json";
import ko from "./ko.json";
import ja from "./ja.json";
import fr from "./fr.json";
import ru from "./ru.json";
import zh from "./zh.json";
import it from "./it.json";
import hi from "./hi.json";

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

export const CONTENT_BY_LOCALE: Record<Locale, LocaleContentBundle> = {
  en: en as LocaleContentBundle,
  tr: tr as LocaleContentBundle,
  de: de as LocaleContentBundle,
  es: es as LocaleContentBundle,
  pt: pt as LocaleContentBundle,
  ko: ko as LocaleContentBundle,
  ja: ja as LocaleContentBundle,
  fr: fr as LocaleContentBundle,
  ru: ru as LocaleContentBundle,
  zh: zh as LocaleContentBundle,
  it: it as LocaleContentBundle,
  hi: hi as LocaleContentBundle,
};

export function getContentBundle(locale: Locale): LocaleContentBundle {
  return CONTENT_BY_LOCALE[locale] ?? CONTENT_BY_LOCALE.en;
}
