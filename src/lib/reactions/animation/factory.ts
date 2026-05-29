import type {
  ReactionAnimationDefinition,
  ReactionAnimationAtom,
  ReactionBondState,
  ReactionAnimationTiming,
} from "./types";
import { centroidOfPoints, withRadialIntermediate } from "./layout";

export interface BuildReactionAnimationInput {
  id: string;
  atoms: ReactionAnimationAtom[];
  reactantBonds: ReactionBondState[];
  productBonds: ReactionBondState[];
  timing?: ReactionAnimationTiming;
  scale?: number;
  /** Auto-generate intermediate poses by radial expansion from reactant centroid */
  autoIntermediate?: boolean | { factor?: number };
}

/**
 * Plug-in helper: pass reactant/product coordinates and bond lists for any reaction.
 */
export function buildReactionAnimation(input: BuildReactionAnimationInput): ReactionAnimationDefinition {
  let atoms = input.atoms;

  if (input.autoIntermediate) {
    const factor =
      typeof input.autoIntermediate === "object" ? (input.autoIntermediate.factor ?? 1.35) : 1.35;
    const pivot = centroidOfPoints(atoms.map((a) => a.reactantPosition));
    atoms = withRadialIntermediate(atoms, pivot, factor);
  }

  return {
    id: input.id,
    atoms,
    reactantBonds: input.reactantBonds,
    productBonds: input.productBonds,
    timing: input.timing,
    scale: input.scale,
  };
}
