/**
 * PERF-27: a disposed 3D canvas must release its renderer. Shared module-level resources (three's DFG lookup
 * texture, postprocessing's full-screen triangle) collect one `dispose` listener per WebGLRenderer; disposing them
 * once removes them all, then the renderer is disposed.
 * (The component itself mounts inside R3F's <Canvas>, which unit tests replace with an inert div; the leak is
 * measured end to end by `node scripts/perf/run.mjs runtime` step 10.)
 */
import { describe, expect, it, vi } from "vitest";
import { BufferGeometry, DataTexture, Mesh, MeshBasicMaterial, MeshStandardMaterial, Scene } from "three";
import { findSharedLut, releaseRenderer } from "@/components/canvas/CanvasRendererRelease";

function fakeRenderer(uniformsFor: Map<object, unknown>) {
  return { properties: { get: (object: object) => uniformsFor.get(object) ?? {} } };
}

describe("CanvasRendererRelease", () => {
  it("finds the shared lookup texture through a compiled lit material's uniforms", () => {
    const scene = new Scene();
    const plain = new Mesh(undefined, new MeshBasicMaterial());
    const lit = new Mesh(undefined, new MeshStandardMaterial());
    scene.add(plain, lit);
    const lut = new DataTexture();
    const gl = fakeRenderer(new Map<object, unknown>([[lit.material, { uniforms: { dfgLUT: { value: lut } } }]]));
    expect(findSharedLut(gl as never, scene)).toBe(lut);
  });

  it("returns null when no material uses it (a scene without lit materials)", () => {
    const scene = new Scene();
    scene.add(new Mesh(undefined, new MeshBasicMaterial()));
    expect(findSharedLut(fakeRenderer(new Map()) as never, scene)).toBeNull();
  });

  it("disposing the shared resources runs and removes every renderer's dispose listener", () => {
    const lut = new DataTexture();
    const triangle = new BufferGeometry();
    const calls = { lut: 0, triangle: 0 };
    // What each WebGLRenderer's texture / geometry manager does: remove itself when the resource is disposed.
    for (let renderer = 0; renderer < 3; renderer++) {
      for (const [resource, key] of [[lut, "lut"], [triangle, "triangle"]] as const) {
        const handler = () => {
          calls[key] += 1;
          resource.removeEventListener("dispose", handler);
        };
        resource.addEventListener("dispose", handler);
      }
    }
    const gl = { dispose: vi.fn() };
    releaseRenderer(gl, [lut, triangle]);
    expect(calls).toEqual({ lut: 3, triangle: 3 });
    expect(gl.dispose).toHaveBeenCalledOnce();
    // A later release finds no stale listeners.
    releaseRenderer(gl, [lut, triangle]);
    expect(calls).toEqual({ lut: 3, triangle: 3 });
  });

  it("still disposes the renderer when a shared resource was not found", () => {
    const gl = { dispose: vi.fn() };
    releaseRenderer(gl, [null, new BufferGeometry()]);
    expect(gl.dispose).toHaveBeenCalledOnce();
  });
});
