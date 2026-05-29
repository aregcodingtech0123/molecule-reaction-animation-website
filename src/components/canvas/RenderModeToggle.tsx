"use client";

import { motion } from "framer-motion";
import { CircleDot, Disc3, Radar } from "lucide-react";
import { useRenderMode, type RenderMode } from "@/context/RenderModeContext";
import { useTheme } from "@/context/ThemeContext";
import { useDeviceTier } from "@/hooks/useDeviceTier";
import { cn } from "@/lib/utils";

interface RenderModeToggleProps {
  accentColor?: string;
  className?: string;
}

const MODES: { id: RenderMode; icon: typeof CircleDot; label: string; shortLabel: string }[] = [
  { id: "ball-and-stick", icon: CircleDot, label: "Ball-and-stick", shortLabel: "Ball & Stick" },
  {
    id: "space-filling",
    icon: Disc3,
    label: "Space-filling (Van der Waals)",
    shortLabel: "Space-fill",
  },
  {
    id: "esps",
    icon: Radar,
    label: "Electrostatic potential surface",
    shortLabel: "ESPS",
  },
];

export function RenderModeToggle({
  accentColor = "#818cf8",
  className,
}: RenderModeToggleProps) {
  const { renderMode, setRenderMode } = useRenderMode();
  const { isWhiteLab } = useTheme();
  const { espsEnabled } = useDeviceTier();

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-xl p-0.5 glass shadow-lg",
        isWhiteLab ? "border-neutral-200/80" : "border-white/10",
        className,
      )}
      role="group"
      aria-label="Molecule render mode"
    >
      {MODES.map(({ id, icon: Icon, label, shortLabel }) => {
        const active = renderMode === id;
        const disabled = id === "esps" && !espsEnabled;
        const mobileEspsHint = disabled ? " (desktop only)" : "";
        return (
          <motion.button
            key={id}
            type="button"
            onClick={() => !disabled && setRenderMode(id)}
            title={disabled ? `${label} — unavailable on mobile` : label}
            aria-label={label + mobileEspsHint}
            aria-pressed={active}
            disabled={disabled}
            whileHover={disabled ? undefined : { scale: 1.02 }}
            whileTap={disabled ? undefined : { scale: 0.98 }}
            className={cn(
              "relative flex h-9 items-center justify-center rounded-lg transition-all duration-200 px-2.5 gap-1.5",
              disabled && "opacity-40 cursor-not-allowed",
              active
                ? isWhiteLab
                  ? "text-indigo-950 font-semibold"
                  : "text-white font-semibold"
                : isWhiteLab
                  ? "text-neutral-600 hover:text-neutral-900 hover:bg-slate-100"
                  : "text-gray-400 hover:text-white hover:bg-white/5",
            )}
            style={
              active
                ? {
                    background: `${accentColor}38`,
                    boxShadow: `0 0 16px ${accentColor}40`,
                  }
                : undefined
            }
          >
            <Icon className="h-3.5 w-3.5" strokeWidth={active ? 2.5 : 1.75} />
            <span
              className={cn(
                "text-[10px] uppercase tracking-wider transition-colors",
                active
                  ? isWhiteLab
                    ? "text-indigo-950"
                    : "text-white"
                  : isWhiteLab
                    ? "text-neutral-600"
                    : "text-gray-400",
              )}
            >
              {shortLabel}
            </span>
            {active && (
              <motion.span
                layoutId="render-mode-indicator"
                className="absolute inset-0 rounded-lg border-2 pointer-events-none"
                style={{ borderColor: accentColor }}
                transition={{ type: "spring", stiffness: 400, damping: 30 }}
              />
            )}
          </motion.button>
        );
      })}
    </div>
  );
}
