"use client";

import { useEffect, useState } from "react";

/** Aligns with Tailwind `lg` — tablets use mobile canvas tier unless wide + fine pointer. */
export const MOBILE_LAYOUT_MAX_WIDTH = 1024;

export interface DeviceTier {
  /** Narrow viewport and/or coarse primary pointer */
  isMobile: boolean;
  isCoarsePointer: boolean;
  /** Clamped device pixel ratio for `<Canvas dpr={…}>` */
  dpr: [number, number];
  /** Sphere geometry width/height segments for atoms */
  sphereSegments: number;
  /** ESPS hulls + transmission shaders */
  espsEnabled: boolean;
  /** Invisible pick-proxy radius multiplier (visual size unchanged) */
  atomHitScale: number;
  /** Reduce segments further for large molecules (e.g. C60) */
  simplifyLargeMolecules: boolean;
  largeMoleculeAtomThreshold: number;
}

const DESKTOP_TIER: DeviceTier = {
  isMobile: false,
  isCoarsePointer: false,
  dpr: [1, 2],
  sphereSegments: 48,
  espsEnabled: true,
  atomHitScale: 1.15,
  simplifyLargeMolecules: false,
  largeMoleculeAtomThreshold: 999,
};

function readDeviceTier(): DeviceTier {
  if (typeof window === "undefined") {
    return DESKTOP_TIER;
  }

  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.innerWidth < MOBILE_LAYOUT_MAX_WIDTH;
  const isMobile = narrow || coarse;

  if (!isMobile) {
    return DESKTOP_TIER;
  }

  return {
    isMobile: true,
    isCoarsePointer: coarse,
    dpr: [1, 1.5],
    sphereSegments: 24,
    espsEnabled: false,
    atomHitScale: 1.9,
    simplifyLargeMolecules: true,
    largeMoleculeAtomThreshold: 30,
  };
}

export function useDeviceTier(): DeviceTier {
  /** Always start with desktop tier so SSR and the first client render match (avoids hydration mismatch). */
  const [tier, setTier] = useState<DeviceTier>(DESKTOP_TIER);

  useEffect(() => {
    const sync = () => setTier(readDeviceTier());
    sync();
    window.addEventListener("resize", sync);
    const coarseMq = window.matchMedia("(pointer: coarse)");
    coarseMq.addEventListener("change", sync);
    return () => {
      window.removeEventListener("resize", sync);
      coarseMq.removeEventListener("change", sync);
    };
  }, []);

  return tier;
}

/** Atom sphere segments for a given molecule size + device tier. */
export function resolveSphereSegments(tier: DeviceTier, atomCount: number): number {
  if (tier.simplifyLargeMolecules && atomCount >= tier.largeMoleculeAtomThreshold) {
    return Math.min(16, tier.sphereSegments);
  }
  return tier.sphereSegments;
}
