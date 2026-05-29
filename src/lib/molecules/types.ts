// ─────────────────────────────────────────────────────────────
// Molecule Data Types
// Core interfaces for the molecule rendering engine
// ─────────────────────────────────────────────────────────────

/** Supported chemical element symbols */
export type ElementSymbol =
  | "H" | "C" | "N" | "O" | "S" | "P"
  | "F" | "Cl" | "Br" | "I"
  | "Fe" | "Ca" | "Na" | "K" | "Mg" | "Zn";

/** Bond order between atoms */
export type BondOrder = 1 | 2 | 3;

/** Atom definition within a molecule */
export interface AtomData {
  id: string;
  element: ElementSymbol;
  position: [number, number, number];
  label?: string;
}

/** Bond connection between two atoms */
export interface BondData {
  id: string;
  from: string;   // atom id
  to: string;     // atom id
  order: BondOrder;
}

/** Educational metadata for a molecule */
export interface MoleculeEducation {
  molecularWeight: string;         // e.g. "18.015 g/mol"
  boilingPoint?: string;
  meltingPoint?: string;
  state: "solid" | "liquid" | "gas" | "plasma";
  bondTypes: string[];             // e.g. ["Covalent", "Polar"]
  uses: string[];                  // Real-world applications
  funFacts: string[];              // 2–3 interesting facts
  color: string;                   // accent color for the card
}

/** Complete molecule definition */
export interface MoleculeData {
  id: string;
  name: string;
  formula: string;
  description: string;
  category: MoleculeCategory;
  atoms: AtomData[];
  bonds: BondData[];
  education?: MoleculeEducation;
  /** Discipline badge for explorer UI (e.g. NEUROSCIENCE, MEDICINE) */
  disciplineTag?: string;
  /** Optional external 3D source when atoms are stubs */
  modelPath?: string | null;
}

/** Categories for molecule filtering */
export type MoleculeCategory =
  | "simple"
  | "organic"
  | "biological"
  | "inorganic"
  | "macro";

/** Per-element visual properties */
export interface ElementProperties {
  color: string;
  emissive: string;
  /** Ball-and-stick display radius (scene units, ~Å) */
  radius: number;
  /** Van der Waals radius in the same units as atom positions */
  vdwRadius: number;
  name: string;
  atomicNumber: number;
}

/** Map of element symbols to their visual properties */
export type ElementMap = Record<ElementSymbol, ElementProperties>;
