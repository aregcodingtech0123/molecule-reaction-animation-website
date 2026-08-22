import type { Locale } from "@/lib/i18n/types";
import type { AtomModelsLocaleBundle } from "../types";
import en from "./en";
import tr from "./tr";
import de from "./de";
import es from "./es";
import pt from "./pt";
import ko from "./ko";
import ja from "./ja";
import fr from "./fr";
import ru from "./ru";
import zh from "./zh";
import it from "./it";
import hi from "./hi";

export const ATOM_MODELS_BY_LOCALE: Record<Locale, AtomModelsLocaleBundle> = {
  en,
  tr,
  de,
  es,
  pt,
  ko,
  ja,
  fr,
  ru,
  zh,
  it,
  hi,
};

export function getAtomModelsBundle(locale: Locale): AtomModelsLocaleBundle {
  return ATOM_MODELS_BY_LOCALE[locale] ?? ATOM_MODELS_BY_LOCALE.en;
}
