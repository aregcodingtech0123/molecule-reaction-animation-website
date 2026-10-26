/**
 * PERF-25: the focus target is a plain point (no three.js in the provider that wraps every page). It must keep
 * working with three's Vector3 exactly as the 3D components use it: copy a world position in, lerp a camera
 * target towards it.
 */
import { act, render } from "@testing-library/react";
import { Vector3 } from "three";
import { describe, expect, it } from "vitest";
import { FocusProvider, useFocus } from "@/context/FocusContext";
import type { AtomData } from "@/lib/molecules/types";

describe("FocusContext focus point", () => {
  it("setFocus copies the world position; a three.js Vector3 can lerp towards it; clearFocus keeps it", () => {
    let api: ReturnType<typeof useFocus> | null = null;
    function Probe() {
      api = useFocus();
      return null;
    }
    render(
      <FocusProvider>
        <Probe />
      </FocusProvider>,
    );
    const atom = { id: "a1", element: "C", position: [0, 0, 0] } as unknown as AtomData;
    act(() => api!.setFocus(atom, new Vector3(1, 2, 3), 6, "benzene"));

    const point = api!.focusTargetRef.current!;
    expect([point.x, point.y, point.z]).toEqual([1, 2, 3]);
    expect(api!.focusActiveRef.current).toBe(true);
    expect(api!.focusCameraDistanceRef.current).toBe(6);
    expect(api!.isFocused).toBe(true);

    const cameraTarget = new Vector3(0, 0, 0).lerp(point, 0.5);
    expect(cameraTarget.toArray()).toEqual([0.5, 1, 1.5]);

    // MoleculeRenderer re-copies the moving atom's position every frame.
    point.copy(new Vector3(-4, 5, 0.5));
    expect([point.x, point.y, point.z]).toEqual([-4, 5, 0.5]);

    act(() => api!.clearFocus());
    expect(api!.isFocused).toBe(false);
    expect(api!.focusActiveRef.current).toBe(false);
  });
});
