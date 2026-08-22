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

export interface ChemicalElement {
  atomicNumber: number;
  symbol: string;
  name: string;
  atomicMass: number;
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
