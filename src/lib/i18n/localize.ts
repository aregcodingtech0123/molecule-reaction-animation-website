import type { MoleculeData, MoleculeCategory } from "@/lib/molecules/types";
import type { ReactionData } from "@/lib/reactions/types";
import { getContentBundle } from "./content";
import type { Locale, TranslationDictionary } from "./types";
import { getUiExtensions } from "./ui-extensions";

const DISCIPLINE_TAG_KEYS: Record<string, string> = {
  "DAILY LIFE": "discipline_daily_life",
  MEDICINE: "discipline_medicine",
  ORGANIC: "discipline_organic",
  "ORGANIC CHEMISTRY": "discipline_organic",
  NEUROSCIENCE: "discipline_neuroscience",
  NANOTECH: "discipline_nanotech",
  BIOLOGICAL: "discipline_biological",
};

export function getDictionary(locale: Locale): TranslationDictionary {
  const bundle = getContentBundle(locale);
  return { ...bundle.ui, ...getUiExtensions(locale) } as TranslationDictionary;
}

export function formatMessage(
  template: string,
  vars: Record<string, string | number>,
): string {
  return Object.entries(vars).reduce(
    (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)),
    template,
  );
}

export function translateCategoryKey(
  categoryKey: string,
  dict: TranslationDictionary,
  locale: Locale,
): string {
  const bundle = getContentBundle(locale);
  return bundle.categories[categoryKey] ?? bundle.categories[categoryKey.toLowerCase()] ?? categoryKey;
}

export function translateDisciplineTag(
  tag: string,
  dict: TranslationDictionary,
): string {
  const key = DISCIPLINE_TAG_KEYS[tag.toUpperCase()];
  if (key && key in dict) return dict[key as keyof TranslationDictionary];
  return tag;
}

const STATE_KEY_MAP: Record<string, keyof TranslationDictionary> = {
  gas: "state_gas",
  liquid: "state_liquid",
  solid: "state_solid",
  plasma: "state_plasma",
};

const DIFFICULTY_KEY_MAP: Record<string, keyof TranslationDictionary> = {
  BEGINNER: "difficulty_beginner",
  INTERMEDIATE: "difficulty_intermediate",
  EXPERT: "difficulty_expert",
};

export function translateState(state: string, dict: TranslationDictionary): string {
  const key = STATE_KEY_MAP[state.toLowerCase()];
  return key ? dict[key] : state;
}

export function translateDifficulty(
  difficulty: string,
  dict: TranslationDictionary,
): string {
  const key = DIFFICULTY_KEY_MAP[difficulty.toUpperCase()];
  return key ? dict[key] : difficulty;
}

export function localizeMolecule(
  molecule: MoleculeData,
  locale: Locale,
): MoleculeData {
  const bundle = getContentBundle(locale);
  const overlay = bundle.molecules[molecule.id];
  if (!overlay) return molecule;

  const dict = getDictionary(locale);
  const categoryLabel = translateCategoryKey(overlay.category, dict, locale);

  return {
    ...molecule,
    name: overlay.name,
    description: overlay.description,
    category: categoryLabel as MoleculeCategory,
    disciplineTag:
      overlay.disciplineTag != null
        ? translateDisciplineTag(overlay.disciplineTag, dict)
        : undefined,
    education: molecule.education
      ? {
          ...molecule.education,
          state: molecule.education.state,
          bondTypes: overlay.bondTypes,
          uses: overlay.uses,
          funFacts: overlay.funFacts,
        }
      : undefined,
  };
}

export function localizeReaction(
  reaction: ReactionData,
  locale: Locale,
): ReactionData {
  const bundle = getContentBundle(locale);
  const overlay = bundle.reactions[reaction.id];
  if (!overlay) return reaction;

  const dict = getDictionary(locale);

  return {
    ...reaction,
    name: overlay.name,
    description: overlay.description,
    reactionType: overlay.reactionType,
    category: translateCategoryKey(overlay.category, dict, locale) as ReactionData["category"],
    reactants: overlay.reactants.map((r, i) => ({
      ...reaction.reactants[i],
      name: r.name,
      formula: r.formula ?? reaction.reactants[i]?.formula,
      count: r.count ?? reaction.reactants[i]?.count ?? 1,
    })),
    products: overlay.products.map((r, i) => ({
      ...reaction.products[i],
      name: r.name,
      formula: r.formula ?? reaction.products[i]?.formula,
      count: r.count ?? reaction.products[i]?.count ?? 1,
    })),
    steps: overlay.steps.length
      ? overlay.steps.map((s, i) => ({
          moleculeId: reaction.steps[i]?.moleculeId ?? reaction.steps[0]?.moleculeId ?? "water",
          caption: s.caption,
        }))
      : reaction.steps,
    quickFacts: {
      summary: overlay.quickFacts.summary,
      energyProfile: overlay.quickFacts.energyProfile,
      conditions: overlay.quickFacts.conditions,
      mechanism: overlay.quickFacts.mechanism,
      highlight: overlay.quickFacts.highlight || reaction.quickFacts?.highlight,
    },
    facts: {
      summary: overlay.quickFacts.summary,
      energyProfile: overlay.quickFacts.energyProfile,
      conditions: overlay.quickFacts.conditions,
      mechanism: overlay.quickFacts.mechanism,
      highlight: overlay.quickFacts.highlight,
    },
  };
}

export function getPhaseLabel(
  phase: string,
  dict: TranslationDictionary,
): string {
  const key = `phase_${phase}` as keyof TranslationDictionary;
  if (key in dict) return dict[key];
  return phase;
}

export function getElementName(
  symbol: string,
  dict: TranslationDictionary,
): string {
  const key = `element_${symbol}` as keyof TranslationDictionary;
  if (key in dict) return dict[key];
  return symbol;
}
