"use client";

import { useEffect } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useDeviceTier } from "@/hooks/useDeviceTier";

/** One-finger rotate, two-finger zoom/pan — page scroll stays on areas outside the canvas. */
export function applyMobileOrbitControls(controls: OrbitControlsImpl, isMobile: boolean) {
  controls.touches = {
    ONE: THREE.TOUCH.ROTATE,
    TWO: THREE.TOUCH.DOLLY_PAN,
  };

  if (isMobile) {
    controls.rotateSpeed = 0.55;
    controls.zoomSpeed = 0.75;
    controls.panSpeed = 0.65;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
  } else {
    controls.rotateSpeed = 1;
    controls.zoomSpeed = 1;
    controls.panSpeed = 1;
    controls.dampingFactor = 0.05;
  }
}

export function useOrbitControlsTouchProfile(
  controlsRef: React.RefObject<OrbitControlsImpl | null>,
) {
  const { isMobile } = useDeviceTier();

  useEffect(() => {
    let frame = 0;
    const apply = () => {
      const controls = controlsRef.current;
      if (controls) {
        applyMobileOrbitControls(controls, isMobile);
        return;
      }
      frame = requestAnimationFrame(apply);
    };
    apply();
    return () => cancelAnimationFrame(frame);
  }, [controlsRef, isMobile]);
}
