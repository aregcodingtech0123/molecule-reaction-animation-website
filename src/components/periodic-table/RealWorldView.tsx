"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ExternalLink, Eye, Loader2 } from "lucide-react";
import { GasCloudVisualization } from "@/components/periodic-table/GasCloudVisualization";
import { SolidPlaceholderView } from "@/components/periodic-table/SolidPlaceholderView";
import { isGaseousAtSTP } from "@/lib/periodic-table/physical-state";
import { useElementRealWorldView } from "@/lib/periodic-table/useElementRealWorldView";
import type { ChemicalElement } from "@/lib/periodic-table/types";
import { cn } from "@/lib/utils";

interface RealWorldViewProps {
  element: ChemicalElement;
  className?: string;
}

export function RealWorldView({ element, className }: RealWorldViewProps) {
  const { status, wiki } = useElementRealWorldView(element);
  const isGas = isGaseousAtSTP(element.atomicNumber);

  return (
    <section className={cn("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <Eye className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
        <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-700 dark:text-teal-300/85">
          Real-world View
        </h3>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={`${element.atomicNumber}-${isGas ? "gas" : status}`}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.32 }}
        >
          {isGas ? (
            <GasCloudVisualization element={element} />
          ) : status === "loading" ? (
            <div className="flex h-52 w-full shrink-0 items-center justify-center rounded-2xl border border-neutral-200/70 bg-neutral-100/60 dark:border-white/10 dark:bg-neutral-900/40">
              <Loader2 className="h-6 w-6 animate-spin text-teal-600 dark:text-teal-400" />
            </div>
          ) : status === "ready" && wiki ? (
            <WikipediaImageCard element={element} wiki={wiki} />
          ) : (
            <div className="space-y-2">
              <SolidPlaceholderView element={element} />
              <p className="text-[10px] text-neutral-600 dark:text-neutral-400">
                Wikipedia image unavailable — showing phase placeholder.
              </p>
            </div>
          )}
        </motion.div>
      </AnimatePresence>
    </section>
  );
}

function WikipediaImageCard({
  element,
  wiki,
}: {
  element: ChemicalElement;
  wiki: NonNullable<ReturnType<typeof useElementRealWorldView>["wiki"]>;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-neutral-200/70 bg-neutral-50/80 dark:border-white/10 dark:bg-black/25">
      <div className="relative h-52 w-full shrink-0 overflow-hidden bg-neutral-100/80 p-2.5 dark:bg-neutral-900/40">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={wiki.imageUrl}
          alt={`${element.name} — real-world appearance`}
          className="h-full w-full object-contain"
          loading="lazy"
          decoding="async"
        />
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-neutral-200/70 px-3 py-2 dark:border-white/10">
        <p className="truncate text-[10px] text-neutral-600 dark:text-neutral-400">
          Source: Wikipedia · {wiki.pageTitle}
        </p>
        <a
          href={wiki.attribution}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex shrink-0 items-center gap-1 text-[10px] text-teal-700 hover:text-teal-900 dark:text-teal-300/90 dark:hover:text-teal-200"
        >
          View article
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
