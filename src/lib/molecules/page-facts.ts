import { ALL_MOLECULES, MOLECULE_MAP } from "./data";
import type { MoleculeData } from "./types";

/**
 * What the indexable molecule pages (`/molecules/<id>`) may state (SEO-19, Part 2).
 *
 * The molecule data was checked against PubChem (`tests/fixtures/molecule-reference.json`, docs/seo/DATA_REVIEW.md §6).
 * Values are never changed silently: the data file is untouched and Explore keeps showing everything. Items whose
 * check failed or could not be confirmed are listed here, exactly as written in the data, and are left OFF the
 * molecule pages until the owner decides. `tests/unit/molecules/molecule-data.test.ts` fails if a listed item no
 * longer exists in the data (so a later fix forces this list to be updated).
 */
export interface WithheldFacts {
  description?: true;
  molecularWeight?: true;
  meltingPoint?: true;
  boilingPoint?: true;
  bondTypes?: readonly string[];
  funFacts?: readonly string[];
}

export const WITHHELD_ON_MOLECULE_PAGES: Readonly<Record<string, WithheldFacts>> = {
  water: {
    funFacts: [
      "Water is the only natural substance that exists in all three physical states at temperatures normally found on Earth.",
      "Hot water can freeze faster than cold water — this is known as the Mpemba effect.",
    ],
  },
  glucose: { boilingPoint: true },
  caffeine: {
    funFacts: [
      "The average cup of espresso contains about 63mg of caffeine — a lethal dose would require ~80 cups consumed very rapidly.",
    ],
  },
  "dna-fragment": {
    molecularWeight: true,
    bondTypes: ["Glycosidic Bond"],
    funFacts: [
      "If the DNA from all your cells were uncoiled and laid end-to-end, it would reach from Earth to the Sun and back ~600 times.",
    ],
  },
  "protein-fragment": {
    funFacts: [
      "There are 20 standard amino acids, and life uses combinations of them to build over 100,000 distinct human proteins.",
      "The ribosome synthesizes a new peptide bond roughly every 0.05 seconds.",
    ],
  },
  ethanol: {
    funFacts: [
      "Ethanol disrupts membrane fluidity and protein structure, which is part of why it’s such a broad biological solvent.",
    ],
  },
  aspirin: {
    funFacts: ["Its acetyl group helps it survive stomach acid better than salicylic acid alone."],
  },
  buckminsterfullerene: { description: true },
};

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
    state: edu?.state ?? null,
    bondTypes: keep(edu?.bondTypes, held.bondTypes),
    uses: edu?.uses ?? [],
    funFacts: keep(edu?.funFacts, held.funFacts),
  };
}

export const MOLECULE_PAGE_IDS: readonly string[] = ALL_MOLECULES.map((m) => m.id);
