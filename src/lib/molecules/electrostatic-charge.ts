import * as THREE from "three";
import type { AtomData, ElementSymbol, MoleculeData } from "./types";

/** Pauling electronegativity (approximate partial-charge proxy). */
const ELECTRONEGATIVITY: Record<ElementSymbol, number> = {
  H: 2.2,
  C: 2.55,
  N: 3.04,
  O: 3.44,
  S: 2.58,
  P: 2.19,
  F: 3.98,
  Cl: 3.16,
  Br: 2.96,
  I: 2.66,
  Fe: 1.83,
  Ca: 1.0,
  Na: 0.93,
  K: 0.82,
  Mg: 1.31,
  Zn: 1.65,
};

const ESPS_RED = new THREE.Color("#ef4444");
const ESPS_BLUE = new THREE.Color("#3b82f6");
const ESPS_NEUTRAL = new THREE.Color("#a8d5ba");

export const ESPS_HULL_SCALE = 1.2;

function neighborElements(atomId: string, molecule: MoleculeData): ElementSymbol[] {
  const out: ElementSymbol[] = [];
  for (const bond of molecule.bonds) {
    if (bond.from === atomId) {
      const n = molecule.atoms.find((a) => a.id === bond.to);
      if (n) out.push(n.element);
    } else if (bond.to === atomId) {
      const n = molecule.atoms.find((a) => a.id === bond.from);
      if (n) out.push(n.element);
    }
  }
  return out;
}

/**
 * Heuristic partial charge for ESPS coloring (not QM-accurate).
 * Negative = electron-rich (red), positive = electron-poor (blue).
 */
export function getAtomPartialCharge(atom: AtomData, molecule: MoleculeData): number {
  const en = ELECTRONEGATIVITY[atom.element] ?? 2.5;
  const neighbors = neighborElements(atom.id, molecule);

  if (atom.element === "H") {
    const maxNeighborEn = neighbors.reduce(
      (max, sym) => Math.max(max, ELECTRONEGATIVITY[sym] ?? 2.5),
      0,
    );
    if (maxNeighborEn >= 3.0) return 0.35;
    if (maxNeighborEn >= 2.5) return 0.12;
    return 0.05;
  }

  if (atom.element === "O" || atom.element === "N" || atom.element === "F") {
    return -0.45 - Math.max(0, en - 3.0) * 0.25;
  }

  if (atom.element === "Cl" || atom.element === "Br" || atom.element === "I") {
    return -0.35;
  }

  if (atom.element === "Na" || atom.element === "K" || atom.element === "Ca") {
    return 0.55;
  }

  if (atom.element === "Mg" || atom.element === "Fe" || atom.element === "Zn") {
    return 0.42;
  }

  if (atom.element === "C") {
    const allHydrocarbon = neighbors.every((sym) => sym === "C" || sym === "H");
    const hasPolar = neighbors.some((sym) => (ELECTRONEGATIVITY[sym] ?? 2.5) >= 3.0);
    if (allHydrocarbon && neighbors.length > 0) return 0;
    if (hasPolar) return -0.08;
    return 0.02;
  }

  return (2.55 - en) * 0.12;
}

export function chargeToEspsColor(charge: number): THREE.Color {
  const magnitude = Math.abs(charge);
  if (magnitude < 0.07) return ESPS_NEUTRAL.clone();

  if (charge < 0) {
    const t = Math.min(1, magnitude / 0.45);
    return ESPS_NEUTRAL.clone().lerp(ESPS_RED, t);
  }

  const t = Math.min(1, magnitude / 0.45);
  return ESPS_NEUTRAL.clone().lerp(ESPS_BLUE, t);
}

export function getEspsHullColor(atom: AtomData, molecule: MoleculeData): THREE.Color {
  return chargeToEspsColor(getAtomPartialCharge(atom, molecule));
}
