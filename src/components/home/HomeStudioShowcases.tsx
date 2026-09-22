"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { ArrowRight, Atom, Flame, Grid3X3, Sparkles, Zap } from "lucide-react";
import { HomeMoleculePreview } from "@/components/home/HomeMoleculePreview";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

type ShowcaseItem = {
  emoji: string;
  title: string;
  detail: string;
};

type ShowcaseBlock = {
  id: string;
  reverse: boolean;
  accent: "cyan" | "violet" | "teal";
  kicker: string;
  headline: string;
  body: string;
  items: ShowcaseItem[];
  ctaLabel: string;
  ctaHref: string;
  preview: "reactions" | "orbitals" | "periodic";
};

const BLOCKS: ShowcaseBlock[] = [
  {
    id: "reactions",
    reverse: false,
    accent: "cyan",
    kicker: "Reaction Lab",
    headline: "Witness Chemical Reactions in Motion ⚡",
    body: "Go beyond static structures. Visualize dynamic reaction pathways, bond formations, and energy transformations in real-time interactive 3D.",
    items: [
      {
        emoji: "💧",
        title: "Water Synthesis",
        detail: "2H₂ + O₂ → 2H₂O · Exothermic Energy Release",
      },
      {
        emoji: "🔥",
        title: "Methane Combustion",
        detail: "CH₄ + 2O₂ → CO₂ + 2H₂O",
      },
      {
        emoji: "🌿",
        title: "Photosynthesis",
        detail: "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂",
      },
    ],
    ctaLabel: "Explore 3D Reactions →",
    ctaHref: "/explore?tab=reactions",
    preview: "reactions",
  },
  {
    id: "orbitals",
    reverse: true,
    accent: "violet",
    kicker: "Atom Models",
    headline: "Quantum States & Atomic Orbitals ⚛️",
    body: "Dive deep into quantum mechanics. Inspect 3D electron probability clouds, orbital shapes (s, p, d, f), and valence shell configurations with interactive precision.",
    items: [
      {
        emoji: "⚛️",
        title: "Hydrogen (1s)",
        detail: "Simplest quantum system and spherical cloud",
      },
      {
        emoji: "💎",
        title: "Carbon (sp³ Hybridization)",
        detail: "The foundation of organic chemistry",
      },
      {
        emoji: "🟡",
        title: "Gold (5d¹⁰ 6s¹)",
        detail: "Relativistic electron shell configurations",
      },
    ],
    ctaLabel: "Inspect Atom Models →",
    ctaHref: "/atom-models",
    preview: "orbitals",
  },
  {
    id: "periodic",
    reverse: false,
    accent: "teal",
    kicker: "Periodic Table",
    headline: "The Entire Elemental Universe at Your Fingertips 🧪",
    body: "Explore all 118 chemical elements with real-time atomic mass, melting points, electronegativity, crystal structures, and 3D atomic previews.",
    items: [
      {
        emoji: "🌌",
        title: "Noble Gases",
        detail: "Helium, Neon, Argon · Stable Octet",
      },
      {
        emoji: "⚡",
        title: "Transition Metals",
        detail: "Titanium, Iron, Gold · High Conductive Lattice",
      },
      {
        emoji: "🧪",
        title: "Alkali Metals",
        detail: "Lithium, Sodium, Potassium · High Reactivity",
      },
    ],
    ctaLabel: "Open Periodic Table →",
    ctaHref: "/periodic-table",
    preview: "periodic",
  },
];

const ACCENT = {
  cyan: {
    glow: "from-cyan-500/25 via-teal-400/10 to-transparent",
    border: "border-cyan-400/25 hover:border-cyan-300/50",
    chip: "border-cyan-400/30 bg-cyan-500/10 text-cyan-100",
    chipLight: "border-cyan-300/70 bg-cyan-50 text-cyan-900",
    cta: "border-cyan-400/50 bg-cyan-500/20 text-cyan-50 hover:bg-cyan-400/30 hover:shadow-[0_0_28px_rgba(34,211,238,0.35)]",
    ctaLight: "border-cyan-400 bg-cyan-600 text-white hover:bg-cyan-500 shadow-md shadow-cyan-900/15",
    icon: "text-cyan-300",
  },
  violet: {
    glow: "from-violet-500/25 via-fuchsia-400/10 to-transparent",
    border: "border-violet-400/25 hover:border-violet-300/50",
    chip: "border-violet-400/30 bg-violet-500/10 text-violet-100",
    chipLight: "border-violet-300/70 bg-violet-50 text-violet-900",
    cta: "border-violet-400/50 bg-violet-500/20 text-violet-50 hover:bg-violet-400/30 hover:shadow-[0_0_28px_rgba(167,139,250,0.35)]",
    ctaLight: "border-violet-400 bg-violet-600 text-white hover:bg-violet-500 shadow-md shadow-violet-900/15",
    icon: "text-violet-300",
  },
  teal: {
    glow: "from-teal-500/25 via-emerald-400/10 to-transparent",
    border: "border-teal-400/25 hover:border-teal-300/50",
    chip: "border-teal-400/30 bg-teal-500/10 text-teal-100",
    chipLight: "border-teal-300/70 bg-teal-50 text-teal-900",
    cta: "border-teal-400/50 bg-teal-500/20 text-teal-50 hover:bg-teal-400/30 hover:shadow-[0_0_28px_rgba(45,212,191,0.35)]",
    ctaLight: "border-teal-400 bg-teal-700 text-white hover:bg-teal-600 shadow-md shadow-teal-900/15",
    icon: "text-teal-300",
  },
} as const;

function PreviewPanel({
  kind,
  accent,
  isWhiteLab,
}: {
  kind: ShowcaseBlock["preview"];
  accent: ShowcaseBlock["accent"];
  isWhiteLab: boolean;
}) {
  const a = ACCENT[accent];

  if (kind === "reactions") {
    return (
      <div className="relative h-full min-h-[280px] overflow-hidden rounded-2xl">
        <div className={cn("absolute inset-0 bg-gradient-to-br opacity-80", a.glow)} />
        <HomeMoleculePreview
          molecule="water"
          className="absolute inset-0 h-full w-full"
          frameClassName="rounded-2xl border-0 shadow-none bg-transparent"
          rounded="xl"
          lazy
          reduceEffects
          showMetadata
        />
        <div
          className={cn(
            "pointer-events-none absolute bottom-4 left-4 right-4 rounded-xl border px-3 py-2 backdrop-blur-md",
            isWhiteLab
              ? "border-white/70 bg-white/85 text-neutral-800"
              : "border-white/10 bg-slate-950/70 text-cyan-50",
          )}
        >
          <p className="font-mono text-[11px] tracking-wide">2H₂ + O₂ → 2H₂O</p>
          <p className={cn("mt-0.5 text-[10px]", isWhiteLab ? "text-neutral-500" : "text-white/55")}>
            Live bond rearrangement · Exothermic
          </p>
        </div>
      </div>
    );
  }

  if (kind === "orbitals") {
    const shells = ["1s", "2s", "2p", "3d", "4f"];
    return (
      <div
        className={cn(
          "relative flex h-full min-h-[280px] flex-col justify-between overflow-hidden rounded-2xl border p-6",
          isWhiteLab ? "border-violet-200 bg-white/80" : "border-white/10 bg-slate-900/50",
        )}
      >
        <div className={cn("absolute -right-10 -top-10 h-48 w-48 rounded-full bg-gradient-to-br blur-3xl", a.glow)} />
        <div className="relative flex items-center gap-2">
          <Atom className={cn("h-5 w-5", a.icon)} />
          <span className={cn("text-xs font-semibold uppercase tracking-[0.2em]", isWhiteLab ? "text-violet-800" : "text-violet-200")}>
            Orbital Map
          </span>
        </div>
        <div className="relative mx-auto my-6 grid place-items-center">
          {[1, 2, 3].map((ring) => (
            <motion.div
              key={ring}
              className={cn(
                "absolute rounded-full border",
                isWhiteLab ? "border-violet-300/60" : "border-violet-400/35",
              )}
              style={{ width: ring * 56, height: ring * 56 }}
              animate={{ rotate: ring % 2 === 0 ? 360 : -360 }}
              transition={{ duration: 18 + ring * 4, repeat: Infinity, ease: "linear" }}
            />
          ))}
          <div
            className={cn(
              "relative z-10 flex h-14 w-14 items-center justify-center rounded-full border text-lg font-bold",
              isWhiteLab
                ? "border-violet-300 bg-violet-100 text-violet-900"
                : "border-violet-400/50 bg-violet-500/20 text-violet-100 shadow-[0_0_30px_rgba(167,139,250,0.35)]",
            )}
          >
            C
          </div>
        </div>
        <div className="relative flex flex-wrap gap-2">
          {shells.map((shell) => (
            <span
              key={shell}
              className={cn(
                "rounded-full border px-2.5 py-1 font-mono text-[11px]",
                isWhiteLab ? a.chipLight : a.chip,
              )}
            >
              {shell}
            </span>
          ))}
        </div>
      </div>
    );
  }

  const cells = [
    { z: "1", s: "H", c: "bg-rose-500/20 border-rose-400/40" },
    { z: "2", s: "He", c: "bg-cyan-500/20 border-cyan-400/40" },
    { z: "3", s: "Li", c: "bg-amber-500/20 border-amber-400/40" },
    { z: "6", s: "C", c: "bg-slate-500/25 border-slate-400/40" },
    { z: "8", s: "O", c: "bg-sky-500/20 border-sky-400/40" },
    { z: "11", s: "Na", c: "bg-amber-500/20 border-amber-400/40" },
    { z: "26", s: "Fe", c: "bg-orange-500/20 border-orange-400/40" },
    { z: "79", s: "Au", c: "bg-yellow-500/20 border-yellow-400/40" },
    { z: "10", s: "Ne", c: "bg-cyan-500/20 border-cyan-400/40" },
  ];

  return (
    <div
      className={cn(
        "relative flex h-full min-h-[280px] flex-col overflow-hidden rounded-2xl border p-5",
        isWhiteLab ? "border-teal-200 bg-white/80" : "border-white/10 bg-slate-900/50",
      )}
    >
      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-70", a.glow)} />
      <div className="relative mb-4 flex items-center gap-2">
        <Grid3X3 className={cn("h-5 w-5", a.icon)} />
        <span className={cn("text-xs font-semibold uppercase tracking-[0.2em]", isWhiteLab ? "text-teal-800" : "text-teal-200")}>
          118 Elements
        </span>
      </div>
      <div className="relative grid flex-1 grid-cols-3 gap-2">
        {cells.map((cell) => (
          <div
            key={cell.s}
            className={cn(
              "flex flex-col justify-between rounded-xl border p-2.5 backdrop-blur-sm transition-transform hover:scale-[1.03]",
              cell.c,
              isWhiteLab ? "bg-white/70" : "bg-black/20",
            )}
          >
            <span className={cn("text-[10px]", isWhiteLab ? "text-neutral-500" : "text-white/50")}>{cell.z}</span>
            <span className={cn("font-display text-lg font-bold", isWhiteLab ? "text-neutral-900" : "text-white")}>
              {cell.s}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HomeStudioShowcases() {
  const { ui, isWhiteLab } = useTheme();

  return (
    <section
      aria-label="Studio feature showcases"
      className={cn("relative z-10 border-t py-24 md:py-32", ui.borders.divider)}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-24 px-6 md:gap-32">
        {BLOCKS.map((block, index) => {
          const a = ACCENT[block.accent];
          return (
            <motion.article
              key={block.id}
              initial={{ opacity: 0, y: 28 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-80px" }}
              transition={{ duration: 0.55, delay: 0.05 }}
              className={cn(
                "grid items-center gap-10 lg:grid-cols-2 lg:gap-14",
                block.reverse && "lg:[&>*:first-child]:order-2",
              )}
            >
              <div className="space-y-6">
                <div
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]",
                    isWhiteLab ? a.chipLight : a.chip,
                  )}
                >
                  {index === 0 ? (
                    <Zap className="h-3.5 w-3.5" />
                  ) : index === 1 ? (
                    <Atom className="h-3.5 w-3.5" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {block.kicker}
                </div>

                <h2 className="home-section-title text-3xl leading-tight md:text-4xl lg:text-[2.75rem]">
                  {block.headline}
                </h2>
                <p className={cn("max-w-xl text-base leading-relaxed md:text-lg", ui.typography.subtitle)}>
                  {block.body}
                </p>

                <ul className="space-y-3">
                  {block.items.map((item) => (
                    <li
                      key={item.title}
                      className={cn(
                        "group flex items-start gap-3 rounded-2xl border px-4 py-3 backdrop-blur-md transition-all",
                        isWhiteLab
                          ? "border-slate-200 bg-white/80 hover:border-teal-300 hover:bg-teal-50/70"
                          : cn("bg-slate-900/40", a.border),
                      )}
                    >
                      <span className="mt-0.5 text-lg leading-none" aria-hidden>
                        {item.emoji}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className={cn("font-display text-sm font-semibold", ui.typography.title)}>
                          {item.title}
                        </p>
                        <p className={cn("mt-0.5 font-mono text-[11px] leading-relaxed sm:text-xs", ui.typography.muted)}>
                          {item.detail}
                        </p>
                      </div>
                      {block.id === "reactions" ? (
                        <Flame className={cn("mt-0.5 h-3.5 w-3.5 shrink-0 opacity-50", a.icon)} />
                      ) : null}
                    </li>
                  ))}
                </ul>

                <Link
                  href={block.ctaHref}
                  className={cn(
                    "group inline-flex items-center gap-2 rounded-full border px-6 py-3 text-sm font-semibold transition-all active:scale-[0.98]",
                    isWhiteLab ? a.ctaLight : a.cta,
                  )}
                >
                  {block.ctaLabel.replace(" →", "")}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>

              <div
                className={cn(
                  "relative overflow-hidden rounded-3xl border p-2 backdrop-blur-md md:p-3",
                  isWhiteLab
                    ? "border-slate-200 bg-white/70 shadow-xl shadow-slate-200/40"
                    : cn("bg-slate-900/40 shadow-2xl shadow-black/30", a.border),
                )}
              >
                <PreviewPanel kind={block.preview} accent={block.accent} isWhiteLab={isWhiteLab} />
              </div>
            </motion.article>
          );
        })}
      </div>
    </section>
  );
}
