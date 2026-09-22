"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { TableProperties } from "lucide-react";
import { ElementDetailPanel } from "@/components/periodic-table/ElementDetailPanel";
import { PeriodicTableGrid } from "@/components/periodic-table/PeriodicTableGrid";
import { DEFAULT_ELEMENT } from "@/lib/periodic-table/elements";
import type { ChemicalElement } from "@/lib/periodic-table/types";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

export default function PeriodicTablePage() {
  const { ui, isWhiteLab } = useTheme();
  const [selected, setSelected] = useState<ChemicalElement | null>(null);

  return (
    <main className="min-h-screen pt-24 pb-16">
      <div className="mx-auto max-w-[90rem] px-4 sm:px-6">
        <motion.header
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 text-center lg:mb-10"
        >
          <div
            className={cn(
              "mb-4 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs",
              isWhiteLab
                ? "border-teal-200 bg-teal-50 text-teal-900"
                : "border-teal-400/30 bg-teal-500/10 text-teal-200",
            )}
          >
            <TableProperties className="h-3.5 w-3.5" />
            Interactive Periodic Table
          </div>
          <h1 className={cn("font-display text-3xl font-bold sm:text-4xl md:text-5xl", ui.typography.title)}>
            <span className={ui.accent.headline}>Explore the Elements</span>
          </h1>
          <p className={cn("mx-auto mt-3 max-w-2xl text-sm sm:text-base", ui.typography.subtitle)}>
            Click any element to reveal its atomic structure, properties, and role in the universe —
            rendered in a living split-view laboratory panel.
          </p>
        </motion.header>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.85fr)] lg:items-start xl:gap-8">
          <motion.section
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.08 }}
            className={cn(
              "rounded-3xl border p-4 backdrop-blur-md sm:p-6",
              isWhiteLab
                ? "border-slate-200 bg-white/80 shadow-lg shadow-slate-200/40"
                : "border-white/10 bg-white/[0.03] shadow-2xl shadow-black/30",
            )}
          >
            <PeriodicTableGrid selected={selected} onSelect={setSelected} />
          </motion.section>

          <motion.aside
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.12 }}
            className="lg:sticky lg:top-24"
          >
            <ElementDetailPanel element={selected} />

            {!selected && (
              <motion.button
                type="button"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.4 }}
                onClick={() => setSelected(DEFAULT_ELEMENT)}
                className={cn(
                  "mt-4 w-full rounded-xl border py-2.5 text-sm font-semibold transition-all",
                  isWhiteLab
                    ? "border-teal-200 bg-teal-50 text-teal-900 hover:bg-teal-100"
                    : "border-teal-400/35 bg-teal-500/10 text-teal-200 hover:border-teal-400/60 hover:shadow-[0_0_24px_rgba(45,212,191,0.2)]",
                )}
              >
                Try Carbon (C) as a demo
              </motion.button>
            )}
          </motion.aside>
        </div>
      </div>
    </main>
  );
}
