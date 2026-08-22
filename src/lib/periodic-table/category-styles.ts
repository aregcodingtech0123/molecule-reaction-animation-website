import type { CategoryStyle, ElementCategory } from "./types";

export const CATEGORY_STYLES: Record<ElementCategory, CategoryStyle> = {
  "alkali-metal": {
    label: "Alkali Metal",
    cell: "bg-rose-50/90 border-rose-200/90 dark:bg-rose-500/15 dark:border-rose-400/25",
    cellHover:
      "hover:border-rose-400 hover:shadow-[0_0_16px_rgba(244,63,94,0.22)] dark:hover:border-rose-400/55 dark:hover:shadow-[0_0_20px_rgba(251,113,133,0.35)]",
    cellActive:
      "border-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.28)] ring-1 ring-rose-400/40 dark:border-rose-300/80 dark:shadow-[0_0_28px_rgba(251,113,133,0.45)] dark:ring-rose-400/40",
    orbit: "#fb7185",
    badge:
      "bg-rose-100 text-rose-950 border-rose-300/80 dark:bg-rose-500/20 dark:text-rose-100 dark:border-rose-400/30",
  },
  "alkaline-earth-metal": {
    label: "Alkaline Earth Metal",
    cell: "bg-orange-50/90 border-orange-200/90 dark:bg-orange-500/15 dark:border-orange-400/25",
    cellHover:
      "hover:border-orange-400 hover:shadow-[0_0_16px_rgba(249,115,22,0.22)] dark:hover:border-orange-400/55 dark:hover:shadow-[0_0_20px_rgba(251,146,60,0.35)]",
    cellActive:
      "border-orange-500 shadow-[0_0_20px_rgba(249,115,22,0.28)] ring-1 ring-orange-400/40 dark:border-orange-300/80 dark:shadow-[0_0_28px_rgba(251,146,60,0.45)] dark:ring-orange-400/40",
    orbit: "#fb923c",
    badge:
      "bg-orange-100 text-orange-950 border-orange-300/80 dark:bg-orange-500/20 dark:text-orange-100 dark:border-orange-400/30",
  },
  "transition-metal": {
    label: "Transition Metal",
    cell: "bg-sky-50/90 border-sky-200/90 dark:bg-sky-500/15 dark:border-sky-400/25",
    cellHover:
      "hover:border-sky-400 hover:shadow-[0_0_16px_rgba(14,165,233,0.22)] dark:hover:border-sky-400/55 dark:hover:shadow-[0_0_20px_rgba(56,189,248,0.35)]",
    cellActive:
      "border-sky-500 shadow-[0_0_20px_rgba(14,165,233,0.28)] ring-1 ring-sky-400/40 dark:border-sky-300/80 dark:shadow-[0_0_28px_rgba(56,189,248,0.45)] dark:ring-sky-400/40",
    orbit: "#38bdf8",
    badge:
      "bg-sky-100 text-sky-950 border-sky-300/80 dark:bg-sky-500/20 dark:text-sky-100 dark:border-sky-400/30",
  },
  "post-transition-metal": {
    label: "Post-transition Metal",
    cell: "bg-indigo-50/90 border-indigo-200/90 dark:bg-indigo-500/15 dark:border-indigo-400/25",
    cellHover:
      "hover:border-indigo-400 hover:shadow-[0_0_16px_rgba(99,102,241,0.22)] dark:hover:border-indigo-400/55 dark:hover:shadow-[0_0_20px_rgba(129,140,248,0.35)]",
    cellActive:
      "border-indigo-500 shadow-[0_0_20px_rgba(99,102,241,0.28)] ring-1 ring-indigo-400/40 dark:border-indigo-300/80 dark:shadow-[0_0_28px_rgba(129,140,248,0.45)] dark:ring-indigo-400/40",
    orbit: "#818cf8",
    badge:
      "bg-indigo-100 text-indigo-950 border-indigo-300/80 dark:bg-indigo-500/20 dark:text-indigo-100 dark:border-indigo-400/30",
  },
  metalloid: {
    label: "Metalloid",
    cell: "bg-amber-50/90 border-amber-200/90 dark:bg-amber-500/15 dark:border-amber-400/25",
    cellHover:
      "hover:border-amber-400 hover:shadow-[0_0_16px_rgba(245,158,11,0.22)] dark:hover:border-amber-400/55 dark:hover:shadow-[0_0_20px_rgba(251,191,36,0.35)]",
    cellActive:
      "border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.28)] ring-1 ring-amber-400/40 dark:border-amber-300/80 dark:shadow-[0_0_28px_rgba(251,191,36,0.45)] dark:ring-amber-400/40",
    orbit: "#fbbf24",
    badge:
      "bg-amber-100 text-amber-950 border-amber-300/80 dark:bg-amber-500/20 dark:text-amber-100 dark:border-amber-400/30",
  },
  nonmetal: {
    label: "Nonmetal",
    cell: "bg-teal-50/90 border-teal-200/90 dark:bg-teal-500/15 dark:border-teal-400/25",
    cellHover:
      "hover:border-teal-400 hover:shadow-[0_0_16px_rgba(20,184,166,0.22)] dark:hover:border-teal-400/55 dark:hover:shadow-[0_0_20px_rgba(45,212,191,0.35)]",
    cellActive:
      "border-teal-500 shadow-[0_0_20px_rgba(20,184,166,0.28)] ring-1 ring-teal-400/40 dark:border-teal-300/80 dark:shadow-[0_0_28px_rgba(45,212,191,0.5)] dark:ring-teal-400/40",
    orbit: "#2dd4bf",
    badge:
      "bg-teal-100 text-teal-950 border-teal-300/80 dark:bg-teal-500/20 dark:text-teal-100 dark:border-teal-400/30",
  },
  halogen: {
    label: "Halogen",
    cell: "bg-emerald-50/90 border-emerald-200/90 dark:bg-emerald-500/15 dark:border-emerald-400/25",
    cellHover:
      "hover:border-emerald-400 hover:shadow-[0_0_16px_rgba(16,185,129,0.22)] dark:hover:border-emerald-400/55 dark:hover:shadow-[0_0_20px_rgba(52,211,153,0.35)]",
    cellActive:
      "border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.28)] ring-1 ring-emerald-400/40 dark:border-emerald-300/80 dark:shadow-[0_0_28px_rgba(52,211,153,0.45)] dark:ring-emerald-400/40",
    orbit: "#34d399",
    badge:
      "bg-emerald-100 text-emerald-950 border-emerald-300/80 dark:bg-emerald-500/20 dark:text-emerald-100 dark:border-emerald-400/30",
  },
  "noble-gas": {
    label: "Noble Gas",
    cell: "bg-violet-50/90 border-violet-200/90 dark:bg-violet-500/15 dark:border-violet-400/25",
    cellHover:
      "hover:border-violet-400 hover:shadow-[0_0_16px_rgba(139,92,246,0.22)] dark:hover:border-violet-400/55 dark:hover:shadow-[0_0_20px_rgba(167,139,250,0.35)]",
    cellActive:
      "border-violet-500 shadow-[0_0_20px_rgba(139,92,246,0.28)] ring-1 ring-violet-400/40 dark:border-violet-300/80 dark:shadow-[0_0_28px_rgba(167,139,250,0.45)] dark:ring-violet-400/40",
    orbit: "#a78bfa",
    badge:
      "bg-violet-100 text-violet-950 border-violet-300/80 dark:bg-violet-500/20 dark:text-violet-100 dark:border-violet-400/30",
  },
  lanthanide: {
    label: "Lanthanide",
    cell: "bg-fuchsia-50/90 border-fuchsia-200/90 dark:bg-fuchsia-500/15 dark:border-fuchsia-400/25",
    cellHover:
      "hover:border-fuchsia-400 hover:shadow-[0_0_16px_rgba(217,70,239,0.22)] dark:hover:border-fuchsia-400/55 dark:hover:shadow-[0_0_20px_rgba(232,121,249,0.35)]",
    cellActive:
      "border-fuchsia-500 shadow-[0_0_20px_rgba(217,70,239,0.28)] ring-1 ring-fuchsia-400/40 dark:border-fuchsia-300/80 dark:shadow-[0_0_28px_rgba(232,121,249,0.45)] dark:ring-fuchsia-400/40",
    orbit: "#e879f9",
    badge:
      "bg-fuchsia-100 text-fuchsia-950 border-fuchsia-300/80 dark:bg-fuchsia-500/20 dark:text-fuchsia-100 dark:border-fuchsia-400/30",
  },
  actinide: {
    label: "Actinide",
    cell: "bg-red-50/90 border-red-200/90 dark:bg-red-500/15 dark:border-red-400/25",
    cellHover:
      "hover:border-red-400 hover:shadow-[0_0_16px_rgba(239,68,68,0.22)] dark:hover:border-red-400/55 dark:hover:shadow-[0_0_20px_rgba(248,113,113,0.35)]",
    cellActive:
      "border-red-500 shadow-[0_0_20px_rgba(239,68,68,0.28)] ring-1 ring-red-400/40 dark:border-red-300/80 dark:shadow-[0_0_28px_rgba(248,113,113,0.45)] dark:ring-red-400/40",
    orbit: "#f87171",
    badge:
      "bg-red-100 text-red-950 border-red-300/80 dark:bg-red-500/20 dark:text-red-100 dark:border-red-400/30",
  },
  unknown: {
    label: "Unknown / Synthetic",
    cell: "bg-slate-100/90 border-slate-300/80 dark:bg-slate-500/15 dark:border-slate-400/25",
    cellHover:
      "hover:border-slate-400 hover:shadow-[0_0_16px_rgba(100,116,139,0.2)] dark:hover:border-slate-400/55 dark:hover:shadow-[0_0_20px_rgba(148,163,184,0.3)]",
    cellActive:
      "border-slate-500 shadow-[0_0_20px_rgba(100,116,139,0.25)] ring-1 ring-slate-400/40 dark:border-slate-300/80 dark:shadow-[0_0_28px_rgba(148,163,184,0.4)] dark:ring-slate-400/40",
    orbit: "#94a3b8",
    badge:
      "bg-slate-200 text-slate-900 border-slate-300/80 dark:bg-slate-500/20 dark:text-slate-100 dark:border-slate-400/30",
  },
};

export const CATEGORY_LEGEND: ElementCategory[] = [
  "nonmetal",
  "noble-gas",
  "alkali-metal",
  "alkaline-earth-metal",
  "metalloid",
  "halogen",
  "transition-metal",
  "post-transition-metal",
  "lanthanide",
  "actinide",
];
