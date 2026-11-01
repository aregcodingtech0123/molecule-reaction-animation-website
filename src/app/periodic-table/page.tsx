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
        {/* CSS entrance (PERF-23): the heading is the LCP element and must not wait for hydration. It slides
            without a fade: an element first painted at opacity 0 is not an LCP candidate at all. */}
        <header className="mb-8 text-center lg:mb-10 animate-in ease-out fill-mode-both motion-reduce:animate-none slide-in-from-top-4 duration-300">
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
        </header>

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

        <p className={cn("mx-auto mt-8 max-w-4xl text-center text-xs leading-relaxed", ui.typography.subtitle)}>
          Data: atomic masses are the standard atomic weights from NIST,{" "}
          <a
            href="https://physics.nist.gov/cgi-bin/Compositions/stand_alone.pl"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            Atomic Weights and Isotopic Compositions for All Elements
          </a>
          , rounded to three decimals (where NIST gives an interval, one conventional value inside it is shown). Elements
          with no stable isotope have no standard weight: up to plutonium (94) they show the mass number NIST gives for the
          longest-lived isotope; from americium (95) on, where NIST gives none, the mass number of a known isotope.
          Electron shells are counted from the ground-state configurations in the NIST Atomic Spectra Database
          (Kramida, A., Ralchenko, Yu., Reader, J. and NIST ASD Team (2024), version 5.12,{" "}
          <a
            href="https://physics.nist.gov/asd"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-2"
          >
            physics.nist.gov/asd
          </a>
          , National Institute of Standards and Technology); electrons are grouped by principal quantum number.
          NIST lists no measured ground state for elements 109–118, so no shells are shown for them.
        </p>
      </div>
    </main>
  );
}
