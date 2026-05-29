"use client";

import { useRef, useMemo, useLayoutEffect, useEffect, useCallback } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ReactionAnimationDefinition, ReactionAnimationSample } from "@/lib/reactions/animation/types";
import {
  sampleReactionAnimation,
  getTotalDurationMs,
} from "@/lib/reactions/animation/sampler";
import { getReactionCentroid, offsetPosition } from "@/lib/reactions/animation/center";
import { AnimatedAtom } from "./AnimatedAtom";
import { AnimatedBond } from "./AnimatedBond";

export interface ReactionAnimatorProps {
  definition: ReactionAnimationDefinition;
  /** Increment to start / restart playback */
  playSignal: number;
  /** Increment to snap back to reactant layout (idle) */
  resetSignal?: number;
  onComplete?: () => void;
  onPhaseChange?: (phase: ReactionAnimationSample["phase"]) => void;
  /** Gentle scene rotation while idle or playing */
  autoRotate?: boolean;
}

/**
 * R3F scene graph driven by requestAnimationFrame (via useFrame).
 * Atoms lerp between reactant/product coordinates; bond opacities fade break → form.
 */
export function ReactionAnimator({
  definition,
  playSignal,
  resetSignal = 0,
  onComplete,
  onPhaseChange,
  autoRotate = true,
}: ReactionAnimatorProps) {
  const groupRef = useRef<THREE.Group>(null);
  const positionsRef = useRef<Map<string, THREE.Vector3>>(new Map());
  const reactantBondOpacityRef = useRef(1);
  const productBondOpacityRef = useRef(0);

  const elapsedRef = useRef(0);
  const playingRef = useRef(false);
  const playSignalRef = useRef(playSignal);
  const resetSignalRef = useRef(resetSignal);
  const onCompleteRef = useRef(onComplete);
  const onPhaseRef = useRef(onPhaseChange);
  const lastPhaseRef = useRef<ReactionAnimationSample["phase"]>("idle");

  const totalMs = useMemo(() => getTotalDurationMs(definition), [definition]);
  const center = useMemo(() => getReactionCentroid(definition), [definition]);
  const renderScale = (definition.scale ?? 1) * 1.1;

  useLayoutEffect(() => {
    onCompleteRef.current = onComplete;
    onPhaseRef.current = onPhaseChange;
  }, [onComplete, onPhaseChange]);

  const applyReactantLayout = useCallback(() => {
    const map = new Map<string, THREE.Vector3>();
    for (const atom of definition.atoms) {
      const p = offsetPosition(
        [
          atom.reactantPosition[0] * (definition.scale ?? 1),
          atom.reactantPosition[1] * (definition.scale ?? 1),
          atom.reactantPosition[2] * (definition.scale ?? 1),
        ],
        center,
      );
      map.set(atom.id, new THREE.Vector3(...p));
    }
    positionsRef.current = map;
    reactantBondOpacityRef.current = 1;
    productBondOpacityRef.current = 0;
  }, [definition, center]);

  const snapToIdle = useCallback(() => {
    applyReactantLayout();
    elapsedRef.current = 0;
    playingRef.current = false;
    if (lastPhaseRef.current !== "idle") {
      lastPhaseRef.current = "idle";
      onPhaseRef.current?.("idle");
    }
  }, [applyReactantLayout]);

  useEffect(() => {
    snapToIdle();
  }, [snapToIdle]);

  useLayoutEffect(() => {
    if (resetSignal <= 0) {
      resetSignalRef.current = 0;
      return;
    }
    if (resetSignal === resetSignalRef.current) return;
    resetSignalRef.current = resetSignal;
    snapToIdle();
  }, [resetSignal, snapToIdle]);

  useLayoutEffect(() => {
    if (playSignal <= 0) {
      playSignalRef.current = 0;
      return;
    }
    if (playSignal === playSignalRef.current) return;
    playSignalRef.current = playSignal;
    applyReactantLayout();
    elapsedRef.current = 0;
    playingRef.current = true;
    lastPhaseRef.current = "breaking";
    onPhaseRef.current?.("breaking");
  }, [playSignal, applyReactantLayout]);

  useFrame((state, delta) => {
    if (autoRotate && groupRef.current) {
      groupRef.current.rotation.y += 0.0012;
      if (!playingRef.current) {
        groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.08;
      }
    }

    if (!playingRef.current) return;

    elapsedRef.current += delta * 1000;
    const sample = sampleReactionAnimation(definition, elapsedRef.current);

    // Apply centroid offset to sampled positions
    for (const atom of definition.atoms) {
      const raw = sample.positions.get(atom.id);
      const vec = positionsRef.current.get(atom.id);
      if (raw && vec) {
        const centered = offsetPosition(raw, center);
        vec.set(centered[0], centered[1], centered[2]);
      }
    }

    reactantBondOpacityRef.current = sample.reactantBondOpacity;
    productBondOpacityRef.current = sample.productBondOpacity;

    if (sample.phase !== lastPhaseRef.current) {
      lastPhaseRef.current = sample.phase;
      onPhaseRef.current?.(sample.phase);
    }

    if (elapsedRef.current >= totalMs) {
      playingRef.current = false;
      if (lastPhaseRef.current !== "complete") {
        lastPhaseRef.current = "complete";
        onPhaseRef.current?.("complete");
      }
      onCompleteRef.current?.();
    }
  });

  return (
    <group ref={groupRef}>
      {definition.reactantBonds.map((bond) => (
        <AnimatedBond
          key={bond.id}
          fromId={bond.from}
          toId={bond.to}
          order={bond.order}
          positionsRef={positionsRef}
          opacityRef={reactantBondOpacityRef}
          scale={renderScale}
        />
      ))}
      {definition.productBonds.map((bond) => (
        <AnimatedBond
          key={bond.id}
          fromId={bond.from}
          toId={bond.to}
          order={bond.order}
          positionsRef={positionsRef}
          opacityRef={productBondOpacityRef}
          scale={renderScale}
        />
      ))}
      {definition.atoms.map((atom) => (
        <AnimatedAtom
          key={atom.id}
          id={atom.id}
          element={atom.element}
          positionsRef={positionsRef}
          scale={renderScale}
        />
      ))}
    </group>
  );
}
