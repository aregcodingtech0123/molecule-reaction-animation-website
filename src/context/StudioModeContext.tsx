"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/** Top-level studio surface: single-molecule explorer vs reaction animations */
export type StudioActiveMode = "explorer" | "reaction";

type StudioModeContextValue = {
  activeMode: StudioActiveMode;
  setActiveMode: (mode: StudioActiveMode) => void;
  toggleMode: () => void;
};

const StudioModeContext = createContext<StudioModeContextValue | null>(null);

export function StudioModeProvider({ children }: { children: ReactNode }) {
  const [activeMode, setActiveModeState] = useState<StudioActiveMode>("explorer");

  const setActiveMode = useCallback((mode: StudioActiveMode) => {
    setActiveModeState(mode);
  }, []);

  const toggleMode = useCallback(() => {
    setActiveModeState((m) => (m === "explorer" ? "reaction" : "explorer"));
  }, []);

  const value = useMemo(
    () => ({
      activeMode,
      setActiveMode,
      toggleMode,
    }),
    [activeMode, setActiveMode, toggleMode]
  );

  return (
    <StudioModeContext.Provider value={value}>{children}</StudioModeContext.Provider>
  );
}

export function useStudioMode(): StudioModeContextValue {
  const ctx = useContext(StudioModeContext);
  if (!ctx) {
    throw new Error("useStudioMode must be used within StudioModeProvider");
  }
  return ctx;
}
