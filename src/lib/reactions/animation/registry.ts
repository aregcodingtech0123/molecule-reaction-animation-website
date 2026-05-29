import type { ReactionAnimationDefinition } from "./types";
import { REACTION_ANIMATION_DEFINITIONS } from "./reactionAnimations";

export const REACTION_ANIMATION_MAP: Record<string, ReactionAnimationDefinition> = {
  ...REACTION_ANIMATION_DEFINITIONS,
};

export function getReactionAnimation(
  reactionId: string
): ReactionAnimationDefinition | undefined {
  return REACTION_ANIMATION_MAP[reactionId];
}

export const ALL_REACTION_ANIMATIONS: ReactionAnimationDefinition[] = Object.values(
  REACTION_ANIMATION_MAP
);
