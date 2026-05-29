export const APP_THEMES = ["cyberpunk", "white-lab"] as const;

export type AppTheme = (typeof APP_THEMES)[number];

export const THEME_STORAGE_KEY = "moleculestudio-theme";

export const DEFAULT_THEME: AppTheme = "cyberpunk";
