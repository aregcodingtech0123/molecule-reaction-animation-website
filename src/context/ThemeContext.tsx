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
  type AppTheme,
} from "@/lib/theme/types";
import { isAppTheme } from "@/lib/theme/config";

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
  if (typeof window === "undefined") return DEFAULT_THEME;
  const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
  return stored && isAppTheme(stored) ? (stored as AppTheme) : DEFAULT_THEME;
}

function applyThemeToDocument(theme: AppTheme) {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.classList.toggle("dark", theme === "cyberpunk");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<AppTheme>(() => readStoredTheme());

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  const setTheme = useCallback((next: AppTheme) => {
    setThemeState(next);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    }
    applyThemeToDocument(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === "cyberpunk" ? "white-lab" : "cyberpunk");
  }, [theme, setTheme]);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

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
