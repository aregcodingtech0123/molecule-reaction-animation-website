"use client";

import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Pass } from "postprocessing";
import type { Texture, WebGLRenderer } from "three";

/** Frames to look for the shared texture before giving up (scenes without lit materials never use it). */
const LUT_SEARCH_FRAMES = 120;

type LutUniforms = { uniforms?: { dfgLUT?: { value?: Texture } } };

/**
 * Releases a disposed canvas's renderer for real (PERF-27). Place inside every R3F `<Canvas>`.
 *
 * Two module-level GPU resources are shared by every WebGLRenderer, and each renderer that uploads one adds a
 * `dispose` listener to it: three 0.184's "DFG_LUT" texture (physically based materials) and postprocessing's
 * full-screen triangle (`Pass.fullscreenGeometry`, the EffectComposer). R3F's unmount forces a context loss but
 * never calls `renderer.dispose()`, and nothing disposes the shared resources — so each listener kept its old
 * renderer alive: its property table with the environment maps (~4 MiB of ArrayBuffers per 3D page visit) and,
 * through the WebGL context, the unmounted page's canvas and DOM. Measured to grow without bound.
 *
 * On a real unmount this disposes both shared resources once (which runs every renderer's listener, removing
 * all of them; live renderers re-upload them on their next frame — postprocessing's own EffectComposer.dispose
 * does the same) and then the renderer itself.
 */
export function CanvasRendererRelease() {
  const gl = useThree((state) => state.gl);
  const scene = useThree((state) => state.scene);
  const lut = useRef<Texture | null>(null);
  const framesLeft = useRef(LUT_SEARCH_FRAMES);

  useFrame(() => {
    if (lut.current || framesLeft.current <= 0) return;
    framesLeft.current -= 1;
    lut.current = findSharedLut(gl, scene);
  });

  useEffect(() => {
    return () => {
      // React StrictMode (development) runs this cleanup once while the canvas stays mounted: release only
      // when the canvas has really left the document.
      setTimeout(() => {
        if (gl.domElement.isConnected) return;
        releaseRenderer(gl, [lut.current, sharedFullscreenGeometry()]);
      }, 0);
    };
  }, [gl]);

  return null;
}

/**
 * postprocessing 6.x's shared full-screen triangle. It is marked @internal (not in the type definitions); read
 * defensively so a version without it only skips this step.
 */
function sharedFullscreenGeometry(): { dispose(): void } | null {
  return (Pass as unknown as { fullscreenGeometry?: { dispose(): void } }).fullscreenGeometry ?? null;
}

/** The shared DFG lookup texture, read from any compiled lit material's uniforms (three does not export it). */
export function findSharedLut(gl: Pick<WebGLRenderer, "properties">, scene: { traverse: (fn: (o: unknown) => void) => void }): Texture | null {
  let found: Texture | null = null;
  scene.traverse((object) => {
    if (found) return;
    const material = (object as { material?: unknown }).material;
    for (const m of Array.isArray(material) ? material : material ? [material] : []) {
      const value = (gl.properties.get(m as object) as LutUniforms).uniforms?.dfgLUT?.value;
      if (value) {
        found = value;
        return;
      }
    }
  });
  return found;
}

/** Disposes the shared resources (once each, clearing every renderer's listener on them), then the renderer. */
export function releaseRenderer(gl: Pick<WebGLRenderer, "dispose">, shared: Array<{ dispose(): void } | null>): void {
  for (const resource of shared) resource?.dispose();
  gl.dispose();
}
