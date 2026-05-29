import type { AtomData, BondData } from "../types";

export type Vec3 = [number, number, number];

export function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function scaleVec(v: Vec3, s: number): Vec3 {
  return [v[0] * s, v[1] * s, v[2] * s];
}

export function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function subVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** Regular hexagon in xy plane, centered at `center` */
export function hexRing(center: Vec3, radius: number, startAngle = 0): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i < 6; i++) {
    const a = startAngle + (i * Math.PI) / 3;
    pts.push([
      center[0] + radius * Math.cos(a),
      center[1] + radius * Math.sin(a),
      center[2],
    ]);
  }
  return pts;
}

export function tetrahedralH(
  carbon: Vec3,
  direction: Vec3,
  length = 1.05,
  spread = 0.95
): Vec3[] {
  const d = norm(direction);
  const perp =
    Math.abs(d[2]) < 0.9
      ? norm([d[1], -d[0], 0])
      : norm([0, d[2], -d[1]]);
  const perp2 = norm([
    d[1] * perp[2] - d[2] * perp[1],
    d[2] * perp[0] - d[0] * perp[2],
    d[0] * perp[1] - d[1] * perp[0],
  ]);
  return [
    addVec(carbon, scaleVec(d, length)),
    addVec(carbon, addVec(scaleVec(d, -0.35 * length), scaleVec(perp, spread))),
    addVec(carbon, addVec(scaleVec(d, -0.35 * length), scaleVec(perp2, spread))),
  ];
}

export function zigzagChain(
  start: Vec3,
  count: number,
  step: Vec3,
  alternate = 0.35
): Vec3[] {
  const pts: Vec3[] = [start];
  for (let i = 1; i < count; i++) {
    const side = i % 2 === 0 ? alternate : -alternate;
    pts.push([
      pts[i - 1][0] + step[0],
      pts[i - 1][1] + step[1] + side,
      pts[i - 1][2] + step[2],
    ]);
  }
  return pts;
}

export function bond(
  id: string,
  from: string,
  to: string,
  order: 1 | 2 | 3 = 1
): BondData {
  return { id, from, to, order };
}

export function atom(id: string, element: AtomData["element"], position: Vec3): AtomData {
  return { id, element, position: round3(position) };
}

function round3(p: Vec3): Vec3 {
  return [
    Math.round(p[0] * 1000) / 1000,
    Math.round(p[1] * 1000) / 1000,
    Math.round(p[2] * 1000) / 1000,
  ];
}

/** Aromatic ring bonds (6 membered) */
export function ringBonds(prefix: string, ids: string[], aromatic = true): BondData[] {
  const bonds: BondData[] = [];
  for (let i = 0; i < 6; i++) {
    const a = ids[i];
    const b = ids[(i + 1) % 6];
    bonds.push(bond(`${prefix}_r${i}`, a, b, aromatic ? (i % 2 === 0 ? 2 : 1) : 1));
  }
  return bonds;
}
