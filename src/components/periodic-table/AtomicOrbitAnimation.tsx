"use client";

import { motion } from "framer-motion";
import { electronShells } from "@/lib/periodic-table/electron-configuration";
import type { ChemicalElement } from "@/lib/periodic-table/types";
import { CATEGORY_STYLES } from "@/lib/periodic-table/category-styles";

interface AtomicOrbitAnimationProps {
  element: ChemicalElement;
  className?: string;
}

export function AtomicOrbitAnimation({ element, className }: AtomicOrbitAnimationProps) {
  // NIST ground-state shells; null for elements NIST does not list (Z 109-118): then only the nucleus is drawn.
  const verifiedShells = electronShells(element.atomicNumber);
  const shells = verifiedShells ?? [];
  const orbitColor = CATEGORY_STYLES[element.category].orbit;
  const maxRadius = 88;
  const shellStep = shells.length > 1 ? maxRadius / shells.length : maxRadius;

  return (
    <div className={className}>
      <div className="relative mx-auto aspect-square w-full max-w-[280px]">
        <motion.div
          className="absolute inset-0 rounded-full blur-3xl opacity-40"
          style={{ background: `radial-gradient(circle, ${orbitColor}55 0%, transparent 70%)` }}
          animate={{ scale: [1, 1.08, 1], opacity: [0.35, 0.55, 0.35] }}
          transition={{ duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
        />

        {shells.map((electronCount, shellIndex) => {
          const radius = shellStep * (shellIndex + 1);
          const duration = 6 + shellIndex * 2.5;
          const reverse = shellIndex % 2 === 1;

          return (
            <motion.div
              key={`${element.atomicNumber}-shell-${shellIndex}`}
              className="absolute left-1/2 top-1/2 rounded-full border"
              style={{
                width: radius * 2,
                height: radius * 2,
                marginLeft: -radius,
                marginTop: -radius,
                borderColor: `${orbitColor}55`,
                boxShadow: `0 0 18px ${orbitColor}33`,
              }}
              animate={{ rotate: reverse ? -360 : 360 }}
              transition={{ duration, repeat: Infinity, ease: "linear" }}
            >
              {Array.from({ length: electronCount }).map((_, electronIndex) => {
                const angle = (360 / electronCount) * electronIndex;
                return (
                  <motion.span
                    key={`${element.atomicNumber}-e-${shellIndex}-${electronIndex}`}
                    className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
                    style={{
                      transformOrigin: `50% ${radius}px`,
                      rotate: `${angle}deg`,
                      backgroundColor: orbitColor,
                      boxShadow: `0 0 10px ${orbitColor}`,
                    }}
                    animate={{ scale: [1, 1.35, 1], opacity: [0.75, 1, 0.75] }}
                    transition={{
                      duration: 1.6 + electronIndex * 0.08,
                      repeat: Infinity,
                      ease: "easeInOut",
                    }}
                  />
                );
              })}
            </motion.div>
          );
        })}

        <motion.div
          key={element.atomicNumber}
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: "spring", stiffness: 260, damping: 18 }}
          className="absolute left-1/2 top-1/2 z-10 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-neutral-200/80 bg-white/80 backdrop-blur-md dark:border-white/20 dark:bg-black/50"
          style={{ boxShadow: `0 0 40px ${orbitColor}66` }}
        >
          <span className="font-display text-2xl font-black text-neutral-900 dark:text-white">{element.symbol}</span>
        </motion.div>
      </div>
      {verifiedShells === null && (
        <p className="mt-2 text-center text-xs text-neutral-500 dark:text-neutral-400">
          Electron shells are not shown: the ground-state configuration of this element has not been measured.
        </p>
      )}
    </div>
  );
}
