import type {
  ReactionAnimationDefinition,
  ReactionAnimationSample,
  ReactionAnimationTiming,
  ReactionAtomState,
  ReactionAnimationAtom,
} from "./types";
import { DEFAULT_REACTION_TIMING } from "./types";
import { easeInOutCubic, lerp3, smoothstep } from "./easing";
import { atomIntermediate } from "./layout";

function resolveTiming(def: ReactionAnimationDefinition): Required<
  Pick<ReactionAnimationTiming, "breakBondsMs" | "formBondsMs" | "holdMs">
> & {
  dissociateMs: number;
  assembleMs: number;
} {
  const base = { ...DEFAULT_REACTION_TIMING, ...def.timing };
  const usesIntermediate = def.atoms.some(
    (a) =>
      a.intermediatePosition != null &&
      !positionsEqual(a.reactantPosition, a.intermediatePosition)
  );
  const transformTotal = base.transformMs ?? 2400;

  if (usesIntermediate) {
    const dissociateMs = base.dissociateMs ?? Math.round(transformTotal * 0.42);
    const assembleMs = base.assembleMs ?? transformTotal - dissociateMs;
    return {
      breakBondsMs: base.breakBondsMs,
      dissociateMs,
      assembleMs,
      formBondsMs: base.formBondsMs,
      holdMs: base.holdMs ?? 400,
    };
  }

  return {
    breakBondsMs: base.breakBondsMs,
    dissociateMs: 0,
    assembleMs: transformTotal,
    formBondsMs: base.formBondsMs,
    holdMs: base.holdMs ?? 400,
  };
}

function positionsEqual(
  a: [number, number, number],
  b: [number, number, number],
  eps = 1e-6
): boolean {
  return (
    Math.abs(a[0] - b[0]) < eps &&
    Math.abs(a[1] - b[1]) < eps &&
    Math.abs(a[2] - b[2]) < eps
  );
}

function positionAtPhase(
  atom: ReactionAnimationAtom,
  scale: number,
  phase: "reactant" | "dissociate" | "assemble",
  u: number
): [number, number, number] {
  const r = scalePoint(atom.reactantPosition, scale);
  const i = scalePoint(atomIntermediate(atom), scale);
  const p = scalePoint(atom.productPosition, scale);

  if (phase === "reactant") return r;
  if (phase === "dissociate") return lerp3(r, i, easeInOutCubic(u));
  return lerp3(i, p, easeInOutCubic(u));
}

export function getTotalDurationMs(def: ReactionAnimationDefinition): number {
  const t = resolveTiming(def);
  return t.breakBondsMs + t.dissociateMs + t.assembleMs + t.formBondsMs + t.holdMs;
}

/**
 * Three-step motion model:
 *   1. breaking     — reactant coords, reactant bonds fade out
 *   2. dissociating — lerp reactant → intermediate (H₂/O₂ spread apart)
 *   3. assembling   — lerp intermediate → product (V-shaped H₂O)
 *   4. forming      — product bonds fade in
 */
export function sampleReactionAnimation(
  def: ReactionAnimationDefinition,
  elapsedMs: number
): ReactionAnimationSample {
  const timing = resolveTiming(def);
  const scale = def.scale ?? 1;
  const breakEnd = timing.breakBondsMs;
  const dissociateEnd = breakEnd + timing.dissociateMs;
  const assembleEnd = dissociateEnd + timing.assembleMs;
  const formEnd = assembleEnd + timing.formBondsMs;
  const total = formEnd + timing.holdMs;

  const positions = new Map<string, [number, number, number]>();

  let phase: ReactionAnimationSample["phase"] = "idle";
  let reactantBondOpacity = 1;
  let productBondOpacity = 0;
  let progress = 0;

  if (elapsedMs <= 0) {
    for (const atom of def.atoms) {
      positions.set(atom.id, scalePoint(atom.reactantPosition, scale));
    }
    return {
      positions,
      reactantBondOpacity: 1,
      productBondOpacity: 0,
      phase: "idle",
      progress: 0,
    };
  }

  progress = Math.min(1, elapsedMs / total);

  if (elapsedMs < breakEnd) {
    phase = "breaking";
    const u = smoothstep(elapsedMs / breakEnd);
    reactantBondOpacity = 1 - u;
    productBondOpacity = 0;
    for (const atom of def.atoms) {
      positions.set(atom.id, scalePoint(atom.reactantPosition, scale));
    }
  } else if (elapsedMs < dissociateEnd) {
    phase = "dissociating";
    reactantBondOpacity = 0;
    productBondOpacity = 0;
    const u = timing.dissociateMs > 0 ? (elapsedMs - breakEnd) / timing.dissociateMs : 1;
    for (const atom of def.atoms) {
      positions.set(
        atom.id,
        positionAtPhase(atom, scale, timing.dissociateMs > 0 ? "dissociate" : "assemble", u)
      );
    }
  } else if (elapsedMs < assembleEnd) {
    phase = "assembling";
    reactantBondOpacity = 0;
    productBondOpacity = 0;
    const u = (elapsedMs - dissociateEnd) / timing.assembleMs;
    for (const atom of def.atoms) {
      positions.set(atom.id, positionAtPhase(atom, scale, "assemble", u));
    }
  } else if (elapsedMs < formEnd) {
    phase = "forming";
    reactantBondOpacity = 0;
    const u = smoothstep((elapsedMs - assembleEnd) / timing.formBondsMs);
    productBondOpacity = u;
    for (const atom of def.atoms) {
      positions.set(atom.id, scalePoint(atom.productPosition, scale));
    }
  } else {
    phase = "complete";
    reactantBondOpacity = 0;
    productBondOpacity = 1;
    for (const atom of def.atoms) {
      positions.set(atom.id, scalePoint(atom.productPosition, scale));
    }
  }

  return {
    positions,
    reactantBondOpacity,
    productBondOpacity,
    phase,
    progress,
  };
}

function scalePoint(p: [number, number, number], s: number): [number, number, number] {
  return [p[0] * s, p[1] * s, p[2] * s];
}

/** Build snapshots from a definition (for docs / future editors) */
export function buildSnapshotsFromDefinition(def: ReactionAnimationDefinition): {
  reactants: { atoms: ReactionAtomState[]; bonds: typeof def.reactantBonds };
  products: { atoms: ReactionAtomState[]; bonds: typeof def.productBonds };
  intermediate: { atoms: ReactionAtomState[] };
} {
  return {
    reactants: {
      atoms: def.atoms.map((a) => ({
        id: a.id,
        element: a.element,
        position: a.reactantPosition,
      })),
      bonds: def.reactantBonds,
    },
    intermediate: {
      atoms: def.atoms.map((a) => ({
        id: a.id,
        element: a.element,
        position: atomIntermediate(a),
      })),
    },
    products: {
      atoms: def.atoms.map((a) => ({
        id: a.id,
        element: a.element,
        position: a.productPosition,
      })),
      bonds: def.productBonds,
    },
  };
}
