import { ALL_MOLECULES, MOLECULE_MAP } from "./data";
import type { MoleculeData } from "./types";

/**
 * What the indexable molecule pages (`/molecules/<id>`) may state (SEO-19, Part 2).
 *
 * The molecule data was checked against PubChem (`tests/fixtures/molecule-reference.json`, docs/seo/DATA_REVIEW.md §6).
 * Items whose check failed or could not be confirmed can be listed in WITHHELD_ON_MOLECULE_PAGES, exactly as written in
 * the data, to keep them OFF the pages while the owner decides (the list is empty now). The 14 items found in the first
 * review were corrected with a cited source or removed from the data (DATA_REVIEW.md §6.2).
 * `tests/unit/molecules/molecule-data.test.ts` fails if a listed item no longer exists in the data.
 */
export interface WithheldFacts {
  description?: true;
  molecularWeight?: true;
  meltingPoint?: true;
  boilingPoint?: true;
  state?: true;
  bondTypes?: readonly string[];
  funFacts?: readonly string[];
}

/**
 * Empty since the owner reviewed DATA_REVIEW.md §6: every item that failed the check was corrected with a cited source or
 * removed from the data itself (so Explore and the pages agree). Kept as the mechanism for the next doubtful fact.
 */
export const WITHHELD_ON_MOLECULE_PAGES: Readonly<Record<string, WithheldFacts>> = {};

export interface MoleculePageFacts {
  molecule: MoleculeData;
  description: string | null;
  molecularWeight: string | null;
  meltingPoint: string | null;
  boilingPoint: string | null;
  state: string | null;
  bondTypes: string[];
  uses: string[];
  funFacts: string[];
}

/** The molecule with the withheld items removed; null for an unknown id. */
export function moleculePageFacts(id: string): MoleculePageFacts | null {
  const molecule = Object.hasOwn(MOLECULE_MAP, id) ? MOLECULE_MAP[id] : undefined;
  if (!molecule) return null;
  const held = WITHHELD_ON_MOLECULE_PAGES[id] ?? {};
  const edu = molecule.education;
  const keep = (items: string[] | undefined, withheld: readonly string[] | undefined) =>
    (items ?? []).filter((item) => !withheld?.includes(item));
  return {
    molecule,
    description: held.description ? null : molecule.description,
    molecularWeight: held.molecularWeight ? null : (edu?.molecularWeight ?? null),
    meltingPoint: held.meltingPoint ? null : (edu?.meltingPoint ?? null),
    boilingPoint: held.boilingPoint ? null : (edu?.boilingPoint ?? null),
    state: held.state ? null : (edu?.state ?? null),
    bondTypes: keep(edu?.bondTypes, held.bondTypes),
    uses: edu?.uses ?? [],
    funFacts: keep(edu?.funFacts, held.funFacts),
  };
}

export const MOLECULE_PAGE_IDS: readonly string[] = ALL_MOLECULES.map((m) => m.id);

/**
 * The PubChem compound record(s) each molecule's facts were checked against (the base pair: adenine and thymine).
 * Shown as "checked against" links on the page; pinned to the test fixture by molecule-data.test.ts.
 */
export const PUBCHEM_CIDS: Readonly<Record<string, readonly number[]>> = {
  water: [962],
  methane: [297],
  glucose: [5793],
  caffeine: [2519],
  "dna-fragment": [190, 1135],
  "protein-fragment": [98153],
  ethanol: [702],
  aspirin: [2244],
  capsaicin: [1548943],
  serotonin: [5202],
  dopamine: [681],
  adrenaline: [5816],
  buckminsterfullerene: [123591],
  "heme-group": [4973],
};

const STATE_WORDS: Record<string, string> = { solid: "a solid", liquid: "a liquid", gas: "a gas" };

/**
 * The answer-first opening of a molecule page (and its meta description): what it is, in one or two sentences, from
 * verified fields only — e.g. "Caffeine (C₈H₁₀N₄O₂) is a solid at room temperature with a molar mass of 194.19 g/mol.
 * A central nervous system stimulant found in coffee and tea."
 */
export function moleculeSummary(facts: MoleculePageFacts): string {
  const { molecule } = facts;
  const clauses: string[] = [];
  if (facts.state && STATE_WORDS[facts.state]) clauses.push(`is ${STATE_WORDS[facts.state]} at room temperature`);
  if (facts.molecularWeight) clauses.push(`${clauses.length ? "with" : "has"} a molar mass of ${facts.molecularWeight}`);
  const description = facts.description;
  const head = `${molecule.name} (${molecule.formula})`;
  if (!clauses.length) return description ? `${head}: ${description.charAt(0).toLowerCase()}${description.slice(1)}` : `${head}.`;
  return [`${head} ${clauses.join(" ")}.`, description].filter(Boolean).join(" ");
}
