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

  it("every molar mass agrees with PubChem to the precision both print (+0.01 g/mol); the base pair's is adenine + thymine", () => {
    for (const m of ALL_MOLECULES) {
      const shown = m.education!.molecularWeight;
      if (m.id === "dna-fragment") {
        // the free bases the model shows: adenine 135.13 + thymine 126.11 (PubChem)
        expect(shown).toBe("261.24 g/mol (adenine + thymine, free bases)");
        expect(refs[m.id].map((r) => r.molecularWeight)).toEqual(["135.13", "126.11"]);
        expect(refs[m.id].reduce((sum, r) => sum + Number(r.molecularWeight), 0).toFixed(2)).toBe("261.24");
        continue;
      }
      const value = shown.split(" ")[0];
      const ref = refs[m.id][0].molecularWeight;
      const tolerance = 0.5 * 10 ** -Math.min(decimals(value), decimals(ref)) + 0.0101;
      expect(Math.abs(Number(value) - Number(ref)), `${m.id}: ${value} vs PubChem ${ref}`).toBeLessThanOrEqual(tolerance);
    }
  });

  it("every melting / boiling point shown on a molecule page is within 3 °C of a PubChem value (glucose has no boiling point)", () => {
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
    expect(checked).toBe(11); // water 2, methane 2, glucose 1 (melting only), caffeine 2, ethanol 2, aspirin 1, capsaicin 1
    expect(MOLECULE_MAP.glucose.education!.boilingPoint).toBeUndefined();
  });

  it("every 3D model has exactly PubChem's atoms except heme (no PubChem 3D record for an iron complex; DATA_REVIEW.md §6.3)", () => {
    const mismatched: Record<string, string> = {};
    for (const m of ALL_MOLECULES) {
      const model: Record<string, number> = {};
      for (const a of m.atoms) model[a.element] = (model[a.element] ?? 0) + 1;
      if (sorted(model) !== sorted(referenceCounts(m.id))) mismatched[m.id] = `${sorted(model)} vs ${sorted(referenceCounts(m.id))}`;
    }
    expect(Object.keys(mismatched).sort(), JSON.stringify(mismatched, null, 1)).toEqual(["heme-group"]);
  });
});

/** The 14 items the first review found wrong or unverifiable (DATA_REVIEW.md §6.2); each was corrected with a cited source or removed. */
const REMOVED_CLAIMS = [
  "Water is the only natural substance that exists in all three",
  "Hot water can freeze faster than cold water",
  "A water molecule stays in the atmosphere for only about 9 days",
  "Decomposes at 146",
  "The average cup of espresso contains about 63mg",
  "~600 g/mol",
  "Glycosidic",
  "from Earth to the Sun and back",
  "over 100,000 distinct human proteins",
  "roughly every 0.05 seconds",
  "Ethanol disrupts membrane fluidity",
  "Its acetyl group helps it survive stomach acid",
  "Nobel-celebrated cage",
  "axial histidine tug-of-war",
];

describe("corrected or removed claims (DATA_REVIEW.md §6.2)", () => {
  it("none of the 14 claims is anywhere in the molecule data (so neither Explore nor the pages show them)", () => {
    const everything = JSON.stringify(ALL_MOLECULES.map((m) => ({ d: m.description, e: m.education })));
    expect(REMOVED_CLAIMS).toHaveLength(14);
    for (const claim of REMOVED_CLAIMS) expect(everything, claim).not.toContain(claim);
  });

  it("the replacements are the sourced ones", () => {
    const facts = (id: string) => MOLECULE_MAP[id].education!.funFacts;
    expect(facts("water")).toContain("Liquid water is densest at about 4 °C: water at 4 °C is denser than water at 0 °C."); // USGS Water Science School
    expect(facts("protein-fragment")).toContain("The human genome has about 20,000 protein-coding genes (19,878 in Ensembl release 116, June 2026).");
    expect(facts("ethanol")).toContain("Ethanol is miscible with water (PubChem lists it as miscible, citing HSDB, ICSC and NIOSH).");
    expect(MOLECULE_MAP["dna-fragment"].education!.bondTypes).toEqual(["Aromatic", "Hydrogen Bond (×2 A–T)"]);
    expect(MOLECULE_MAP.buckminsterfullerene.description).toBe(
      "A closed cage of 60 carbon atoms: a truncated icosahedron with 12 pentagonal and 20 hexagonal faces, one carbon at each of its 60 corners.",
    );
  });
});

describe("withheld-facts mechanism (empty now)", () => {
  it("nothing is withheld", () => {
    expect(WITHHELD_ON_MOLECULE_PAGES).toEqual({});
  });

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
    expect(moleculePageFacts("glucose")!.boilingPoint).toBeNull(); // removed from the data itself
    expect(moleculePageFacts("dna-fragment")!.molecularWeight).toContain("261.24");
  });

  it("an unknown or inherited id is not a molecule", () => {
    for (const id of ["xyz", "__proto__", "constructor", "Caffeine", ""]) expect(moleculePageFacts(id), id).toBeNull();
  });
});
