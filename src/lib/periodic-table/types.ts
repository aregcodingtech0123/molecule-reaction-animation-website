export type ElementCategory =
  | "alkali-metal"
  | "alkaline-earth-metal"
  | "transition-metal"
  | "post-transition-metal"
  | "metalloid"
  | "nonmetal"
  | "halogen"
  | "noble-gas"
  | "lanthanide"
  | "actinide"
  | "unknown";

export interface GridPosition {
  row: number;
  col: number;
}

/**
 * What `atomicMass` is: a standard atomic weight (u), or - for the elements with no stable isotope (Z = 43, 61,
 * 84-89 and 93-118) and therefore no standard atomic weight - the mass number of a long-lived isotope (SEO-19).
 */
export type AtomicMassKind = "standard-weight" | "mass-number";

export interface ChemicalElement {
  atomicNumber: number;
  symbol: string;
  name: string;
  atomicMass: number;
  atomicMassKind: AtomicMassKind;
  category: ElementCategory;
  description: string;
  grid: GridPosition;
  period: number;
  group: number | null;
}

export interface CategoryStyle {
  label: string;
  cell: string;
  cellHover: string;
  cellActive: string;
  orbit: string;
  badge: string;
}
