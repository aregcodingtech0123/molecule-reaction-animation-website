import type { ReactionAnimationDefinition } from "./types";
import { atomIntermediate } from "./layout";

/** Centroid across reactant, intermediate, and product poses — keeps the whole clip framed */
export function getReactionCentroid(def: ReactionAnimationDefinition): [number, number, number] {
  const s = def.scale ?? 1;
  let x = 0;
  let y = 0;
  let z = 0;
  let n = 0;

  for (const a of def.atoms) {
    for (const p of [a.reactantPosition, atomIntermediate(a), a.productPosition]) {
      x += p[0] * s;
      y += p[1] * s;
      z += p[2] * s;
      n += 1;
    }
  }

  return [x / (n || 1), y / (n || 1), z / (n || 1)];
}

export function offsetPosition(
  p: [number, number, number],
  center: [number, number, number]
): [number, number, number] {
  return [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
}

/** Max distance from centroid across all animation poses (Å, scaled). */
export function getReactionBoundsRadius(def: ReactionAnimationDefinition): number {
  const s = def.scale ?? 1;
  const center = getReactionCentroid(def);
  let maxR = 0;

  for (const a of def.atoms) {
    for (const p of [a.reactantPosition, atomIntermediate(a), a.productPosition]) {
      const dx = p[0] * s - center[0];
      const dy = p[1] * s - center[1];
      const dz = p[2] * s - center[2];
      maxR = Math.max(maxR, Math.hypot(dx, dy, dz));
    }
  }

  return maxR;
}

/** Suggested default orbit distance to frame the full reaction spread. */
export function getReactionCameraDistance(def: ReactionAnimationDefinition): number {
  const radius = getReactionBoundsRadius(def);
  return Math.max(14, radius * 3.2);
}
