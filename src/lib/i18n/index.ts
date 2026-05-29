export type { Locale, TranslationKey, TranslationDictionary, LanguageOption } from "./types";
export { LOCALES } from "./types";
export { LANGUAGE_OPTIONS, DEFAULT_LOCALE, LOCALE_STORAGE_KEY, isLocale } from "./languages";
export {
  getDictionary,
  formatMessage,
  translateState,
  translateDifficulty,
  translateCategoryKey,
  translateDisciplineTag,
  localizeMolecule,
  localizeReaction,
  getPhaseLabel,
  getElementName,
} from "./localize";
export { getContentBundle } from "./content";
