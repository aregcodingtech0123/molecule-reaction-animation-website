"use client";

import { useRef, useEffect, useCallback } from "react";
import { useThree, useFrame } from "@react-three/fiber";
import { OrbitControls as DreiOrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import * as THREE from "three";
import { useFocus } from "@/context/FocusContext";
import { applyMobileOrbitControls } from "@/lib/three/orbit-touch";
import { useDeviceTier } from "@/hooks/useDeviceTier";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface CameraRigProps {
  autoRotate?: boolean;
  autoRotateSpeed?: number;
  enableZoom?: boolean;
  enablePan?: boolean;
  cameraDistance?: number;
  maxDistance?: number;
}

/** Max orbit radius — large molecules & reaction spreads need a wide zoom-out range. */
export const ORBIT_MAX_DISTANCE = 350;
export const ORBIT_MIN_DISTANCE = 0.8;
export const ORBIT_DAMPING_FACTOR = 0.05;

/**
 * Orbit camera with smooth focus transitions.
 * User zoom/pan are owned by OrbitControls except during atom focus mode.
 */
export function CameraRig({
  autoRotate = true,
  autoRotateSpeed = 0.4,
  enableZoom = true,
  enablePan = true,
  cameraDistance = 8,
  maxDistance = ORBIT_MAX_DISTANCE,
}: CameraRigProps) {
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const { camera } = useThree();
  const { focusTargetRef, focusActiveRef, focusCameraDistanceRef, isFocused } = useFocus();
  const reduceMotion = usePrefersReducedMotion();
  const { isMobile } = useDeviceTier();

  const bindControls = useCallback(
    (instance: OrbitControlsImpl | null) => {
      controlsRef.current = instance;
      if (instance) applyMobileOrbitControls(instance, isMobile);
    },
    [isMobile],
  );

  useEffect(() => {
    if (controlsRef.current) applyMobileOrbitControls(controlsRef.current, isMobile);
  }, [isMobile]);

  const defaultCameraPos = useRef(new THREE.Vector3(0, 0, cameraDistance));

  useEffect(() => {
    defaultCameraPos.current.set(0, 0, cameraDistance);
  }, [cameraDistance]);

  useFrame(() => {
    const controls = controlsRef.current;
    if (!controls) return;

    const focusing = focusActiveRef.current;

    if (focusing) {
      controls.target.lerp(focusTargetRef.current, 0.09);

      const desiredDistance = focusCameraDistanceRef.current;
      const offset = camera.position.clone().sub(controls.target);
      if (offset.lengthSq() < 1e-8) {
        offset.copy(defaultCameraPos.current);
      }
      offset.normalize().multiplyScalar(desiredDistance);

      const desiredCameraPos = controls.target.clone().add(offset);
      camera.position.lerp(desiredCameraPos, 0.07);
    }

    controls.update();
  });

  return (
    <DreiOrbitControls
      ref={bindControls}
      // No camera auto-rotate when the visitor asked for reduced motion (R14).
      autoRotate={autoRotate && !isFocused && !reduceMotion}
      autoRotateSpeed={autoRotateSpeed}
      enableZoom={enableZoom}
      enablePan={enablePan}
      minDistance={ORBIT_MIN_DISTANCE}
      maxDistance={maxDistance}
      minPolarAngle={Math.PI / 6}
      maxPolarAngle={Math.PI - Math.PI / 6}
      dampingFactor={ORBIT_DAMPING_FACTOR}
      enableDamping
      makeDefault
    />
  );
}
