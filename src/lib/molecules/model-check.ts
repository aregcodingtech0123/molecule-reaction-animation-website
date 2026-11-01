import type { MoleculeData } from "./types";

/**
 * Does a 3D model contain exactly the atoms of its molecule's formula? (SEO-19, owner decision after Part 2.)
 *
 * The molecular formulas below are PubChem's computed values for the compound(s) each molecule stands for
 * (pinned to `tests/fixtures/molecule-reference.json`, retrieved 2026-11-01; the base pair is adenine + thymine). The atom/bond counts, bond-type bars and element composition shown in the UI are derived from
 * the model, so they are shown only where this check passes: a model that has lost its hydrogens would print wrong
 * numbers. Molecules without a reference here (structures the AI Lab loads from PubChem at runtime) are not checked:
 * their atoms come straight from PubChem's 3D record.
 */
export const REFERENCE_FORMULAS: Readonly<Record<string, readonly string[]>> = {
  water: ["H2O"],
  methane: ["CH4"],
  glucose: ["C6H12O6"],
  caffeine: ["C8H10N4O2"],
  "dna-fragment": ["C5H5N5", "C5H6N2O2"],
  "protein-fragment": ["C5H10N2O3"],
  ethanol: ["C2H6O"],
  aspirin: ["C9H8O4"],
  capsaicin: ["C18H27NO3"],
  serotonin: ["C10H12N2O"],
  dopamine: ["C8H11NO2"],
  adrenaline: ["C9H13NO3"],
  buckminsterfullerene: ["C60"],
  "heme-group": ["C34H32FeN4O4"],
};

/** "C8H10N4O2" -> { C: 8, H: 10, N: 4, O: 2 }; several formulas are summed. */
export function elementCounts(formulas: readonly string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const formula of formulas) {
    for (const [, element, n] of formula.matchAll(/([A-Z][a-z]?)(\d*)/g)) {
      counts[element] = (counts[element] ?? 0) + (n ? Number(n) : 1);
    }
  }
  return counts;
}

export function modelElementCounts(molecule: Pick<MoleculeData, "atoms">): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const atom of molecule.atoms) counts[atom.element] = (counts[atom.element] ?? 0) + 1;
  return counts;
}

const same = (a: Record<string, number>, b: Record<string, number>) => {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a[k] ?? 0) === (b[k] ?? 0));
};

/** False only for a known molecule whose model differs from its formula; unknown (runtime) molecules pass. */
export function modelMatchesFormula(molecule: Pick<MoleculeData, "id" | "atoms">): boolean {
  const reference = Object.hasOwn(REFERENCE_FORMULAS, molecule.id) ? REFERENCE_FORMULAS[molecule.id] : undefined;
  if (!reference) return true;
  return same(modelElementCounts(molecule), elementCounts(reference));
}
