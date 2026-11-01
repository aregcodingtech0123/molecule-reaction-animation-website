/**
 * SEO-19 (Part 2): the molecule facts against PubChem (tests/fixtures/molecule-reference.json, retrieved by script).
 * Values are never changed silently: every difference is listed in docs/seo/DATA_REVIEW.md §6 and pinned here, so a
 * new difference fails the test and a fixed one forces the list (and the document) to be updated.
 */
import { describe, expect, it } from "vitest";
import reference from "../../fixtures/molecule-reference.json";
import { ALL_MOLECULES, MOLECULE_MAP } from "@/lib/molecules/data";
import { moleculePageFacts, MOLECULE_PAGE_IDS, WITHHELD_ON_MOLECULE_PAGES } from "@/lib/molecules/page-facts";

interface Ref {
  cid: number;
  title: string;
  formula: string;
  molecularWeight: string;
  meltingPoint: string[];
  boilingPoint: string[];
}
const refs = reference.molecules as Record<string, Ref[]>;

const SUBSCRIPTS: Record<string, string> = { "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" };
function countAtoms(formula: string): Record<string, number> {
  const plain = formula.replace(/[₀-₉]/g, (c) => SUBSCRIPTS[c]);
  const counts: Record<string, number> = {};
  for (const [, el, n] of plain.matchAll(/([A-Z][a-z]?)(\d*)/g)) counts[el] = (counts[el] ?? 0) + (n ? Number(n) : 1);
  return counts;
}
const sorted = (o: Record<string, number>) => JSON.stringify(Object.fromEntries(Object.entries(o).sort()));
/** PubChem reference formula for the molecule (a base pair is adenine + thymine). */
function referenceCounts(id: string): Record<string, number> {
  const total: Record<string, number> = {};
  for (const r of refs[id]) for (const [el, n] of Object.entries(countAtoms(r.formula))) total[el] = (total[el] ?? 0) + n;
  return total;
}
/** Display labels that are names, not formulas. */
const FORMULA_LABELS: Record<string, string> = { "dna-fragment": "Adenine–Thymine", "protein-fragment": "Gly-Ala" };

/** °C values in PubChem's strings (°F, pressures other than atmospheric and prose are ignored). */
function celsius(values: string[]): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (/°F|mm Hg(?!\])|mmHg/.test(v) && !/@760/.test(v)) continue;
    for (const m of v.matchAll(/(-?\d+(?:\.\d+)?)(?:\s*-\s*(-?\d+(?:\.\d+)?))?/g)) {
      out.push(Number(m[1]));
      if (m[2]) out.push(Number(m[2]));
    }
  }
  return out;
}
const numbersIn = (s: string) => [...s.matchAll(/(-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
const decimals = (s: string) => (s.split(".")[1] ?? "").length;

describe("molecule facts vs PubChem", () => {
  it("there is a PubChem reference for every molecule, and a page id for every molecule (14)", () => {
    expect(ALL_MOLECULES).toHaveLength(14);
    expect(Object.keys(refs).sort()).toEqual(ALL_MOLECULES.map((m) => m.id).sort());
    expect([...MOLECULE_PAGE_IDS].sort()).toEqual(Object.keys(refs).sort());
  });

  it("every formula has exactly PubChem's atoms (names used as labels: DNA base pair, Gly-Ala)", () => {
    for (const m of ALL_MOLECULES) {
      if (FORMULA_LABELS[m.id]) {
        expect(m.formula, m.id).toBe(FORMULA_LABELS[m.id]);
        continue;
      }
      expect(sorted(countAtoms(m.formula)), m.id).toBe(sorted(referenceCounts(m.id)));
    }
  });

  it("every molar mass agrees with PubChem to the precision both print (+0.01 g/mol); the base pair's is withheld", () => {
    for (const m of ALL_MOLECULES) {
      const shown = m.education!.molecularWeight;
      if (m.id === "dna-fragment") {
        expect(shown).toBe("~600 g/mol (pair)");
        expect(WITHHELD_ON_MOLECULE_PAGES[m.id].molecularWeight).toBe(true);
        continue;
      }
      const value = shown.split(" ")[0];
      const ref = refs[m.id][0].molecularWeight;
      const tolerance = 0.5 * 10 ** -Math.min(decimals(value), decimals(ref)) + 0.0101;
      expect(Math.abs(Number(value) - Number(ref)), `${m.id}: ${value} vs PubChem ${ref}`).toBeLessThanOrEqual(tolerance);
    }
  });

  it("every melting / boiling point shown on a molecule page is within 3 °C of a PubChem value", () => {
    let checked = 0;
    for (const id of MOLECULE_PAGE_IDS) {
      const facts = moleculePageFacts(id)!;
      for (const [kind, shown] of [["meltingPoint", facts.meltingPoint], ["boilingPoint", facts.boilingPoint]] as const) {
        if (!shown) continue;
        const ref = celsius(refs[id][0][kind]);
        expect(ref.length, `${id} ${kind}: PubChem has a value`).toBeGreaterThan(0);
        for (const v of numbersIn(shown.replace(/\(\d+°F\)/, ""))) {
          expect(Math.min(...ref.map((r) => Math.abs(r - v))), `${id} ${kind} ${v} vs ${ref.join(", ")}`).toBeLessThanOrEqual(3);
        }
        checked++;
      }
    }
    expect(checked).toBe(11); // water 2, methane 2, glucose 1, caffeine 2, ethanol 2, aspirin 1, capsaicin 1
  });

  it("the 3D models that do not have the formula's atoms are exactly the eight listed for review", () => {
    const mismatched: Record<string, string> = {};
    for (const m of ALL_MOLECULES) {
      const model: Record<string, number> = {};
      for (const a of m.atoms) model[a.element] = (model[a.element] ?? 0) + 1;
      if (sorted(model) !== sorted(referenceCounts(m.id))) mismatched[m.id] = `${sorted(model)} vs ${sorted(referenceCounts(m.id))}`;
    }
    expect(Object.keys(mismatched).sort(), JSON.stringify(mismatched, null, 1)).toEqual(
      ["adrenaline", "caffeine", "capsaicin", "dna-fragment", "dopamine", "glucose", "heme-group", "protein-fragment"],
    );
  });
});

describe("withheld facts (DATA_REVIEW.md §6)", () => {
  it("every withheld item exists verbatim in the data (a fix in the data must update the list)", () => {
    for (const [id, held] of Object.entries(WITHHELD_ON_MOLECULE_PAGES)) {
      const m = MOLECULE_MAP[id];
      expect(m, id).toBeDefined();
      for (const fact of held.funFacts ?? []) expect(m.education!.funFacts, id).toContain(fact);
      for (const bond of held.bondTypes ?? []) expect(m.education!.bondTypes, id).toContain(bond);
      if (held.boilingPoint) expect(m.education!.boilingPoint, id).toBeTruthy();
      if (held.meltingPoint) expect(m.education!.meltingPoint, id).toBeTruthy();
    }
  });

  it("moleculePageFacts leaves every withheld item out and keeps everything else", () => {
    for (const id of MOLECULE_PAGE_IDS) {
      const facts = moleculePageFacts(id)!;
      const held = WITHHELD_ON_MOLECULE_PAGES[id] ?? {};
      const edu = facts.molecule.education!;
      for (const fact of held.funFacts ?? []) expect(facts.funFacts, id).not.toContain(fact);
      for (const bond of held.bondTypes ?? []) expect(facts.bondTypes, id).not.toContain(bond);
      expect(facts.funFacts.length + (held.funFacts?.length ?? 0), id).toBe(edu.funFacts.length);
      expect(facts.bondTypes.length + (held.bondTypes?.length ?? 0), id).toBe(edu.bondTypes.length);
      expect(facts.description === null, id).toBe(Boolean(held.description));
      expect(facts.boilingPoint === null, id).toBe(Boolean(held.boilingPoint) || !edu.boilingPoint);
    }
    expect(moleculePageFacts("glucose")!.boilingPoint).toBeNull();
    expect(moleculePageFacts("dna-fragment")!.molecularWeight).toBeNull();
  });

  it("an unknown or inherited id is not a molecule", () => {
    for (const id of ["xyz", "__proto__", "constructor", "Caffeine", ""]) expect(moleculePageFacts(id), id).toBeNull();
  });
});
