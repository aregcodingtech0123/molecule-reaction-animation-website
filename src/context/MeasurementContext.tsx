"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

const MAX_SELECTED = 2;

interface MeasurementContextValue {
  measurementMode: boolean;
  selectedAtomIds: string[];
  toggleMeasurementMode: () => void;
  setMeasurementMode: (active: boolean) => void;
  selectMeasurementAtom: (atomId: string) => void;
  clearMeasurement: () => void;
}

const MeasurementContext = createContext<MeasurementContextValue | null>(null);

export function MeasurementProvider({ children }: { children: ReactNode }) {
  const [measurementMode, setMeasurementModeState] = useState(false);
  const [selectedAtomIds, setSelectedAtomIds] = useState<string[]>([]);

  const clearMeasurement = useCallback(() => {
    setSelectedAtomIds([]);
  }, []);

  const setMeasurementMode = useCallback((active: boolean) => {
    setMeasurementModeState(active);
    if (!active) setSelectedAtomIds([]);
  }, []);

  const toggleMeasurementMode = useCallback(() => {
    setMeasurementModeState((prev) => {
      const next = !prev;
      if (!next) setSelectedAtomIds([]);
      return next;
    });
  }, []);

  const selectMeasurementAtom = useCallback((atomId: string) => {
    setSelectedAtomIds((prev) => {
      if (prev.includes(atomId)) {
        return prev.filter((id) => id !== atomId);
      }
      if (prev.length >= MAX_SELECTED) {
        return [atomId];
      }
      return [...prev, atomId];
    });
  }, []);

  const value = useMemo(
    () => ({
      measurementMode,
      selectedAtomIds,
      toggleMeasurementMode,
      setMeasurementMode,
      selectMeasurementAtom,
      clearMeasurement,
    }),
    [
      measurementMode,
      selectedAtomIds,
      toggleMeasurementMode,
      setMeasurementMode,
      selectMeasurementAtom,
      clearMeasurement,
    ],
  );

  return (
    <MeasurementContext.Provider value={value}>{children}</MeasurementContext.Provider>
  );
}

export function useMeasurement(): MeasurementContextValue {
  const ctx = useContext(MeasurementContext);
  if (!ctx) {
    throw new Error("useMeasurement must be used within MeasurementProvider");
  }
  return ctx;
}
