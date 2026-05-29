"use client";

import { useEffect } from "react";
import { useThree } from "@react-three/fiber";
import { useDeviceTier } from "@/hooks/useDeviceTier";

/**
 * Widens line/point raycast thresholds on touch devices.
 * Atom picking is primarily handled by invisible proxy spheres in AtomSphere.
 */
export function CanvasRaycasterConfig() {
  const { raycaster } = useThree();
  const { isMobile } = useDeviceTier();

  useEffect(() => {
    raycaster.params.Line = { threshold: isMobile ? 0.12 : 0.02 };
    raycaster.params.Points = { threshold: isMobile ? 0.15 : 0.05 };
  }, [raycaster, isMobile]);

  return null;
}
