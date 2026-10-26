"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import type { Vector3Like } from "three";
import type { AtomData } from "@/lib/molecules/types";

/**
 * The focus target as a plain mutable point (PERF-25). This provider wraps every page, and a THREE.Vector3 here
 * put three.js (96.5 KiB compressed) in every route's initial load. three's Vector3 methods accept any
 * Vector3Like, so CameraRig's `target.lerp(point)` and MoleculeRenderer's `point.copy(worldPosition)` work as before;
 * the type-only import adds nothing to the bundle.
 */
class FocusPoint implements Vector3Like {
  x = 0;
  y = 0;
  z = 0;

  copy(v: Vector3Like): this {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
}

interface FocusContextValue {
  focusedAtom: AtomData | null;
  focusedMoleculeId: string | null;
  isFocused: boolean;
  focusTargetRef: RefObject<FocusPoint>;
  focusActiveRef: RefObject<boolean>;
  focusCameraDistanceRef: RefObject<number>;
  setFocus: (
    atom: AtomData,
    worldPosition: Vector3Like,
    cameraDistance: number,
    moleculeId: string,
  ) => void;
  clearFocus: () => void;
}

const FocusContext = createContext<FocusContextValue | null>(null);

export function FocusProvider({ children }: { children: ReactNode }) {
  const [focusedAtom, setFocusedAtom] = useState<AtomData | null>(null);
  const [focusedMoleculeId, setFocusedMoleculeId] = useState<string | null>(null);

  const focusTargetRef = useRef(new FocusPoint());
  const focusActiveRef = useRef(false);
  const focusCameraDistanceRef = useRef(8);

  const setFocus = useCallback(
    (
      atom: AtomData,
      worldPosition: Vector3Like,
      cameraDistance: number,
      moleculeId: string,
    ) => {
      focusTargetRef.current.copy(worldPosition);
      focusCameraDistanceRef.current = cameraDistance;
      focusActiveRef.current = true;
      setFocusedAtom(atom);
      setFocusedMoleculeId(moleculeId);
    },
    [],
  );

  const clearFocus = useCallback(() => {
    focusActiveRef.current = false;
    setFocusedAtom(null);
    setFocusedMoleculeId(null);
  }, []);

  const value = useMemo(
    () => ({
      focusedAtom,
      focusedMoleculeId,
      isFocused: focusedAtom !== null,
      focusTargetRef,
      focusActiveRef,
      focusCameraDistanceRef,
      setFocus,
      clearFocus,
    }),
    [focusedAtom, focusedMoleculeId, setFocus, clearFocus],
  );

  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>;
}

export function useFocus(): FocusContextValue {
  const ctx = useContext(FocusContext);
  if (!ctx) {
    throw new Error("useFocus must be used within FocusProvider");
  }
  return ctx;
}
