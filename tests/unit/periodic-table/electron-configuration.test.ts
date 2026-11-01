/**
 * SEO-21: electron shells come from NIST's measured ground states (Z 1-108); Z 109-118 have none.
 * The old fill-in-order estimate gave K = 2,8,9 (real 2,8,8,1). Every one of the 118 elements is covered here.
 */
import { describe, expect, it } from "vitest";
import { ELEMENTS } from "@/lib/periodic-table/elements";
import { electronShells } from "@/lib/periodic-table/electron-configuration";
import { NIST_GROUND_SHELLS } from "@/lib/periodic-table/nist-ground-shells";

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("electronShells (NIST ground states)", () => {
  it("covers all 118 elements: shells for Z 1-108, null for Z 109-118 (NIST lists none)", () => {
    expect(ELEMENTS).toHaveLength(118);
    for (const { atomicNumber: z, symbol } of ELEMENTS) {
      const shells = electronShells(z);
      if (z <= 108) expect(shells, `${symbol} (${z})`).not.toBeNull();
      else expect(shells, `${symbol} (${z}) is predicted, not measured`).toBeNull();
    }
    expect(Object.keys(NIST_GROUND_SHELLS)).toHaveLength(108);
  });

  it("every configuration holds exactly Z electrons and respects the 2n² capacity of each shell", () => {
    for (let z = 1; z <= 108; z++) {
      const shells = electronShells(z)!;
      expect(sum(shells), `Z=${z} ${JSON.stringify(shells)}`).toBe(z);
      shells.forEach((count, i) => {
        expect(count, `Z=${z} shell ${i + 1}`).toBeGreaterThan(0);
        expect(count, `Z=${z} shell ${i + 1}`).toBeLessThanOrEqual(2 * (i + 1) ** 2);
      });
    }
  });

  it("the noble gases close their shells", () => {
    expect(electronShells(2)).toEqual([2]);
    expect(electronShells(10)).toEqual([2, 8]);
    expect(electronShells(18)).toEqual([2, 8, 8]);
    expect(electronShells(36)).toEqual([2, 8, 18, 8]);
    expect(electronShells(54)).toEqual([2, 8, 18, 18, 8]);
    expect(electronShells(86)).toEqual([2, 8, 18, 32, 18, 8]);
  });

  it("potassium onward is no longer filled in order (the reported bug)", () => {
    expect(electronShells(19)).toEqual([2, 8, 8, 1]); // old estimate: 2,8,9
    expect(electronShells(20)).toEqual([2, 8, 8, 2]);
    expect(electronShells(21)).toEqual([2, 8, 9, 2]);
    expect(electronShells(26)).toEqual([2, 8, 14, 2]); // old estimate: 2,8,16
    expect(electronShells(30)).toEqual([2, 8, 18, 2]);
  });

  it("known exceptions to the filling order (textbook values, cross-checked against the NIST strings)", () => {
    const expected: Record<string, number[]> = {
      Cr: [2, 8, 13, 1],
      Cu: [2, 8, 18, 1],
      Nb: [2, 8, 18, 12, 1],
      Mo: [2, 8, 18, 13, 1],
      Ru: [2, 8, 18, 15, 1],
      Rh: [2, 8, 18, 16, 1],
      Pd: [2, 8, 18, 18],
      Ag: [2, 8, 18, 18, 1],
      La: [2, 8, 18, 18, 9, 2],
      Ce: [2, 8, 18, 19, 9, 2],
      Gd: [2, 8, 18, 25, 9, 2],
      Pt: [2, 8, 18, 32, 17, 1],
      Au: [2, 8, 18, 32, 18, 1],
      Ac: [2, 8, 18, 32, 18, 9, 2],
      Th: [2, 8, 18, 32, 18, 10, 2],
      U: [2, 8, 18, 32, 21, 9, 2],
      Lr: [2, 8, 18, 32, 32, 8, 3], // NIST: 7s2 7p (not 6d)
    };
    for (const [symbol, shells] of Object.entries(expected)) {
      const el = ELEMENTS.find((e) => e.symbol === symbol)!;
      expect(electronShells(el.atomicNumber), symbol).toEqual(shells);
    }
  });

  it("the first 18 elements fill 2, 8, 8 in order", () => {
    for (let z = 1; z <= 18; z++) {
      const shells = electronShells(z)!;
      expect(shells[0]).toBe(Math.min(z, 2));
      if (z > 2) expect(shells[1]).toBe(Math.min(z - 2, 8));
      if (z > 10) expect(shells[2]).toBe(z - 10);
    }
  });

  it("an atomic number outside the table has no shells", () => {
    expect(electronShells(0)).toBeNull();
    expect(electronShells(119)).toBeNull();
  });
});
