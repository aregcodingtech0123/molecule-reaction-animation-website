export const APP_THEMES = ["night-lab", "white-lab"] as const;

export type AppTheme = (typeof APP_THEMES)[number];

export const THEME_STORAGE_KEY = "moleculestudio-theme";

export const DEFAULT_THEME: AppTheme = "night-lab";

/** Persisted theme ids from before the Night Lab rename. */
export const LEGACY_THEME_ALIASES: Record<string, AppTheme> = {
  cyberpunk: "night-lab",
};

export function isAppTheme(value: string): value is AppTheme {
  return (APP_THEMES as readonly string[]).includes(value);
}

export function resolveAppTheme(value: string | null | undefined): AppTheme {
  if (!value) return DEFAULT_THEME;
  if (isAppTheme(value)) return value;
  return LEGACY_THEME_ALIASES[value] ?? DEFAULT_THEME;
}
