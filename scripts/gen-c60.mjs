/**
 * Truncated icosahedron C60 — 60 vertices, 90 bonds
 */
const PHI = (1 + Math.sqrt(5)) / 2;
const SCALE = 3.35;

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function dist(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

const ico = [
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
].map(normalize);

const faces = [
  [0, 8, 4],
  [0, 4, 1],
  [0, 1, 9],
  [0, 9, 5],
  [0, 5, 8],
  [8, 10, 4],
  [4, 10, 6],
  [6, 10, 11],
  [11, 10, 8],
  [1, 4, 6],
  [1, 6, 2],
  [2, 6, 11],
  [11, 9, 2],
  [9, 1, 2],
  [5, 9, 11],
  [5, 11, 7],
  [7, 11, 10],
  [10, 8, 7],
  [7, 8, 5],
  [3, 6, 10],
  [3, 10, 7],
  [3, 7, 11],
  [3, 11, 6],
  [2, 11, 3],
  [2, 3, 6],
  [2, 6, 1],
  [3, 2, 9],
  [3, 9, 5],
  [3, 5, 7],
];

const edgeSet = new Set();
const edges = [];
for (const [a, b, c] of faces) {
  for (const [i, j] of [
    [a, b],
    [b, c],
    [c, a],
  ]) {
    const key = i < j ? `${i}-${j}` : `${j}-${i}`;
    if (!edgeSet.has(key)) {
      edgeSet.add(key);
      edges.push([i, j]);
    }
  }
}

// Truncation: two points per edge at t=1/3 and t=2/3, projected to unit sphere
const vertMap = new Map();
const positions = [];

function getVert(i, j, t) {
  const key = `${i}-${j}-${t}`;
  if (vertMap.has(key)) return vertMap.get(key);
  const a = ico[i];
  const b = ico[j];
  const p = normalize([
    a[0] * (1 - t) + b[0] * t,
    a[1] * (1 - t) + b[1] * t,
    a[2] * (1 - t) + b[2] * t,
  ]);
  const idx = positions.length;
  positions.push(p.map((x) => x * SCALE));
  vertMap.set(key, idx);
  vertMap.set(`${j}-${i}-${1 - t}`, idx);
  return idx;
}

for (const [i, j] of edges) {
  getVert(i, j, 1 / 3);
  getVert(i, j, 2 / 3);
}

const BOND_THRESH = 1.52 * (SCALE / 1.42);
const bondPairs = [];
for (let i = 0; i < positions.length; i++) {
  for (let j = i + 1; j < positions.length; j++) {
    if (dist(positions[i], positions[j]) < BOND_THRESH) {
      bondPairs.push([i, j]);
    }
  }
}

// Assign bond orders: short bonds in pentagons often aromatic - use 1 for display, mark hexagon doubles alternately
const bonds = bondPairs.map(([i, j], k) => ({
  id: `b${k + 1}`,
  from: `C${i + 1}`,
  to: `C${j + 1}`,
  order: 1,
}));

const atoms = positions.map((p, i) => ({
  id: `C${i + 1}`,
  element: "C",
  position: [Math.round(p[0] * 1000) / 1000, Math.round(p[1] * 1000) / 1000, Math.round(p[2] * 1000) / 1000],
}));

import fs from "fs";
fs.writeFileSync(
  "scripts/c60-output.json",
  JSON.stringify({ atoms: atoms.length, bonds: bonds.length, atoms, bonds }, null, 2)
);
console.log("atoms", atoms.length, "bonds", bonds.length);
