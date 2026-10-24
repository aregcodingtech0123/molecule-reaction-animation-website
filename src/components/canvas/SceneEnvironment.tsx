"use client";

import { Component, Suspense, useEffect, useState, type ReactNode } from "react";
import { Environment } from "@react-three/drei";
import { EquirectangularReflectionMapping, LinearSRGBColorSpace, type DataTexture } from "three";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";

/**
 * Self-hosted environment maps (FINDING-31). `<Environment preset>` used to
 * download them at runtime from a third-party CDN, so a CDN outage, an offline
 * classroom or a strict CSP crashed every 3D page — and the whole AI Lab.
 *
 * Files: the drei presets "city" and "studio", copied unchanged from
 * pmndrs/drei-assets@456060a26bbeb8fdf79326f224b6d99b8bcce736/hdri (Poly Haven, CC0).
 *   potsdamer_platz_1k.hdr  sha256 7afe4c2f9700ee78c7477c53fa355463d7dda1fdede401432d6b5f9ff0a95696
 *   studio_small_03_1k.hdr  sha256 29267a4aa8c10de26cae758e4e3c4daadde88673798666ad657724bab7224a35
 */
export const ENVIRONMENT_FILES = {
  city: "/hdri/potsdamer_platz_1k.hdr",
  studio: "/hdri/studio_small_03_1k.hdr",
} as const;

export type EnvironmentName = keyof typeof ENVIRONMENT_FILES;

/**
 * Loads the map outside React's suspend/throw path. R3F reports even errors an
 * error boundary caught as uncaught page errors (its root's onCaughtError is
 * window.reportError), so a missing map must never become a thrown error: it
 * resolves to null and the scene renders without environment lighting.
 */
function useEnvironmentTexture(url: string): DataTexture | null {
  const [texture, setTexture] = useState<DataTexture | null>(null);

  useEffect(() => {
    let cancelled = false;
    let loaded: DataTexture | null = null;
    new HDRLoader().load(
      url,
      (result) => {
        result.mapping = EquirectangularReflectionMapping;
        result.colorSpace = LinearSRGBColorSpace;
        loaded = result;
        if (cancelled) result.dispose();
        else setTexture(result);
      },
      undefined,
      (error) => {
        if (cancelled) return;
        console.warn(
          `[scene] Environment map ${url} unavailable — rendering without it.`,
          error instanceof Error ? error.message : error,
        );
      },
    );
    return () => {
      cancelled = true;
      loaded?.dispose();
      setTexture(null);
    };
  }, [url]);

  return texture;
}

/** Backstop: environment lighting is decoration and must never take the scene down. */
class EnvironmentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.warn(
      "[scene] Environment failed — rendering without it.",
      error instanceof Error ? error.message : error,
    );
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function SceneEnvironment({ name, intensity }: { name: EnvironmentName; intensity: number }) {
  const texture = useEnvironmentTexture(ENVIRONMENT_FILES[name]);
  if (!texture) return null;
  return (
    // Keyed by map: switching theme retries a map that failed earlier.
    <EnvironmentBoundary key={name}>
      <Suspense fallback={null}>
        <Environment map={texture} environmentIntensity={intensity} />
      </Suspense>
    </EnvironmentBoundary>
  );
}
