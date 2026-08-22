"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { History } from "lucide-react";
import { AtomModelScene } from "@/components/atom-models/AtomModelScene";
import { AtomModelTimeline, AtomModelInfoPanel } from "@/components/atom-models/AtomModelTimeline";
import { DEFAULT_ATOM_MODEL_ID } from "@/lib/atom-models/data";
import type { AtomModelId } from "@/lib/atom-models/types";
import { getAtomModelsBundle } from "@/lib/atom-models/content";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

export default function AtomModelsPage() {
  const { locale } = useLanguage();
  const { ui, isWhiteLab } = useTheme();
  const bundle = getAtomModelsBundle(locale);
  const [activeModelId, setActiveModelId] = useState<AtomModelId>(DEFAULT_ATOM_MODEL_ID);

  return (
    <main className="min-h-screen flex flex-col lg:overflow-hidden">
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-20 pt-20 md:pt-24 pb-4 md:pb-6 px-4 md:px-6 text-center flex-shrink-0"
      >
        <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs mb-3", ui.panel.badge)}>
          <History className={cn("w-3.5 h-3.5", ui.typography.iconAccent)} />
          {bundle.ui.atom_models_badge}
        </div>
        <h1 className="text-2xl sm:text-3xl md:text-5xl font-bold mb-2">
          <span className="text-gradient">{bundle.ui.atom_models_title}</span>
        </h1>
        <p className={cn("text-sm max-w-2xl mx-auto px-2", ui.typography.subtitle)}>
          {bundle.ui.atom_models_subtitle}
        </p>
      </motion.div>

      <div
        className={cn(
          "flex-1 min-h-0 px-4 md:px-6 pb-6 md:pb-8 gap-4 md:gap-6",
          "flex flex-col lg:flex-row lg:overflow-hidden",
        )}
      >
        {/* Timeline — left on desktop, top on mobile */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.1 }}
          className="lg:w-72 flex-shrink-0 lg:overflow-y-auto lg:max-h-full lg:pr-1 scrollbar-thin"
        >
          <AtomModelTimeline activeId={activeModelId} onSelect={setActiveModelId} />
        </motion.div>

        {/* Canvas + info */}
        <div className="flex flex-col xl:grid xl:grid-cols-[1fr_minmax(0,22rem)] gap-4 md:gap-6 flex-1 min-h-0">
          <motion.div
            key={activeModelId}
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.35 }}
            className="relative min-h-[320px] lg:min-h-[420px] flex-1"
          >
            <div
              className={cn(
                "absolute inset-0 pointer-events-none z-10 rounded-2xl lg:rounded-3xl canvas-vignette",
                isWhiteLab && "canvas-vignette-light",
              )}
            />
            <AtomModelScene modelId={activeModelId} className="absolute inset-0 h-full" />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 }}
            className="xl:overflow-y-auto xl:max-h-full scrollbar-thin pb-4 xl:pb-0"
          >
            <AtomModelInfoPanel modelId={activeModelId} />
          </motion.div>
        </div>
      </div>
    </main>
  );
}
