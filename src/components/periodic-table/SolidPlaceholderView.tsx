"use client";

import { motion } from "framer-motion";
import { CATEGORY_STYLES } from "@/lib/periodic-table/category-styles";
import { getPhysicalState } from "@/lib/periodic-table/physical-state";
import type { ChemicalElement } from "@/lib/periodic-table/types";
import { cn } from "@/lib/utils";

interface SolidPlaceholderViewProps {
  element: ChemicalElement;
  className?: string;
}

export function SolidPlaceholderView({ element, className }: SolidPlaceholderViewProps) {
  const style = CATEGORY_STYLES[element.category];
  const state = getPhysicalState(element.atomicNumber);

  return (
    <div
      className={cn(
        "relative flex h-52 w-full shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-neutral-200/70 bg-neutral-100/70 p-2.5 dark:border-white/10 dark:bg-neutral-900/40",
        className,
      )}
    >
      <div
        className="absolute inset-0 opacity-40"
        style={{
          backgroundImage: `
            linear-gradient(135deg, ${style.orbit}22 25%, transparent 25%),
            linear-gradient(225deg, ${style.orbit}22 25%, transparent 25%),
            linear-gradient(45deg, ${style.orbit}22 25%, transparent 25%),
            linear-gradient(315deg, ${style.orbit}22 25%, transparent 25%)
          `,
          backgroundSize: "28px 28px",
          backgroundPosition: "0 0, 14px 0, 14px -14px, 0 14px",
        }}
      />

      <motion.div
        animate={{ rotate: 360 }}
        transition={{ duration: 48, repeat: Infinity, ease: "linear" }}
        className="absolute h-40 w-40 rounded-full border border-dashed border-neutral-300/70 dark:border-white/10"
      />
      <motion.div
        animate={{ rotate: -360 }}
        transition={{ duration: 32, repeat: Infinity, ease: "linear" }}
        className="absolute h-28 w-28 rounded-full border border-neutral-300/70 dark:border-white/10"
      />

      <div className="relative z-10 text-center">
        <p className="font-display text-4xl font-black text-neutral-800 dark:text-white/90">{element.symbol}</p>
        <p className="mt-1 text-xs uppercase tracking-widest text-neutral-500 dark:text-neutral-400">
          {state === "liquid" ? "Liquid phase" : "Crystalline solid"}
        </p>
      </div>
    </div>
  );
}
