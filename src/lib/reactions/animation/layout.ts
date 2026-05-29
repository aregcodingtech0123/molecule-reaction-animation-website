import type { ReactionAnimationAtom } from "./types";

export function atomIntermediate(atom: ReactionAnimationAtom): [number, number, number] {
  return atom.intermediatePosition ?? atom.reactantPosition;
}

/** Expand atoms radially from a pivot (intermediate / dissociation pose) */
export function radialExpand(
  position: [number, number, number],
  pivot: [number, number, number],
  factor: number
): [number, number, number] {
  return [
    pivot[0] + (position[0] - pivot[0]) * factor,
    pivot[1] + (position[1] - pivot[1]) * factor,
    pivot[2] + (position[2] - pivot[2]) * factor,
  ];
}

export function centroidOfPoints(points: [number, number, number][]): [number, number, number] {
  const n = points.length || 1;
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p[0];
    y += p[1];
    z += p[2];
  }
  return [x / n, y / n, z / n];
}

/** Apply radial expansion intermediate to every atom from its reactant pose */
export function withRadialIntermediate(
  atoms: ReactionAnimationAtom[],
  pivot: [number, number, number],
  factor = 1.35
): ReactionAnimationAtom[] {
  return atoms.map((a) => ({
    ...a,
    intermediatePosition: radialExpand(a.reactantPosition, pivot, factor),
  }));
}

/** Trigonal pyramidal NH₃ around nitrogen (~107° H–N–H) */
export function nh3Cluster(
  nitrogen: [number, number, number],
  spread = 1.0
): { N: [number, number, number]; H1: [number, number, number]; H2: [number, number, number]; H3: [number, number, number] } {
  const [x, y, z] = nitrogen;
  const h = spread;
  return {
    N: nitrogen,
    H1: [x + h * 0.95, y + 0.15, z + 0.35],
    H2: [x - 0.48, y + 0.82, z - 0.28],
    H3: [x - 0.48, y - 0.95, z + 0.12],
  };
}

/** Linear O₂ (double bond) */
export function o2Cluster(
  center: [number, number, number],
  halfGap = 0.58
): { O1: [number, number, number]; O2: [number, number, number] } {
  return {
    O1: [center[0] - halfGap, center[1], center[2]],
    O2: [center[0] + halfGap, center[1], center[2]],
  };
}

/** Linear CO₂ */
export function co2Cluster(
  center: [number, number, number],
  halfGap = 1.16
): { C: [number, number, number]; O1: [number, number, number]; O2: [number, number, number] } {
  return {
    C: center,
    O1: [center[0] - halfGap, center[1], center[2]],
    O2: [center[0] + halfGap, center[1], center[2]],
  };
}

/** H₂ dimer */
export function h2Cluster(
  center: [number, number, number],
  halfGap = 0.37
): { H1: [number, number, number]; H2: [number, number, number] } {
  return {
    H1: [center[0] - halfGap, center[1], center[2]],
    H2: [center[0] + halfGap, center[1], center[2]],
  };
}

/** Bent H₂O geometry around oxygen (approx. 104.5°) */
export function waterCluster(
  oxygen: [number, number, number],
  spread = 0.96,
  angleDeg = 104.5
): { O: [number, number, number]; H1: [number, number, number]; H2: [number, number, number] } {
  const rad = (angleDeg * Math.PI) / 180;
  const half = rad / 2;
  return {
    O: oxygen,
    H1: [oxygen[0] - spread * Math.sin(half), oxygen[1] + spread * Math.cos(half), oxygen[2] + 0.12],
    H2: [oxygen[0] + spread * Math.sin(half), oxygen[1] + spread * Math.cos(half), oxygen[2] - 0.12],
  };
}
