import type { AppTheme } from "./types";

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
  /** Primary brand accents — CTAs, highlights, marketing surfaces */
  accent: {
    headline: string;
    section: string;
    heroBadge: string;
    heroBadgeRule: string;
    link: string;
    icon: string;
    rule: string;
    formulaChip: string;
    featureIndex: string;
    scrollCue: string;
    secondaryButton: string;
    textLink: string;
  };
  /** Homepage / marketing layout surfaces */
  marketing: {
    catalogCard: string;
    catalogCardHover: string;
    catalogDivider: string;
    featurePanel: string;
    compareTile: string;
    compareTileHover: string;
    showcaseChassis: string;
    showcaseSection: string;
    aiShell: string;
    aiPanel: string;
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
  /** Self-hosted map, see components/canvas/SceneEnvironment.tsx (FINDING-31). */
  environmentPreset: "city" | "studio";
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
  "night-lab": {
    id: "night-lab",
    label: "Night Lab",
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
      cta:
        "bg-teal-500 text-slate-950 border border-teal-400 font-semibold hover:bg-teal-400 shadow-[0_0_24px_rgba(45,212,191,0.35)]",
      modeTabActive:
        "bg-indigo-500/35 text-white border border-indigo-400/60 shadow-[0_0_22px_rgba(99,102,241,0.35)]",
      modeTabIdle:
        "text-gray-400 hover:text-gray-100 border border-transparent hover:bg-white/5",
      modeSwitchBg: "bg-white/5 border-white/10",
    },
    footer: "border-neutral-900 bg-neutral-950 text-neutral-400",
    typography: {
      heading: "font-display text-white",
      title: "font-display text-white",
      subtitle: "text-gray-400",
      body: "text-gray-300",
      muted: "text-gray-500",
      label: "text-gray-600",
      caption: "text-gray-500",
      mono: "text-gray-400",
      monoMuted: "text-gray-500",
      iconMuted: "text-gray-400",
      iconAccent: "text-teal-400",
      iconAccentAlt: "text-amber-400/90",
    },
    sidebar: {
      sectionLabel: "font-display text-gray-500 tracking-wide",
      itemIdle:
        "bg-white/[0.02] border-white/[0.06] active:bg-neutral-800/50 active:border-white/15 [@media(hover:hover)]:hover:bg-neutral-800/50 [@media(hover:hover)]:hover:border-white/15",
      itemHover:
        "[@media(hover:hover)]:hover:border-white/25 [@media(hover:hover)]:hover:brightness-110",
      itemActive: "shadow-[0_0_20px_rgba(45,212,191,0.12)]",
      nameActive: "font-display text-white",
      nameIdle: "text-gray-500",
      formulaActive: "text-teal-300/90",
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
    accent: {
      headline:
        "text-teal-400 underline decoration-teal-400/35 decoration-[0.12em] underline-offset-[0.12em]",
      section: "text-teal-300",
      heroBadge: "border-white/15 text-teal-200/80 bg-black/40",
      heroBadgeRule: "bg-teal-400/70",
      link: "text-teal-300",
      icon: "text-teal-400/80",
      rule: "border-teal-500/40",
      formulaChip: "border-white/10 bg-white/[0.03] text-teal-200/80",
      featureIndex: "text-white/[0.07]",
      scrollCue: "bg-gradient-to-b from-teal-500/50 to-transparent",
      secondaryButton:
        "border-white/20 bg-transparent text-white hover:border-white/35 hover:bg-white/5",
      textLink: "text-teal-300 hover:text-teal-200",
    },
    marketing: {
      catalogCard:
        "rounded-md border border-white/10 bg-white/[0.02] transition-[border-color,background-color] duration-250",
      catalogCardHover: "hover:border-teal-400/45 hover:bg-white/[0.04]",
      catalogDivider: "border-white/10",
      featurePanel: "border-t-2 border-teal-500/35 pt-7 bg-transparent rounded-none",
      compareTile: "rounded-lg border border-white/12 bg-black/35 transition-colors duration-250",
      compareTileHover: "hover:border-teal-400/40",
      showcaseChassis:
        "rounded-sm border border-white/14 bg-black/55 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.04),0_24px_48px_rgb(0_0_0/0.45)]",
      showcaseSection: "bg-neutral-950/40",
      aiShell: "rounded-md border border-white/12 overflow-hidden",
      aiPanel: "bg-neutral-950/80",
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
      cta:
        "bg-teal-700 text-white border border-teal-700 font-semibold hover:bg-teal-800 shadow-md hover:shadow-lg",
      modeTabActive:
        "bg-indigo-100 text-indigo-950 border border-indigo-400/70 shadow-sm font-semibold",
      modeTabIdle:
        "text-neutral-600 hover:text-neutral-900 border border-transparent hover:bg-white/80",
      modeSwitchBg: "bg-white/80 border-slate-300 shadow-sm",
    },
    footer: "border-slate-200 bg-white/90 text-neutral-700 backdrop-blur-md shadow-sm",
    typography: {
      heading: "font-display text-neutral-900",
      title: "font-display text-neutral-900",
      subtitle: "text-neutral-700",
      body: "text-neutral-800",
      muted: "text-neutral-600",
      label: "text-neutral-600",
      caption: "text-neutral-600",
      mono: "text-neutral-700",
      monoMuted: "text-neutral-600",
      iconMuted: "text-neutral-600",
      iconAccent: "text-teal-700",
      iconAccentAlt: "text-amber-700",
    },
    sidebar: {
      sectionLabel: "font-display text-neutral-700 font-semibold tracking-wide",
      itemIdle:
        "bg-white/70 border-slate-200 shadow-sm active:bg-slate-100 active:border-slate-300 [@media(hover:hover)]:hover:bg-slate-100 [@media(hover:hover)]:hover:border-slate-300",
      itemHover: "[@media(hover:hover)]:hover:border-slate-400",
      itemActive: "bg-slate-200/90 border-2 shadow-md ring-1 ring-slate-300/80",
      nameActive: "font-display text-neutral-900 font-bold",
      nameIdle: "text-neutral-700",
      formulaActive: "text-teal-800",
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
    accent: {
      headline:
        "text-teal-800 underline decoration-teal-700/25 decoration-[0.12em] underline-offset-[0.12em]",
      section: "text-teal-700",
      heroBadge: "border-slate-300 text-slate-600 bg-white/80",
      heroBadgeRule: "bg-teal-600/45",
      link: "text-teal-700",
      icon: "text-teal-700",
      rule: "border-teal-600/35",
      formulaChip: "border-slate-200 bg-slate-50 text-slate-700",
      featureIndex: "text-slate-200",
      scrollCue: "bg-gradient-to-b from-teal-600/40 to-transparent",
      secondaryButton:
        "border-slate-300 bg-white text-slate-800 hover:border-slate-400 hover:bg-slate-50",
      textLink: "text-teal-700 hover:text-teal-800",
    },
    marketing: {
      catalogCard:
        "rounded-md border border-slate-200 bg-white shadow-sm transition-[border-color,box-shadow] duration-250",
      catalogCardHover: "hover:border-teal-700/45 hover:shadow-md hover:shadow-teal-900/5",
      catalogDivider: "border-slate-200",
      featurePanel: "border-t-2 border-teal-600/35 pt-7 bg-transparent rounded-none",
      compareTile:
        "rounded-lg border border-slate-200 bg-white shadow-sm transition-colors duration-250",
      compareTileHover: "hover:border-teal-700/40",
      showcaseChassis:
        "rounded-sm border border-slate-400/55 bg-slate-50 shadow-[inset_0_0_0_1px_rgb(255_255_255/0.8),0_16px_40px_rgb(148_163_184/0.18)]",
      showcaseSection: "bg-slate-50",
      aiShell: "rounded-md border border-slate-200 overflow-hidden shadow-md shadow-slate-200/30",
      aiPanel: "bg-white",
    },
  },
};

export const THEME_SCENE: Record<AppTheme, ThemeSceneConfig> = {
  "night-lab": {
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
    /* Cleared via alpha in SceneStage; HTML `.studio-canvas-atmosphere` supplies the gradient */
    background: "#f8fafc",
    gridCellColor: "#cbd5e1",
    gridSectionColor: "#94a3b8",
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
    ambient: { intensity: 0.92, color: "#f0f9ff" },
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
