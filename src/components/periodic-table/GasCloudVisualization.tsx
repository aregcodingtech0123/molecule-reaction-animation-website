"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";
import { getEmissionSpectrum } from "@/lib/periodic-table/emission-spectrum";
import type { ChemicalElement } from "@/lib/periodic-table/types";
import { cn } from "@/lib/utils";

interface GasCloudVisualizationProps {
  element: ChemicalElement;
  className?: string;
}

interface ParticleSeed {
  id: number;
  x: number;
  y: number;
  size: number;
  duration: number;
  delay: number;
}

function createParticleSeeds(atomicNumber: number, count: number): ParticleSeed[] {
  let seed = atomicNumber * 9973;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };

  return Array.from({ length: count }, (_, id) => ({
    id,
    x: 12 + rand() * 76,
    y: 15 + rand() * 70,
    size: 2 + rand() * 4,
    duration: 2.8 + rand() * 3.5,
    delay: rand() * 1.5,
  }));
}

export function GasCloudVisualization({ element, className }: GasCloudVisualizationProps) {
  const spectrum = getEmissionSpectrum(element.atomicNumber);
  const particles = useMemo(
    () => createParticleSeeds(element.atomicNumber, 42),
    [element.atomicNumber],
  );

  return (
    <div className={cn("relative overflow-hidden rounded-2xl", className)}>
      <div
        className="absolute inset-0 opacity-30"
        style={{
          background: `radial-gradient(ellipse at 50% 60%, ${spectrum.glow} 0%, transparent 72%)`,
        }}
      />

      <div className="relative mx-auto h-52 w-full shrink-0 rounded-2xl border border-neutral-200/70 bg-neutral-100/60 p-3 backdrop-blur-sm dark:border-white/15 dark:bg-black/40">
        <div className="absolute inset-x-3 top-1/2 h-px -translate-y-1/2 bg-neutral-300/60 dark:bg-white/10" aria-hidden />
        <div className="absolute bottom-2 left-1/2 h-3 w-8 -translate-x-1/2 rounded-b-md border border-t-0 border-neutral-300/70 bg-neutral-200/40 dark:border-white/20 dark:bg-white/5" aria-hidden />

        <div className="relative h-full w-full overflow-hidden rounded-xl border border-neutral-200/60 bg-gradient-to-b from-neutral-100/50 via-neutral-200/40 to-neutral-300/50 dark:border-white/10 dark:from-black/20 dark:via-black/50 dark:to-black/70">
          <motion.div
            className="absolute inset-0"
            animate={{ opacity: [0.45, 0.85, 0.45] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
            style={{
              background: `radial-gradient(circle at 50% 55%, ${spectrum.primary}55 0%, ${spectrum.secondary}22 38%, transparent 72%)`,
              boxShadow: `inset 0 0 48px ${spectrum.glow}`,
            }}
          />

          {particles.map((particle) => (
            <motion.span
              key={particle.id}
              className="absolute rounded-full"
              style={{
                left: `${particle.x}%`,
                top: `${particle.y}%`,
                width: particle.size,
                height: particle.size,
                backgroundColor: spectrum.primary,
                boxShadow: `0 0 ${particle.size * 3}px ${spectrum.glow}`,
              }}
              animate={{
                x: [0, (particle.id % 2 === 0 ? 1 : -1) * 12, 0],
                y: [0, -10 - (particle.id % 5) * 2, 0],
                opacity: [0.35, 1, 0.35],
                scale: [0.85, 1.2, 0.85],
              }}
              transition={{
                duration: particle.duration,
                delay: particle.delay,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            />
          ))}

          <motion.div
            className="pointer-events-none absolute inset-y-4 left-3 w-1 rounded-full opacity-60"
            style={{ background: `linear-gradient(to bottom, transparent, ${spectrum.primary}, transparent)` }}
            animate={{ opacity: [0.35, 0.9, 0.35] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
          <motion.div
            className="pointer-events-none absolute inset-y-4 right-3 w-1 rounded-full opacity-60"
            style={{ background: `linear-gradient(to bottom, transparent, ${spectrum.secondary}, transparent)` }}
            animate={{ opacity: [0.9, 0.35, 0.9] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>
      </div>

      <p className="mt-2 text-center text-[10px] text-neutral-600 dark:text-neutral-400">
        Simulated discharge glow · {spectrum.label}
      </p>
    </div>
  );
}
