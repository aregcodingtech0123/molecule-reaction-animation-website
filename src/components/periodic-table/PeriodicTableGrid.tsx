"use client";

import { motion } from "framer-motion";
import { ElementCell, SeriesLabel } from "@/components/periodic-table/ElementCell";
import { CATEGORY_STYLES, CATEGORY_LEGEND } from "@/lib/periodic-table/category-styles";
import { buildPeriodicGrid, GRID_COLS } from "@/lib/periodic-table/elements";
import type { ChemicalElement } from "@/lib/periodic-table/types";
import { cn } from "@/lib/utils";

const GRID = buildPeriodicGrid();

interface PeriodicTableGridProps {
  selected: ChemicalElement | null;
  onSelect: (element: ChemicalElement) => void;
  className?: string;
}

export function PeriodicTableGrid({ selected, onSelect, className }: PeriodicTableGridProps) {
  return (
    <div className={cn("space-y-4", className)}>
      <div className="overflow-x-auto pb-2 scrollbar-thin">
        <div
          className="mx-auto min-w-[42rem] sm:min-w-[52rem] lg:min-w-0"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
            gap: "0.35rem",
          }}
        >
          {GRID.flatMap((row, rowIndex) =>
            row.map((cell, colIndex) => {
              const key = `r${rowIndex}-c${colIndex}`;

              if (cell === null) {
                return <div key={key} aria-hidden className="min-h-[2.75rem] sm:min-h-[3.25rem]" />;
              }

              if (cell === "lanthanide-label") {
                return <SeriesLabel key={key} label="Lanthanides" sublabel="57 – 71" />;
              }

              if (cell === "actinide-label") {
                return <SeriesLabel key={key} label="Actinides" sublabel="89 – 103" />;
              }

              return (
                <ElementCell
                  key={key}
                  element={cell}
                  isActive={selected?.atomicNumber === cell.atomicNumber}
                  onSelect={onSelect}
                  compact={rowIndex >= 7}
                />
              );
            }),
          )}
        </div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="flex flex-wrap gap-2"
      >
        {CATEGORY_LEGEND.map((category) => (
          <span
            key={category}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[10px] font-medium sm:text-xs",
              CATEGORY_STYLES[category].badge,
            )}
          >
            {CATEGORY_STYLES[category].label}
          </span>
        ))}
      </motion.div>
    </div>
  );
}
