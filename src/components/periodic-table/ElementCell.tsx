"use client";

import { motion } from "framer-motion";
import { CATEGORY_STYLES } from "@/lib/periodic-table/category-styles";
import type { ChemicalElement } from "@/lib/periodic-table/types";
import { cn } from "@/lib/utils";

interface ElementCellProps {
  element: ChemicalElement;
  isActive: boolean;
  onSelect: (element: ChemicalElement) => void;
  compact?: boolean;
}

const CELL_TEXT = {
  number: "text-neutral-600 dark:text-neutral-300",
  symbol: "text-neutral-800 dark:text-neutral-100",
  mass: "text-neutral-500 dark:text-neutral-400",
} as const;

export function ElementCell({ element, isActive, onSelect, compact = false }: ElementCellProps) {
  const style = CATEGORY_STYLES[element.category];

  return (
    <motion.button
      type="button"
      onClick={() => onSelect(element)}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.97 }}
      className={cn(
        "group relative flex flex-col items-center justify-center rounded-lg border backdrop-blur-sm transition-shadow duration-300",
        compact ? "min-h-[2.75rem] p-0.5 sm:min-h-[3.25rem] sm:p-1" : "min-h-[3.25rem] p-1 sm:min-h-[3.75rem]",
        style.cell,
        style.cellHover,
        isActive && style.cellActive,
        isActive && "z-10",
      )}
      aria-label={`${element.name}, atomic number ${element.atomicNumber}`}
      aria-pressed={isActive}
    >
      <span
        className={cn(
          "absolute left-1 top-0.5 text-[7px] font-semibold sm:text-[8px]",
          CELL_TEXT.number,
        )}
      >
        {element.atomicNumber}
      </span>
      <span className={cn("font-display text-sm font-bold leading-none sm:text-base", CELL_TEXT.symbol)}>
        {element.symbol}
      </span>
      <span className={cn("mt-0.5 hidden truncate text-[8px] sm:block", CELL_TEXT.mass)}>
        {element.atomicMassKind === "mass-number" ? `[${element.atomicMass}]` : element.atomicMass.toFixed(2)}
      </span>

      <span
        className={cn(
          "pointer-events-none absolute inset-0 rounded-lg opacity-0 transition-opacity duration-300 group-hover:opacity-100",
          "ring-1 ring-teal-500/35 shadow-[0_0_14px_rgba(20,184,166,0.2)] dark:ring-teal-400/40 dark:shadow-[0_0_16px_rgba(45,212,191,0.25)]",
        )}
      />
    </motion.button>
  );
}

interface SeriesLabelProps {
  label: string;
  sublabel: string;
}

export function SeriesLabel({ label, sublabel }: SeriesLabelProps) {
  return (
    <div className="flex min-h-[2.75rem] flex-col items-center justify-center rounded-lg border border-neutral-200/80 bg-neutral-50/80 px-1 text-center dark:border-white/10 dark:bg-white/[0.03] sm:min-h-[3.25rem]">
      <span className="text-[8px] font-semibold uppercase tracking-wider text-teal-700 dark:text-teal-300/90 sm:text-[9px]">
        {label}
      </span>
      <span className="text-[7px] text-neutral-500 dark:text-neutral-400 sm:text-[8px]">{sublabel}</span>
    </div>
  );
}
