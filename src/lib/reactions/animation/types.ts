import type { BondOrder, ElementSymbol } from "@/lib/molecules/types";

/** Single atom in a reaction layout (reactant or product frame) */
export interface ReactionAtomState {
  id: string;
  element: ElementSymbol;
  position: [number, number, number];
}

/** Bond in a reaction layout */
export interface ReactionBondState {
  id: string;
  from: string;
  to: string;
  order: BondOrder;
}

/**
 * One static frame of the reaction (all atoms + bonds at that stage).
 * Used for reactant and product snapshots.
 */
export interface ReactionSnapshot {
  atoms: ReactionAtomState[];
  bonds: ReactionBondState[];
}

/**
 * Atom that persists across the animation with explicit start/end coordinates.
 * `id` is stable for the whole clip (enables lerp without remounting meshes).
 */
export interface ReactionAnimationAtom {
  id: string;
  element: ElementSymbol;
  reactantPosition: [number, number, number];
  /** Dissociated / transition layout after bonds break (optional) */
  intermediatePosition?: [number, number, number];
  productPosition: [number, number, number];
}

/** Phase durations in milliseconds (break → dissociate → assemble → form) */
export interface ReactionAnimationTiming {
  breakBondsMs: number;
  /** Reactant → intermediate (defaults to ~45% of transformMs when intermediates exist) */
  dissociateMs?: number;
  /** Intermediate → product (defaults to remainder of transformMs) */
  assembleMs?: number;
  /** Single-stage move when no intermediate positions are defined */
  transformMs?: number;
  formBondsMs: number;
  /** Hold on products before onComplete (ms) */
  holdMs?: number;
}

/**
 * Full definition for the 3D reaction engine.
 * Pass a new object with the same shape for water formation, peptide synthesis, etc.
 */
export interface ReactionAnimationDefinition {
  id: string;
  atoms: ReactionAnimationAtom[];
  reactantBonds: ReactionBondState[];
  productBonds: ReactionBondState[];
  timing?: ReactionAnimationTiming;
  /** Scene scale applied to all coordinates */
  scale?: number;
}

/** Sampled state at normalized progress t ∈ [0, 1] */
export interface ReactionAnimationSample {
  /** Current world positions per atom id */
  positions: Map<string, [number, number, number]>;
  /** 0 = hidden, 1 = full visibility for reactant bonds */
  reactantBondOpacity: number;
  /** 0 = hidden, 1 = full visibility for product bonds */
  productBondOpacity: number;
  /** Which phase is active (for UI captions) */
  phase: "idle" | "breaking" | "dissociating" | "assembling" | "forming" | "complete";
  /** Normalized progress within the whole timeline */
  progress: number;
}

export const DEFAULT_REACTION_TIMING: ReactionAnimationTiming = {
  breakBondsMs: 900,
  transformMs: 2400,
  formBondsMs: 900,
  holdMs: 400,
};
