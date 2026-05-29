import type { AtomData, BondData } from "../types";
import { dist, norm, scaleVec } from "./helpers";

const PHI = (1 + Math.sqrt(5)) / 2;
const R = 3.35;

/** Icosahedron vertices (unit) */
const ICO = [
  [0, 1, PHI],
  [0, -1, PHI],
  [0, 1, -PHI],
  [0, -1, -PHI],
  [1, PHI, 0],
  [-1, PHI, 0],
  [1, -PHI, 0],
  [-1, -PHI, 0],
  [PHI, 0, 1],
  [-PHI, 0, 1],
  [PHI, 0, -1],
  [-PHI, 0, -1],
].map((v) => norm(v as [number, number, number]));

function buildIcosahedronEdges(): [number, number][] {
  const edges: [number, number][] = [];
  for (let i = 0; i < 12; i++) {
    for (let j = i + 1; j < 12; j++) {
      const d = dist(ICO[i], ICO[j]);
      if (d > 1.0 && d < 1.25) edges.push([i, j]);
    }
  }
  return edges;
}

function buildC60Vertices(): [number, number, number][] {
  const edges = buildIcosahedronEdges();
  const verts: [number, number, number][] = [];
  const seen = new Set<string>();

  for (const [i, j] of edges) {
    for (const t of [1 / 3, 2 / 3]) {
      const key = `${i}-${j}-${t}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const a = ICO[i];
      const b = ICO[j];
      const p = norm([
        a[0] * (1 - t) + b[0] * t,
        a[1] * (1 - t) + b[1] * t,
        a[2] * (1 - t) + b[2] * t,
      ]);
      verts.push(scaleVec(p, R));
    }
  }
  return verts;
}

function buildC60Bonds(positions: [number, number, number][]): BondData[] {
  const thresh = 1.4;
  const pairs: [number, number][] = [];
  for (let i = 0; i < positions.length; i++) {
    for (let j = i + 1; j < positions.length; j++) {
      if (dist(positions[i], positions[j]) < thresh) {
        pairs.push([i, j]);
      }
    }
  }
  return pairs.map(([i, j], idx) => ({
    id: `b${idx + 1}`,
    from: `C${i + 1}`,
    to: `C${j + 1}`,
    order: (idx % 5 === 0 ? 2 : 1) as 1 | 2,
  }));
}

let cachedAtoms: AtomData[] | null = null;
let cachedBonds: BondData[] | null = null;

export function getC60Structure(): { atoms: AtomData[]; bonds: BondData[] } {
  if (cachedAtoms && cachedBonds) return { atoms: cachedAtoms, bonds: cachedBonds };
  const positions = buildC60Vertices();
  cachedAtoms = positions.map((p, i) => ({
    id: `C${i + 1}`,
    element: "C",
    position: [
      Math.round(p[0] * 1000) / 1000,
      Math.round(p[1] * 1000) / 1000,
      Math.round(p[2] * 1000) / 1000,
    ],
  }));
  cachedBonds = buildC60Bonds(positions);
  return { atoms: cachedAtoms, bonds: cachedBonds };
}
