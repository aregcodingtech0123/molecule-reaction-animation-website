"use client";

import { motion } from "framer-motion";
import { Ruler, X } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useMeasurement } from "@/context/MeasurementContext";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

interface MeasurementModeToggleProps {
  accentColor?: string;
  className?: string;
  compact?: boolean;
}

export function MeasurementModeToggle({
  accentColor = "#818cf8",
  className,
  compact = false,
}: MeasurementModeToggleProps) {
  const { t } = useLanguage();
  const { isWhiteLab } = useTheme();
  const {
    measurementMode,
    toggleMeasurementMode,
    selectedAtomIds,
    clearMeasurement,
  } = useMeasurement();

  const hasSelection = selectedAtomIds.length > 0;

  return (
    <div className={cn("flex items-center gap-1.5", className)}>
      <motion.button
        type="button"
        onClick={toggleMeasurementMode}
        title={t.measure_mode_title}
        aria-label={t.measure_mode_title}
        aria-pressed={measurementMode}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.98 }}
        className={cn(
          "flex items-center gap-2 rounded-xl border transition-all duration-200",
          compact ? "h-9 px-3" : "h-10 px-3.5",
          isWhiteLab ? "border-slate-200 bg-white/90 shadow-sm" : "glass border-white/10",
          measurementMode
            ? isWhiteLab
              ? "text-indigo-950 font-semibold"
              : "text-white font-semibold"
            : isWhiteLab
              ? "text-neutral-600 hover:text-neutral-900"
              : "text-gray-400 hover:text-white",
        )}
        style={
          measurementMode
            ? {
                background: `${accentColor}28`,
                boxShadow: `0 0 14px ${accentColor}35`,
                borderColor: `${accentColor}55`,
              }
            : undefined
        }
      >
        <Ruler className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} strokeWidth={measurementMode ? 2.5 : 1.75} />
        {!compact && (
          <span className="text-[11px] uppercase tracking-wider">{t.measure_mode}</span>
        )}
      </motion.button>

      {measurementMode && hasSelection && (
        <motion.button
          type="button"
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={clearMeasurement}
          title={t.measure_clear}
          aria-label={t.measure_clear}
          className={cn(
            "flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-[11px] font-medium uppercase tracking-wider transition-colors",
            isWhiteLab
              ? "border-slate-200 bg-white text-neutral-700 hover:bg-slate-50"
              : "border-white/10 bg-white/5 text-gray-400 hover:text-white hover:bg-white/10",
          )}
        >
          <X className="h-3.5 w-3.5" />
          {!compact && t.measure_clear}
        </motion.button>
      )}
    </div>
  );
}
