"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { THEME_SCENE, THEME_UI } from "@/lib/theme/config";
import type { ThemeSceneConfig, ThemeUiConfig } from "@/lib/theme/config";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  resolveAppTheme,
  type AppTheme,
} from "@/lib/theme/types";

interface ThemeContextValue {
  theme: AppTheme;
  setTheme: (theme: AppTheme) => void;
  toggleTheme: () => void;
  ui: ThemeUiConfig;
  scene: ThemeSceneConfig;
  isWhiteLab: boolean;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): AppTheme {
  return resolveAppTheme(window.localStorage.getItem(THEME_STORAGE_KEY));
}

function applyThemeToDocument(theme: AppTheme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "night-lab");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  /** Match SSR / layout.tsx defaults on first render to avoid hydration mismatch. */
  const [theme, setThemeState] = useState<AppTheme>(DEFAULT_THEME);

  useEffect(() => {
    const storedRaw = window.localStorage.getItem(THEME_STORAGE_KEY);
    const resolved = resolveAppTheme(storedRaw);
    if (storedRaw !== resolved) {
      window.localStorage.setItem(THEME_STORAGE_KEY, resolved);
    }
    setThemeState(resolved);
    applyThemeToDocument(resolved);
  }, []);

  const setTheme = useCallback((next: AppTheme) => {
    setThemeState(next);
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
    applyThemeToDocument(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "night-lab" ? "white-lab" : "night-lab");
  }, [theme, setTheme]);

  const value = useMemo(
    (): ThemeContextValue => ({
      theme,
      setTheme,
      toggleTheme,
      ui: THEME_UI[theme],
      scene: THEME_SCENE[theme],
      isWhiteLab: theme === "white-lab",
    }),
    [theme, setTheme, toggleTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error("useTheme must be used within ThemeProvider");
  }
  return ctx;
}
