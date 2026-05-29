/**
 * Central registry of 3D reaction animation configurations.
 *
 * Timeline model (maps to GSAP-style sequential tweens; driven by useFrame in ReactionAnimator):
 *   1. breaking      — reactant bond opacity 1 → 0
 *   2. dissociating  — lerp(reactant → intermediate)
 *   3. assembling    — lerp(intermediate → product)
 *   4. forming       — product bond opacity 0 → 1
 *
 * Atom positions use Å-scale coordinates; scene scale applied per definition.
 * CPK colors come from ELEMENT_PROPERTIES in @/lib/molecules/elements.
 */

import type { ReactionAnimationDefinition, ReactionAnimationTiming } from "./types";
import { getTotalDurationMs, sampleReactionAnimation } from "./sampler";
import { HABER_BOSCH_ANIMATION } from "./definitions/haber-bosch";
import { PHOTOSYNTHESIS_ANIMATION } from "./definitions/photosynthesis";
import { NEUTRALIZATION_ANIMATION } from "./definitions/neutralization";
import { ESTERIFICATION_ANIMATION } from "./definitions/esterification";
import { METHANE_COMBUSTION_ANIMATION } from "./definitions/methane-combustion";
import { WATER_FORMATION_ANIMATION } from "./definitions/water-formation";
import { GLUCOSE_FERMENTATION_ANIMATION } from "./definitions/glucose-fermentation";

export { sampleReactionAnimation, getTotalDurationMs };

export const REACTION_ANIMATION_DEFINITIONS = {
  "methane-combustion": METHANE_COMBUSTION_ANIMATION,
  "water-formation": WATER_FORMATION_ANIMATION,
  "glucose-fermentation": GLUCOSE_FERMENTATION_ANIMATION,
  "haber-bosch": HABER_BOSCH_ANIMATION,
  photosynthesis: PHOTOSYNTHESIS_ANIMATION,
  "neutralization-hcl-naoh": NEUTRALIZATION_ANIMATION,
  "esterification-ethyl-acetate": ESTERIFICATION_ANIMATION,
} as const satisfies Record<string, ReactionAnimationDefinition>;

export type ReactionAnimationId = keyof typeof REACTION_ANIMATION_DEFINITIONS;

/** Default phase durations for new reactions (dissociate + assemble ≈ transformMs) */
export const DEFAULT_TIMELINE: ReactionAnimationTiming = {
  breakBondsMs: 900,
  dissociateMs: 1100,
  assembleMs: 2800,
  formBondsMs: 950,
  holdMs: 500,
  transformMs: 3900,
};

/**
 * Normalized progress helpers (GSAP `t` equivalent) for custom UI or debugging.
 */
export function reactionProgressAt(elapsedMs: number, def: ReactionAnimationDefinition) {
  return sampleReactionAnimation(def, elapsedMs);
}

export {
  HABER_BOSCH_ANIMATION,
  PHOTOSYNTHESIS_ANIMATION,
  NEUTRALIZATION_ANIMATION,
  ESTERIFICATION_ANIMATION,
};
