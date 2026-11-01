"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Atom, Hash, Layers, Scale, Sparkles } from "lucide-react";
import { AtomicOrbitAnimation } from "@/components/periodic-table/AtomicOrbitAnimation";
import { RealWorldView } from "@/components/periodic-table/RealWorldView";
import { CATEGORY_STYLES } from "@/lib/periodic-table/category-styles";
import { massNumberNote } from "@/lib/periodic-table/elements";
import type { ChemicalElement } from "@/lib/periodic-table/types";
import { cn } from "@/lib/utils";

interface ElementDetailPanelProps {
  element: ChemicalElement | null;
  className?: string;
}

export function ElementDetailPanel({ element, className }: ElementDetailPanelProps) {
  return (
    <div
      className={cn(
        "relative flex min-h-[22rem] flex-col overflow-hidden rounded-3xl border p-6 backdrop-blur-md sm:p-8",
        "border-neutral-200/70 bg-white/70 shadow-lg shadow-neutral-200/30",
        "dark:border-white/10 dark:bg-white/5 dark:shadow-[0_0_60px_rgba(45,212,191,0.08)]",
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-16 -top-16 h-48 w-48 rounded-full bg-teal-400/10 blur-3xl dark:bg-teal-500/10" />
      <div className="pointer-events-none absolute -bottom-20 -left-10 h-56 w-56 rounded-full bg-cyan-400/10 blur-3xl dark:bg-cyan-500/10" />

      <AnimatePresence mode="wait">
        {!element ? (
          <motion.div
            key="placeholder"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.35 }}
            className="relative z-10 flex flex-1 flex-col items-center justify-center text-center"
          >
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-teal-300/60 bg-teal-50 shadow-md shadow-teal-100/50 dark:border-teal-400/30 dark:bg-teal-500/10 dark:shadow-[0_0_32px_rgba(45,212,191,0.2)]">
              <Atom className="h-8 w-8 text-teal-600 dark:text-teal-300" />
            </div>
            <h2 className="font-display text-xl font-bold text-neutral-900 dark:text-white sm:text-2xl">
              Element Explorer
            </h2>
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
              Select an element to explore its atomic structure and details.
            </p>
          </motion.div>
        ) : (
          <motion.div
            key={element.atomicNumber}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -16 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="relative z-10 flex flex-1 flex-col"
          >
            <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-700 dark:text-teal-300/80">
                  Atomic #{element.atomicNumber}
                </p>
                <h2 className="font-display text-3xl font-black text-neutral-900 dark:text-white sm:text-4xl">
                  {element.name}
                </h2>
                <p className="mt-1 font-display text-5xl font-black text-teal-700 dark:text-teal-300 sm:text-6xl">
                  {element.symbol}
                </p>
              </div>
              <span
                className={cn(
                  "rounded-full border px-3 py-1 text-xs font-semibold",
                  CATEGORY_STYLES[element.category].badge,
                )}
              >
                {CATEGORY_STYLES[element.category].label}
              </span>
            </div>

            <AtomicOrbitAnimation element={element} className="mb-5" />

            <RealWorldView element={element} className="mb-5" />

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-2">
              {element.atomicMassKind === "mass-number" ? (
                <DetailStat
                  icon={Scale}
                  label="Mass number"
                  value={String(element.atomicMass)}
                  note={massNumberNote(element) ?? undefined}
                />
              ) : (
                <DetailStat icon={Scale} label="Atomic Mass" value={`${element.atomicMass} u`} />
              )}
              <DetailStat icon={Layers} label="Period" value={String(element.period)} />
              <DetailStat icon={Hash} label="Group" value={element.group ? String(element.group) : "—"} />
              <DetailStat icon={Sparkles} label="Electrons" value={String(element.atomicNumber)} />
            </div>

            <motion.p
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="mt-5 text-sm leading-relaxed text-neutral-600 dark:text-neutral-300"
            >
              {element.description}
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function DetailStat({
  icon: Icon,
  label,
  value,
  note,
}: {
  icon: typeof Scale;
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="rounded-xl border border-neutral-200/50 bg-neutral-100/70 px-3 py-2.5 text-neutral-800 backdrop-blur-sm dark:border-white/10 dark:bg-white/5 dark:text-neutral-200">
      <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
        <Icon className="h-3 w-3 text-teal-600 dark:text-teal-400" />
        {label}
      </div>
      <p className="font-display text-lg font-bold text-neutral-900 dark:text-white">{value}</p>
      {note && <p className="mt-0.5 text-[10px] leading-snug text-neutral-500 dark:text-neutral-400">{note}</p>}
    </div>
  );
}
