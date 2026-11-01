/**
 * SEO-19/21: the published element facts against IUPAC/CIAAW and NIST (tests/fixtures/element-reference.json, copied
 * by script from those sources). Values are NEVER changed silently: the three known differences below are listed
 * for the owner's review in docs/seo/DATA_REVIEW.md; the test fails if a new difference appears OR one disappears,
 * so fixing a value forces this list (and the document) to be updated.
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

/** Differences awaiting the owner's decision (docs/seo/DATA_REVIEW.md). Keys are symbols. */
const KNOWN_DIFFERENCES: Record<string, string> = {
  Zr: "CIAAW 2024 revised zirconium to 91.222; the site (and the older NIST page) has 91.224",
  Yb: "NIST and CIAAW give 173.054 / 173.05; the site has 173.045 (digits transposed)",
  Hs: "CIAAW (Nubase 2020) lists mass numbers 269 and 270 as most stable; the site has 277",
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
