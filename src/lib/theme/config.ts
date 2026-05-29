import { APP_THEMES, type AppTheme } from "./types";

/** Tailwind / layout shell classes applied via ThemeShell */
export interface ThemeUiConfig {
  id: AppTheme;
  label: string;
  htmlClass: string;
  shell: {
    page: string;
    selection: string;
  };
  nav: {
    brand: string;
    brandMuted: string;
    link: string;
    linkActive: string;
    divider: string;
    cta: string;
    modeTabActive: string;
    modeTabIdle: string;
    modeSwitchBg: string;
  };
  footer: string;
  typography: {
    heading: string;
    title: string;
    subtitle: string;
    body: string;
    muted: string;
    label: string;
    caption: string;
    mono: string;
    monoMuted: string;
    iconMuted: string;
    iconAccent: string;
    iconAccentAlt: string;
  };
  sidebar: {
    sectionLabel: string;
    itemIdle: string;
    itemHover: string;
    itemActive: string;
    nameActive: string;
    nameIdle: string;
    formulaActive: string;
    formulaIdle: string;
    meta: string;
  };
  panel: {
    card: string;
    cardHighlight: string;
    cardLabel: string;
    cardValue: string;
    cardBody: string;
    cardQuote: string;
    chip: string;
    chipMuted: string;
    badge: string;
    overlay: string;
    overlayBorder: string;
  };
  controls: {
    play: string;
    toolbar: string;
    iconButton: string;
  };
  borders: {
    subtle: string;
    divider: string;
  };
}

/** React Three Fiber staging parameters */
export interface ThemeSceneConfig {
  background: string;
  gridCellColor: string;
  gridSectionColor: string;
  gridFadeDistance: number;
  contactShadowOpacity: number;
  contactShadowBlur: number;
  showStars: boolean;
  starCount: number;
  showParticles: boolean;
  particleOpacity: number;
  environmentPreset: "city" | "studio" | "warehouse";
  environmentIntensity: number;
  accentLightIntensity: number;
  ambient: { intensity: number; color: string };
  keyLight: { intensity: number; color: string; castShadow: boolean };
  fillLight: { intensity: number; color: string };
  rimLight: { intensity: number; color: string };
  accentOrbit: { intensity: number; color: string };
  spotLight: { intensity: number; color: string };
  bloomIntensity: number;
  bloomThreshold: number;
  vignetteDarkness: number;
  chromaticAberration: boolean;
  /** Light atoms (e.g. H) get a visible outline in bright scenes */
  atomOutlineColor: string;
  atomOutlineScale: number;
  lightAtomLuminanceThreshold: number;
  label: {
    bg: string;
    bgSelected: string;
    border: string;
    borderSelected: string;
    symbolColor: string;
    detailColor: string;
    textShadow: string;
  };
}

export const THEME_UI: Record<AppTheme, ThemeUiConfig> = {
  cyberpunk: {
    id: "cyberpunk",
    label: "Cyberpunk Glass",
    htmlClass: "dark",
    shell: {
      page: "bg-black text-white",
      selection: "selection:bg-indigo-500/30",
    },
    nav: {
      brand: "text-gray-100 group-hover:text-white",
      brandMuted: "text-gray-400",
      link: "text-gray-400 hover:text-white",
      linkActive: "text-white",
      divider: "border-white/10",
      cta: "bg-white/10 hover:bg-white/20 text-white hover:shadow-[0_0_15px_rgba(255,255,255,0.2)]",
      modeTabActive:
        "bg-indigo-500/35 text-white border border-indigo-400/60 shadow-[0_0_22px_rgba(99,102,241,0.35)]",
      modeTabIdle:
        "text-gray-400 hover:text-gray-100 border border-transparent hover:bg-white/5",
      modeSwitchBg: "bg-white/5 border-white/10",
    },
    footer: "border-neutral-900 bg-neutral-950 text-neutral-400",
    typography: {
      heading: "text-white",
      title: "text-white",
      subtitle: "text-gray-400",
      body: "text-gray-300",
      muted: "text-gray-500",
      label: "text-gray-600",
      caption: "text-gray-500",
      mono: "text-gray-400",
      monoMuted: "text-gray-500",
      iconMuted: "text-gray-400",
      iconAccent: "text-indigo-400",
      iconAccentAlt: "text-amber-400/90",
    },
    sidebar: {
      sectionLabel: "text-gray-600",
      itemIdle:
        "bg-white/[0.02] border-white/[0.06] active:bg-neutral-800/50 active:border-white/15 [@media(hover:hover)]:hover:bg-neutral-800/50 [@media(hover:hover)]:hover:border-white/15",
      itemHover:
        "[@media(hover:hover)]:hover:border-white/25 [@media(hover:hover)]:hover:brightness-110",
      itemActive: "shadow-[0_0_20px_rgba(99,102,241,0.12)]",
      nameActive: "text-white",
      nameIdle: "text-gray-500",
      formulaActive: "text-indigo-300/90",
      formulaIdle: "text-gray-600",
      meta: "text-gray-600",
    },
    panel: {
      card: "bg-white/[0.02] border border-white/[0.06]",
      cardHighlight: "border border-white/10",
      cardLabel: "text-gray-600",
      cardValue: "text-white",
      cardBody: "text-gray-200",
      cardQuote: "text-gray-500",
      chip: "bg-white/5 border border-white/10 text-gray-400",
      chipMuted: "bg-white/5 border border-white/10 text-gray-400",
      badge: "bg-white/5 border border-white/10 text-gray-400",
      overlay: "bg-black/60 backdrop-blur-xl",
      overlayBorder: "border-white/10",
    },
    controls: {
      play: "text-white border-white/15 bg-white/10 hover:bg-white/15 hover:border-white/25",
      toolbar: "bg-black/50 border-white/10",
      iconButton: "text-gray-500 hover:text-white",
    },
    borders: {
      subtle: "border-white/10",
      divider: "border-white/10",
    },
  },
  "white-lab": {
    id: "white-lab",
    label: "White Lab",
    htmlClass: "",
    shell: {
      page: "bg-slate-50 text-neutral-900",
      selection: "selection:bg-indigo-200/80",
    },
    nav: {
      brand: "text-neutral-900 group-hover:text-indigo-800",
      brandMuted: "text-neutral-600",
      link: "text-neutral-700 hover:text-neutral-900",
      linkActive: "text-neutral-900 font-semibold",
      divider: "border-slate-300",
      cta: "bg-white hover:bg-white text-neutral-900 border border-slate-300 shadow-sm hover:shadow-md",
      modeTabActive:
        "bg-indigo-100 text-indigo-950 border border-indigo-400/70 shadow-sm font-semibold",
      modeTabIdle:
        "text-neutral-600 hover:text-neutral-900 border border-transparent hover:bg-white/80",
      modeSwitchBg: "bg-white/80 border-slate-300 shadow-sm",
    },
    footer: "border-slate-200 bg-white/90 text-neutral-700 backdrop-blur-md shadow-sm",
    typography: {
      heading: "text-neutral-900",
      title: "text-neutral-900",
      subtitle: "text-neutral-700",
      body: "text-neutral-800",
      muted: "text-neutral-600",
      label: "text-neutral-600",
      caption: "text-neutral-600",
      mono: "text-neutral-700",
      monoMuted: "text-neutral-600",
      iconMuted: "text-neutral-600",
      iconAccent: "text-indigo-700",
      iconAccentAlt: "text-amber-700",
    },
    sidebar: {
      sectionLabel: "text-neutral-700 font-semibold",
      itemIdle:
        "bg-white/70 border-slate-200 shadow-sm active:bg-slate-100 active:border-slate-300 [@media(hover:hover)]:hover:bg-slate-100 [@media(hover:hover)]:hover:border-slate-300",
      itemHover: "[@media(hover:hover)]:hover:border-slate-400",
      itemActive: "bg-slate-200/90 border-2 shadow-md ring-1 ring-slate-300/80",
      nameActive: "text-neutral-900 font-bold",
      nameIdle: "text-neutral-700",
      formulaActive: "text-neutral-800",
      formulaIdle: "text-neutral-600",
      meta: "text-neutral-600",
    },
    panel: {
      card: "panel-card",
      cardHighlight: "panel-card-highlight",
      cardLabel: "text-neutral-700 font-medium",
      cardValue: "text-neutral-900 font-semibold",
      cardBody: "text-neutral-800",
      cardQuote: "text-neutral-700",
      chip: "bg-white border border-slate-200 text-neutral-800 shadow-sm",
      chipMuted: "bg-slate-100 border border-slate-200 text-neutral-700",
      badge: "bg-white border border-slate-200 text-neutral-700 shadow-sm",
      overlay: "bg-white/75 backdrop-blur-md shadow-md",
      overlayBorder: "border-slate-200",
    },
    controls: {
      play: "text-neutral-900 border-slate-300 bg-white hover:bg-slate-50 shadow-sm hover:shadow-md",
      toolbar: "bg-white/80 border-slate-200 shadow-sm",
      iconButton: "text-neutral-600 hover:text-neutral-900",
    },
    borders: {
      subtle: "border-slate-200",
      divider: "border-slate-200",
    },
  },
};

export const THEME_SCENE: Record<AppTheme, ThemeSceneConfig> = {
  cyberpunk: {
    background: "#020209",
    gridCellColor: "#1e293b",
    gridSectionColor: "#818cf8",
    gridFadeDistance: 30,
    contactShadowOpacity: 0.24,
    contactShadowBlur: 2.5,
    showStars: true,
    starCount: 3000,
    showParticles: true,
    particleOpacity: 1,
    environmentPreset: "city",
    environmentIntensity: 0.3,
    accentLightIntensity: 0.6,
    ambient: { intensity: 0.15, color: "#8b9dc3" },
    keyLight: { intensity: 1.2, color: "#ffffff", castShadow: true },
    fillLight: { intensity: 0.4, color: "#6366f1" },
    rimLight: { intensity: 0.8, color: "#a855f7" },
    accentOrbit: { intensity: 0.6, color: "#818cf8" },
    spotLight: { intensity: 0.5, color: "#e0e7ff" },
    bloomIntensity: 0.5,
    bloomThreshold: 0.55,
    vignetteDarkness: 0.85,
    chromaticAberration: true,
    atomOutlineColor: "#000000",
    atomOutlineScale: 1.06,
    lightAtomLuminanceThreshold: 0.72,
    label: {
      bg: "rgba(0, 0, 0, 0.75)",
      bgSelected: "rgba(99, 102, 241, 0.9)",
      border: "rgba(255,255,255,0.1)",
      borderSelected: "rgba(129, 140, 248, 0.6)",
      symbolColor: "inherit",
      detailColor: "rgba(255,255,255,0.7)",
      textShadow: "0 1px 4px rgba(0,0,0,0.8)",
    },
  },
  "white-lab": {
    background: "#f8fafc",
    gridCellColor: "#e2e8f0",
    gridSectionColor: "#cbd5e1",
    gridFadeDistance: 28,
    contactShadowOpacity: 0.42,
    contactShadowBlur: 4,
    showStars: false,
    starCount: 0,
    showParticles: false,
    particleOpacity: 0.35,
    environmentPreset: "studio",
    environmentIntensity: 1.05,
    accentLightIntensity: 0.35,
    ambient: { intensity: 0.92, color: "#f8fafc" },
    keyLight: { intensity: 2.1, color: "#ffffff", castShadow: true },
    fillLight: { intensity: 0.75, color: "#e2e8f0" },
    rimLight: { intensity: 0.35, color: "#94a3b8" },
    accentOrbit: { intensity: 0.25, color: "#cbd5e1" },
    spotLight: { intensity: 0.85, color: "#ffffff" },
    bloomIntensity: 0.1,
    bloomThreshold: 0.94,
    vignetteDarkness: 0.18,
    chromaticAberration: false,
    atomOutlineColor: "#475569",
    atomOutlineScale: 1.08,
    lightAtomLuminanceThreshold: 0.55,
    label: {
      bg: "rgba(255, 255, 255, 0.95)",
      bgSelected: "rgba(79, 70, 229, 0.92)",
      border: "rgba(203, 213, 225, 1)",
      borderSelected: "rgba(67, 56, 202, 0.7)",
      symbolColor: "#0f172a",
      detailColor: "rgba(255,255,255,0.95)",
      textShadow: "0 1px 2px rgba(255,255,255,0.9)",
    },
  },
};

export function isAppTheme(value: string): value is AppTheme {
  return (APP_THEMES as readonly string[]).includes(value);
}
