/**
 * SEO-19: the regenerated 3D models (PubChem computed conformers, scripts/molecules/generate-structures.mjs) are
 * complete and physically sensible: unique atom ids, bonds between existing atoms, chemical bond lengths, no
 * overlapping atoms, one connected piece per compound.
 */
import { describe, expect, it } from "vitest";
import { MOLECULE_MAP } from "@/lib/molecules/data";
import { elementCounts, modelElementCounts, REFERENCE_FORMULAS } from "@/lib/molecules/model-check";

const REGENERATED = { glucose: 1, caffeine: 1, "dna-fragment": 2, "protein-fragment": 1, capsaicin: 1, dopamine: 1, adrenaline: 1 } as const;
const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe.each(Object.entries(REGENERATED))("regenerated model %s (%i compound(s))", (id, pieces) => {
  const m = MOLECULE_MAP[id];
  const byId = new Map(m.atoms.map((a) => [a.id, a]));

  it("has exactly the atoms of PubChem's formula", () => {
    expect(modelElementCounts(m)).toEqual(elementCounts(REFERENCE_FORMULAS[id]));
  });

  it("atom ids are unique and every bond joins two existing, different atoms (no duplicates)", () => {
    expect(byId.size).toBe(m.atoms.length);
    const seen = new Set<string>();
    for (const b of m.bonds) {
      expect(byId.has(b.from) && byId.has(b.to) && b.from !== b.to, b.id).toBe(true);
      const key = [b.from, b.to].sort().join("-");
      expect(seen.has(key), `duplicate bond ${key}`).toBe(false);
      seen.add(key);
      expect([1, 2, 3]).toContain(b.order);
    }
  });

  it("every bond has a chemical length: X-H 0.90-1.15 Å, other bonds 1.15-1.60 Å", () => {
    for (const b of m.bonds) {
      const A = byId.get(b.from)!, B = byId.get(b.to)!;
      const d = dist(A.position, B.position);
      const hydrogen = A.element === "H" || B.element === "H";
      const [lo, hi] = hydrogen ? [0.9, 1.15] : [1.15, 1.6];
      expect(d, `${A.id}-${B.id} ${d.toFixed(2)} Å`).toBeGreaterThanOrEqual(lo);
      expect(d, `${A.id}-${B.id} ${d.toFixed(2)} Å`).toBeLessThanOrEqual(hi);
    }
  });

  it("no two atoms overlap (closest pair of non-bonded atoms ≥ 1.0 Å)", () => {
    const bonded = new Set(m.bonds.flatMap((b) => [`${b.from}|${b.to}`, `${b.to}|${b.from}`]));
    for (let i = 0; i < m.atoms.length; i++) {
      for (let j = i + 1; j < m.atoms.length; j++) {
        const A = m.atoms[i], B = m.atoms[j];
        if (bonded.has(`${A.id}|${B.id}`)) continue;
        expect(dist(A.position, B.position), `${A.id}/${B.id}`).toBeGreaterThanOrEqual(1.0);
      }
    }
  });

  it(`the bond graph has ${pieces} connected piece(s) (the pair is two separate bases)`, () => {
    const adjacency = new Map<string, string[]>(m.atoms.map((a) => [a.id, []]));
    for (const b of m.bonds) {
      adjacency.get(b.from)!.push(b.to);
      adjacency.get(b.to)!.push(b.from);
    }
    const seen = new Set<string>();
    let components = 0;
    for (const a of m.atoms) {
      if (seen.has(a.id)) continue;
      components++;
      const stack = [a.id];
      while (stack.length) {
        const cur = stack.pop()!;
        if (seen.has(cur)) continue;
        seen.add(cur);
        stack.push(...adjacency.get(cur)!);
      }
    }
    expect(components).toBe(pieces);
  });

  it("is centred on the origin and compact (within 15 Å)", () => {
    const c = [0, 1, 2].map((k) => m.atoms.reduce((s, a) => s + a.position[k], 0) / m.atoms.length);
    for (const v of c) expect(Math.abs(v)).toBeLessThan(0.05);
    for (const a of m.atoms) expect(dist(a.position, [0, 0, 0])).toBeLessThan(15);
  });
});
