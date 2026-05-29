"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type RenderMode = "ball-and-stick" | "space-filling" | "esps";

const RENDER_MODE_CYCLE: RenderMode[] = ["ball-and-stick", "space-filling", "esps"];

interface RenderModeContextValue {
  renderMode: RenderMode;
  setRenderMode: (mode: RenderMode) => void;
  toggleRenderMode: () => void;
  isSpaceFilling: boolean;
  isEsps: boolean;
}

const RenderModeContext = createContext<RenderModeContextValue | null>(null);

export function RenderModeProvider({ children }: { children: ReactNode }) {
  const [renderMode, setRenderModeState] = useState<RenderMode>("ball-and-stick");

  const setRenderMode = useCallback((mode: RenderMode) => {
    setRenderModeState(mode);
  }, []);

  const toggleRenderMode = useCallback(() => {
    setRenderModeState((m) => {
      const idx = RENDER_MODE_CYCLE.indexOf(m);
      return RENDER_MODE_CYCLE[(idx + 1) % RENDER_MODE_CYCLE.length];
    });
  }, []);

  const value = useMemo(
    () => ({
      renderMode,
      setRenderMode,
      toggleRenderMode,
      isSpaceFilling: renderMode === "space-filling",
      isEsps: renderMode === "esps",
    }),
    [renderMode, setRenderMode, toggleRenderMode],
  );

  return (
    <RenderModeContext.Provider value={value}>{children}</RenderModeContext.Provider>
  );
}

export function useRenderMode(): RenderModeContextValue {
  const ctx = useContext(RenderModeContext);
  if (!ctx) {
    throw new Error("useRenderMode must be used within RenderModeProvider");
  }
  return ctx;
}
