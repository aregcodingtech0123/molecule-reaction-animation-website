/**
 * Reaction catalog types for Reaction Mode.
 * 3D steps reference molecule ids from {@link MOLECULE_MAP}.
 */

export type ReactionCategory = "SYNTHESIS" | "METABOLIC" | "ACID-BASE" | "ORGANIC";

export type ReactionDifficulty = "BEGINNER" | "INTERMEDIATE" | "EXPERT";

/** Stoichiometric species row for sidebar / Quick Facts */
export interface ReactionSpecies {
  name: string;
  /** Optional display formula (Unicode subscripts) */
  formula?: string;
  count: number;
}

export interface ReactionAnimationStep {
  /** Key into molecule catalog (`MOLECULE_MAP` in data layer) */
  moleculeId: string;
  /** Short label shown during the step (e.g. "Reactants", "Products") */
  caption: string;
}

/** Quick Facts panel fields (Overview = summary) */
export interface ReactionQuickFacts {
  /** Overview */
  summary: string;
  /** Energy / thermodynamics */
  energyProfile?: string;
  /** Reaction conditions */
  conditions?: string;
  /** Mechanism description */
  mechanism?: string;
  /** Optional pull quote */
  highlight?: string;
}

/**
 * Metadata for 3D interpolation authoring.
 * `placeholder` = legacy step viewer until {@link ReactionAnimationDefinition} is registered.
 */
export interface ReactionAnimationMetadata {
  status: "ready" | "placeholder";
  /** Registry key in REACTION_ANIMATION_MAP when status is "ready" */
  animationKey?: string;
  /** Authoring note for computational chemists */
  notes?: string;
  /**
   * Element atom counts for conservation checks (all elements must balance).
   * Keys: element symbols (H, C, N, O, Cl, Na, …).
   */
  atomInventory?: {
    reactants: Partial<Record<string, number>>;
    products: Partial<Record<string, number>>;
  };
}

export interface ReactionData {
  id: string;
  name: string;
  /** Balanced equation with Unicode subscripts */
  formula: string;
  /** Alias for formula (display); kept for backward compatibility */
  equation: string;
  category: ReactionCategory;
  difficulty: ReactionDifficulty;
  reactants: ReactionSpecies[];
  products: ReactionSpecies[];
  /** Sidebar + hero blurb */
  description: string;
  /** UI accent (hex) */
  accentColor: string;
  /** Human-readable subtype (e.g. "Combustion") — shown in UI chips */
  reactionType: string;
  /** Ordered frames for legacy / fallback 3D viewer */
  steps: ReactionAnimationStep[];
  quickFacts: ReactionQuickFacts;
  /** @deprecated Use quickFacts — mirrors quickFacts for older imports */
  facts: ReactionQuickFacts;
  /** Key into REACTION_ANIMATION_MAP; defaults to `id` when omitted */
  animationId?: string;
  /** 3D coordinate mapping / engine readiness */
  animationMetadata?: ReactionAnimationMetadata;
}
