"use client";

import { motion, AnimatePresence } from "framer-motion";
import { MoleculeScene } from "@/components/canvas/Scene";
import { WATER } from "@/lib/molecules/data";
import type { MoleculeData } from "@/lib/molecules/types";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";
import { FlaskConical, Sparkles } from "lucide-react";

interface AiLabCanvasProps {
  molecule: MoleculeData | null;
  className?: string;
  loading?: boolean;
}

export function AiLabCanvas({ molecule, className, loading = false }: AiLabCanvasProps) {
  const { t } = useLanguage();
  const { ui, isWhiteLab } = useTheme();
  const display = molecule ?? WATER;

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-2xl border canvas-card canvas-stage min-h-[280px]",
        ui.borders.subtle,
        className,
      )}
    >
      <div
        className={cn(
          "absolute inset-0 pointer-events-none z-10 rounded-2xl canvas-vignette",
          isWhiteLab && "canvas-vignette-light",
        )}
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={molecule?.id ?? "placeholder"}
          className="absolute inset-0 z-[5]"
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0.35, scale: 1.01 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <MoleculeScene
            molecule={display}
            autoRotate
            showLabels={false}
            enableZoom
            showRenderModeToggle
            showMeasurementToggle={false}
            measurementToggleClassName="hidden"
            toggleClassName="absolute top-4 right-4 z-20 pointer-events-auto"
          />
        </motion.div>
      </AnimatePresence>

      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/20 backdrop-blur-[2px] rounded-2xl">
          <div className={cn("flex items-center gap-2 px-4 py-2 rounded-full text-xs", ui.panel.overlay)}>
            <Sparkles className="h-4 w-4 text-indigo-400 animate-pulse" />
            <span className={ui.typography.subtitle}>{t.ai_generating_3d ?? "Building 3D structure…"}</span>
          </div>
        </div>
      )}

      {!molecule && !loading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 pointer-events-none px-6 text-center">
          <FlaskConical className={cn("w-12 h-12 opacity-30", ui.typography.iconMuted)} />
          <p className={cn("text-sm max-w-xs", ui.typography.muted)}>
            {t.ai_canvas_empty ?? "Ask the AI to visualize a molecule — it will appear here in 3D."}
          </p>
        </div>
      )}

      {molecule && (
        <div className="absolute top-4 left-4 z-20 pointer-events-none">
          <div className={cn("px-3 py-2 rounded-xl border text-xs", ui.panel.overlay, ui.borders.subtle)}>
            <p className={cn("font-semibold", ui.typography.title)}>{molecule.name}</p>
            <p className={cn("font-mono mt-0.5", ui.typography.monoMuted)}>{molecule.formula}</p>
          </div>
        </div>
      )}
    </div>
  );
}
