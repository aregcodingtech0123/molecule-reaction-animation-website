/**
 * SEO-19/21: the published element facts against NIST (what the site shows and attributes) and, as a cross-check
 * only, IUPAC/CIAAW (tests/fixtures/element-reference.json, copied by script from those sources; CIAAW values are
 * never displayed - licence, see docs/seo/DATA_REVIEW.md). Values are NEVER changed silently: the one remaining
 * difference below is documented in docs/seo/DATA_REVIEW.md; the test fails if a new difference appears OR it
 * disappears.
 */
import { describe, expect, it } from "vitest";
import reference from "../../fixtures/element-reference.json";
import { ELEMENTS } from "@/lib/periodic-table/elements";

interface Ref {
  z: number;
  symbol: string;
  name: string;
  ciaawAbridged: string | null;
  nistStandardWeight: string | null;
  mostStableMassNumbers: number[] | null;
}
const refs = reference.elements as Ref[];

const decimals = (s: string) => (s.split(".")[1] ?? "").replace(/\D.*$/, "").length;
/** The site rounds to its own number of decimals, so the coarser of the two precisions decides. */
const agrees = (value: number, printed: string) =>
  Math.abs(value - Number(printed)) <= 0.5 * 10 ** -Math.min(decimals(printed), decimals(String(value))) + 1e-9;

/** Decided differences (docs/seo/DATA_REVIEW.md). Keys are symbols. */
const KNOWN_DIFFERENCES: Record<string, string> = {
  Zr: "owner decision: show the NIST value 91.224(2); CIAAW 2024 revised zirconium to 91.222 and is not displayed (licence)",
};

/** Names the site spells the US way where IUPAC uses another spelling (not errors). */
const SPELLING_VARIANTS: Record<string, string> = { Al: "aluminium", Cs: "caesium" };

function differences(): Record<string, string> {
  const found: Record<string, string> = {};
  for (const el of ELEMENTS) {
    const ref = refs[el.atomicNumber - 1];
    const why: string[] = [];
    if (ref.ciaawAbridged) {
      const printed = ref.ciaawAbridged.split("±")[0].trim();
      if (!agrees(el.atomicMass, printed)) why.push(`CIAAW ${printed} vs site ${el.atomicMass}`);
    }
    const nist = ref.nistStandardWeight;
    if (nist && /^\d/.test(nist)) {
      const printed = nist.replace(/\(.*$/, "");
      if (Math.abs(el.atomicMass - Number(printed)) > 0.5 * 10 ** -decimals(String(el.atomicMass)) + 1e-9) {
        why.push(`NIST ${printed} vs site ${el.atomicMass}`);
      }
    }
    if (ref.mostStableMassNumbers && !ref.mostStableMassNumbers.includes(el.atomicMass)) {
      why.push(`CIAAW most stable isotope(s) ${ref.mostStableMassNumbers.join("/")} vs site ${el.atomicMass}`);
    }
    if (why.length) found[el.symbol] = why.join("; ");
  }
  return found;
}

describe("element facts vs IUPAC/CIAAW and NIST", () => {
  it("the reference covers all 118 elements in order", () => {
    expect(refs.map((r) => r.z)).toEqual(Array.from({ length: 118 }, (_, i) => i + 1));
    expect(ELEMENTS.map((e) => e.atomicNumber)).toEqual(refs.map((r) => r.z));
  });

  it("atomic numbers and symbols match the reference for all 118", () => {
    for (const el of ELEMENTS) expect(el.symbol, `Z=${el.atomicNumber}`).toBe(refs[el.atomicNumber - 1].symbol);
  });

  it("names match IUPAC/CIAAW (case-insensitive) except the listed spelling variants", () => {
    for (const el of ELEMENTS) {
      const ref = refs[el.atomicNumber - 1];
      if (SPELLING_VARIANTS[el.symbol]) {
        expect(ref.name.toLowerCase(), el.symbol).toBe(SPELLING_VARIANTS[el.symbol]);
        expect(el.name.toLowerCase(), el.symbol).not.toBe(ref.name.toLowerCase());
      } else {
        expect(el.name.toLowerCase(), el.symbol).toBe(ref.name.toLowerCase());
      }
    }
  });

  it("atomic masses agree with CIAAW 2024 (abridged), NIST and the Nubase most-stable isotope, except the listed differences", () => {
    const found = differences();
    expect(Object.keys(found).sort(), JSON.stringify(found, null, 1)).toEqual(Object.keys(KNOWN_DIFFERENCES).sort());
  });

  it("every element without a CIAAW standard weight uses a mass number of a real isotope, as the periodic-table convention", () => {
    for (const el of ELEMENTS) {
      const ref = refs[el.atomicNumber - 1];
      if (!ref.ciaawAbridged && !ref.mostStableMassNumbers) continue;
      if (!ref.ciaawAbridged) expect(Number.isInteger(el.atomicMass), `${el.symbol} should be a mass number`).toBe(true);
    }
  });

  it("period and group follow the 18-column layout (lanthanides and actinides have no group)", () => {
    for (const el of ELEMENTS) {
      const z = el.atomicNumber;
      const expectedPeriod = z <= 2 ? 1 : z <= 10 ? 2 : z <= 18 ? 3 : z <= 36 ? 4 : z <= 54 ? 5 : z <= 86 ? 6 : 7;
      expect(el.period, el.symbol).toBe(expectedPeriod);
      const fBlock = (z >= 58 && z <= 71) || (z >= 90 && z <= 103);
      if (fBlock) expect(el.group, el.symbol).toBeNull();
      else expect(el.group, el.symbol).toBeGreaterThanOrEqual(1);
    }
  });
});

/** NIST's own table (Atomic Weights and Isotopic Compositions): a number "173.054(5)", an interval "[1.00784,1.00811]", a mass number "[98]" or nothing. */
function nistWeight(
  raw: string | null,
): { kind: "value"; value: number } | { kind: "interval"; lo: number; hi: number } | { kind: "mass-number"; n: number } | null {
  if (!raw) return null;
  const interval = raw.match(/^\[(\d+(?:\.\d+)?),(\d+(?:\.\d+)?)\]$/);
  if (interval) return { kind: "interval", lo: Number(interval[1]), hi: Number(interval[2]) };
  const massNumber = raw.match(/^\[(\d+)\]$/);
  if (massNumber) return { kind: "mass-number", n: Number(massNumber[1]) };
  const value = raw.match(/^(\d+(?:\.\d+)?)\(/);
  return value ? { kind: "value", value: Number(value[1]) } : null;
}

describe("what the site displays is sourced from NIST (decision: CIAAW is not displayed)", () => {
  it("every element with a NIST standard weight shows it (rounded to the site's precision); intervals contain the shown value; NIST's bracketed mass number is the shown mass number", () => {
    let numeric = 0;
    let intervals = 0;
    let bracketed = 0;
    for (const el of ELEMENTS) {
      const nist = nistWeight(refs[el.atomicNumber - 1].nistStandardWeight);
      if (!nist) continue;
      if (nist.kind === "value") {
        numeric++;
        expect(el.atomicMassKind, el.symbol).toBe("standard-weight");
        expect(Math.abs(el.atomicMass - nist.value), `${el.symbol} site ${el.atomicMass} vs NIST ${nist.value}`).toBeLessThanOrEqual(
          0.5 * 10 ** -decimals(String(el.atomicMass)) + 1e-9,
        );
      } else if (nist.kind === "interval") {
        intervals++;
        expect(el.atomicMassKind, el.symbol).toBe("standard-weight");
        // the site rounds to its own precision (O: 15.999 for [15.99903, 15.99977])
        const half = 0.5 * 10 ** -decimals(String(el.atomicMass)) + 1e-9;
        expect(el.atomicMass, `${el.symbol} inside NIST [${nist.lo}, ${nist.hi}]`).toBeGreaterThanOrEqual(nist.lo - half);
        expect(el.atomicMass, `${el.symbol} inside NIST [${nist.lo}, ${nist.hi}]`).toBeLessThanOrEqual(nist.hi + half);
      } else {
        bracketed++;
        expect(el.atomicMassKind, el.symbol).toBe("mass-number");
        expect(el.atomicMass, `${el.symbol} NIST mass number`).toBe(nist.n);
      }
    }
    // 72 + 12 + 10 + 24 (Z 95-118, no NIST weight) = 118; guards against a fixture that silently stopped matching
    expect(numeric).toBe(72);
    expect(intervals).toBe(12);
    expect(bracketed).toBe(10); // Tc Pm Po At Rn Fr Ra Ac Np Pu
  });

  it("the three corrected/decided masses: Yb 173.054 (NIST 173.054(5)), Zr 91.224 (NIST 91.224(2)), Hs 270 as a mass number", () => {
    const by = (s: string) => ELEMENTS.find((e) => e.symbol === s)!;
    expect(by("Yb").atomicMass).toBe(173.054);
    expect(by("Zr").atomicMass).toBe(91.224);
    expect(by("Hs")).toMatchObject({ atomicMass: 270, atomicMassKind: "mass-number" });
  });

  it("the mass kind is exactly 'has no standard atomic weight'; such an element shows an integer mass number of a most-stable isotope", () => {
    const massNumberSymbols: string[] = [];
    for (const el of ELEMENTS) {
      const ref = refs[el.atomicNumber - 1];
      const noStandardWeight = ref.ciaawAbridged === null;
      expect(el.atomicMassKind, `${el.symbol} (${el.atomicNumber})`).toBe(noStandardWeight ? "mass-number" : "standard-weight");
      if (noStandardWeight) {
        massNumberSymbols.push(el.symbol);
        expect(Number.isInteger(el.atomicMass), el.symbol).toBe(true);
        // the "longest-lived isotope" claimed in the UI: one of the evaluated most-stable isotopes (cross-check only, not displayed)
        expect(ref.mostStableMassNumbers, el.symbol).toContain(el.atomicMass);
      }
    }
    // Tc, Pm, Po-Ac (6), Np-Og (26)
    expect(massNumberSymbols).toHaveLength(34);
  });

  it("no element at Z 109-118 has shell data anywhere (the table stops at Hs, Z = 108)", async () => {
    const { NIST_GROUND_SHELLS } = await import("@/lib/periodic-table/nist-ground-shells");
    const { electronShells } = await import("@/lib/periodic-table/electron-configuration");
    expect(Math.max(...Object.keys(NIST_GROUND_SHELLS).map(Number))).toBe(108);
    for (let z = 109; z <= 118; z++) {
      expect(NIST_GROUND_SHELLS[z], `Z=${z}`).toBeUndefined();
      expect(electronShells(z), `Z=${z}`).toBeNull();
    }
  });
});

describe("one-line descriptions (reviewed in docs/seo/DATA_REVIEW.md)", () => {
  const desc = (s: string) => ELEMENTS.find((e) => e.symbol === s)!.description;

  it("all 118 are present, one sentence each, and repeat none of the claims found to be false", () => {
    for (const el of ELEMENTS) {
      expect(el.description.length, el.symbol).toBeGreaterThan(20);
      expect(el.description.trim(), el.symbol).toBe(el.description);
      expect(el.description.endsWith("."), el.symbol).toBe(true);
    }
    const all = ELEMENTS.map((e) => e.description).join("\n");
    for (const claim of [
      /most abundant element by mass/i,
      /kilogram standard/i,
      /energy-efficient/i,
      /softest metal/i,
      /center of the lanthanide contraction/i,
      /dental ceramics/i,
      /space probe power/i,
      /has the highest magnetic moment/i,
      /first worked metal/i,
    ]) {
      expect(all, String(claim)).not.toMatch(claim);
    }
  });

  it("the corrected claims say what the sources support", () => {
    expect(desc("O")).toMatch(/Earth's crust by mass/);
    expect(desc("Ir")).toMatch(/platinum.iridium/);
    expect(desc("Ir")).toMatch(/former kilogram prototype/);
    expect(desc("Li")).toMatch(/lightest metal/);
    expect(desc("Ho")).toMatch(/one of the highest magnetic moments/);
    expect(desc("Os")).toMatch(/Together with iridium/);
    expect(desc("At")).toMatch(/^Among the rarest/);
    expect(desc("Cm")).toMatch(/curium-244/);
  });
});
