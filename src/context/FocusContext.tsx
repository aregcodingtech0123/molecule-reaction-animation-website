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
import * as THREE from "three";
import type { AtomData } from "@/lib/molecules/types";

interface FocusContextValue {
  focusedAtom: AtomData | null;
  focusedMoleculeId: string | null;
  isFocused: boolean;
  focusTargetRef: RefObject<THREE.Vector3>;
  focusActiveRef: RefObject<boolean>;
  focusCameraDistanceRef: RefObject<number>;
  setFocus: (
    atom: AtomData,
    worldPosition: THREE.Vector3,
    cameraDistance: number,
    moleculeId: string,
  ) => void;
  clearFocus: () => void;
}

const FocusContext = createContext<FocusContextValue | null>(null);

export function FocusProvider({ children }: { children: ReactNode }) {
  const [focusedAtom, setFocusedAtom] = useState<AtomData | null>(null);
  const [focusedMoleculeId, setFocusedMoleculeId] = useState<string | null>(null);

  const focusTargetRef = useRef(new THREE.Vector3(0, 0, 0));
  const focusActiveRef = useRef(false);
  const focusCameraDistanceRef = useRef(8);

  const setFocus = useCallback(
    (
      atom: AtomData,
      worldPosition: THREE.Vector3,
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
