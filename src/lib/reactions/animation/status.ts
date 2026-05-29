/** UI + playback state machine for reaction animations */
export type ReactionAnimationStatus = "idle" | "playing" | "completed";

export const REACTION_ANIMATION_STATUS = {
  idle: "idle",
  playing: "playing",
  completed: "completed",
} as const satisfies Record<string, ReactionAnimationStatus>;
