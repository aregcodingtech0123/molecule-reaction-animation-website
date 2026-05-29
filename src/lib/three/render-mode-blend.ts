import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useRenderMode, type RenderMode } from "@/context/RenderModeContext";
import { useDeviceTier } from "@/hooks/useDeviceTier";

/** ~0.4s smooth transition between render modes */
export const RENDER_MODE_TRANSITION_SECONDS = 0.4;

const DAMPING = 1 / RENDER_MODE_TRANSITION_SECONDS;

export interface RenderModeWeights {
  stick: number;
  spaceFill: number;
  esps: number;
}

function targetWeights(mode: RenderMode, espsEnabled: boolean): RenderModeWeights {
  switch (mode) {
    case "ball-and-stick":
      return { stick: 1, spaceFill: 0, esps: 0 };
    case "space-filling":
      return { stick: 0, spaceFill: 1, esps: 0 };
    case "esps":
      if (!espsEnabled) {
        return { stick: 0, spaceFill: 1, esps: 0 };
      }
      return { stick: 0, spaceFill: 0, esps: 1 };
  }
}

/**
 * Damped one-hot weights for ball-and-stick, space-filling, and ESPS modes.
 * Must be called from a component inside `<Canvas>`.
 */
export function useRenderModeWeights() {
  const { renderMode } = useRenderMode();
  const { espsEnabled } = useDeviceTier();
  const weights = useRef<RenderModeWeights>(targetWeights(renderMode, espsEnabled));

  useFrame((_, delta) => {
    const target = targetWeights(renderMode, espsEnabled);
    weights.current.stick = THREE.MathUtils.damp(
      weights.current.stick,
      target.stick,
      DAMPING,
      delta,
    );
    weights.current.spaceFill = THREE.MathUtils.damp(
      weights.current.spaceFill,
      target.spaceFill,
      DAMPING,
      delta,
    );
    weights.current.esps = THREE.MathUtils.damp(
      weights.current.esps,
      target.esps,
      DAMPING,
      delta,
    );
  });

  return weights;
}

/** Legacy helper — returns space-filling weight only (0 = ball-and-stick). */
export function useRenderModeBlend() {
  const weights = useRenderModeWeights();
  const legacy = useRef(weights.current.spaceFill);

  useFrame(() => {
    legacy.current = weights.current.spaceFill;
  });

  return legacy;
}
