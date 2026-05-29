import type { AtomData, ElementSymbol, MoleculeData } from "@/lib/molecules/types";
import { ELEMENT_PROPERTIES } from "@/lib/molecules/elements";
import { getElementName } from "@/lib/i18n/localize";
import type { TranslationDictionary } from "@/lib/i18n/types";

export interface AtomFocusFacts {
  elementLabel: string;
  hybridization: string;
  bondCount: number;
  atomicNumber: number;
  radiusAngstrom: number;
}

export function countAtomBonds(atomId: string, molecule: MoleculeData): number {
  return molecule.bonds.filter((b) => b.from === atomId || b.to === atomId).length;
}

/** Heuristic hybridization from element + bond count (educational mock). */
export function predictHybridization(
  element: ElementSymbol,
  bondCount: number,
): string {
  if (element === "H") return "s";
  if (bondCount <= 0) return "—";
  if (bondCount === 1) return "sp";
  if (bondCount === 2) return "sp";
  if (bondCount === 3) return "sp2";
  return "sp3";
}

export function getAtomFocusFacts(
  atom: AtomData,
  molecule: MoleculeData,
  t: TranslationDictionary,
): AtomFocusFacts {
  const props = ELEMENT_PROPERTIES[atom.element] ?? ELEMENT_PROPERTIES.C;
  const bondCount = countAtomBonds(atom.id, molecule);

  return {
    elementLabel: getElementName(atom.element, t),
    hybridization: predictHybridization(atom.element, bondCount),
    bondCount,
    atomicNumber: props.atomicNumber,
    radiusAngstrom: props.radius,
  };
}

/** Scene units: pull camera close enough to inspect without clipping the sphere. */
export function computeFocusCameraDistance(
  element: ElementSymbol,
  sceneScale: number,
): number {
  const props = ELEMENT_PROPERTIES[element] ?? ELEMENT_PROPERTIES.C;
  const sphereRadius = props.vdwRadius * sceneScale;
  return Math.max(1.8, Math.min(5.5, sphereRadius * 3.2));
}
