"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { FlaskConical, Microscope } from "lucide-react";
import { RenderModeToggle } from "@/components/canvas/RenderModeToggle";
import { useStudioMode, type StudioActiveMode } from "@/context/StudioModeContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

export interface CanvasToolbarProps {
  /** Molecule accent for active render-mode glow */
  accentColor?: string;
  /** Show Ball & Stick / Space-fill / ESPS */
  showRenderModes?: boolean;
  /** Show Molecules / Reactions studio switch (Explore canvas only) */
  showStudioModes?: boolean;
  /** Extra controls (measure, labels, rotate, …) slotted after render modes */
  trailing?: ReactNode;
  className?: string;
  /** bottom-center (default) | bottom-right */
  position?: "bottom-center" | "bottom-right";
}

/**
 * Floating canvas HUD — scene/viewport tools live here, never in the global Navbar.
 */
export function CanvasToolbar({
  accentColor = "#818cf8",
  showRenderModes = true,
  showStudioModes = false,
  trailing,
  className,
  position = "bottom-center",
}: CanvasToolbarProps) {
  const { activeMode, setActiveMode } = useStudioMode();
  const { t } = useLanguage();
  const { isWhiteLab } = useTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
      className={cn(
        "pointer-events-none absolute z-30 flex max-w-[calc(100%-1.5rem)]",
        position === "bottom-center"
          ? "bottom-4 left-1/2 -translate-x-1/2 sm:bottom-5"
          : "bottom-4 right-4 sm:bottom-5 sm:right-5",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-auto flex max-w-full flex-wrap items-center justify-center gap-1.5 rounded-2xl border p-1.5 shadow-2xl backdrop-blur-xl sm:gap-2 sm:p-2",
          isWhiteLab
            ? "border-slate-200/90 bg-white/90 shadow-slate-300/30"
            : "border-white/12 bg-neutral-950/85 shadow-black/50",
        )}
        role="toolbar"
        aria-label="Canvas viewport tools"
      >
        {showStudioModes && (
          <>
            <StudioModeGroup
              activeMode={activeMode}
              onChange={setActiveMode}
              isWhiteLab={isWhiteLab}
              moleculesLabel={t.tab_molecules}
              reactionsLabel={t.tab_reactions}
            />
            {(showRenderModes || trailing) && (
              <span
                className={cn(
                  "mx-0.5 hidden h-7 w-px shrink-0 sm:block",
                  isWhiteLab ? "bg-slate-200" : "bg-white/15",
                )}
                aria-hidden
              />
            )}
          </>
        )}

        {showRenderModes && (
          <RenderModeToggle accentColor={accentColor} embedded />
        )}

        {trailing && (
          <>
            {showRenderModes && (
              <span
                className={cn(
                  "mx-0.5 hidden h-7 w-px shrink-0 sm:block",
                  isWhiteLab ? "bg-slate-200" : "bg-white/15",
                )}
                aria-hidden
              />
            )}
            <div className="flex items-center gap-1 sm:gap-1.5">{trailing}</div>
          </>
        )}
      </div>
    </motion.div>
  );
}

function StudioModeGroup({
  activeMode,
  onChange,
  isWhiteLab,
  moleculesLabel,
  reactionsLabel,
}: {
  activeMode: StudioActiveMode;
  onChange: (mode: StudioActiveMode) => void;
  isWhiteLab: boolean;
  moleculesLabel: string;
  reactionsLabel: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-xl p-0.5",
        isWhiteLab ? "bg-slate-100/90" : "bg-white/5",
      )}
      role="tablist"
      aria-label="Studio mode"
    >
      <StudioModeTab
        active={activeMode === "explorer"}
        icon={<Microscope className="h-3.5 w-3.5" />}
        label={moleculesLabel}
        onClick={() => onChange("explorer")}
        isWhiteLab={isWhiteLab}
      />
      <StudioModeTab
        active={activeMode === "reaction"}
        icon={<FlaskConical className="h-3.5 w-3.5" />}
        label={reactionsLabel}
        onClick={() => onChange("reaction")}
        isWhiteLab={isWhiteLab}
      />
    </div>
  );
}

function StudioModeTab({
  active,
  icon,
  label,
  onClick,
  isWhiteLab,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
  isWhiteLab: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] font-semibold transition-all sm:px-3",
        active
          ? isWhiteLab
            ? "bg-white text-teal-900 shadow-sm"
            : "bg-teal-500/25 text-teal-100 shadow-[0_0_16px_rgba(45,212,191,0.2)]"
          : isWhiteLab
            ? "text-neutral-600 hover:text-neutral-900"
            : "text-gray-400 hover:text-white",
      )}
    >
      <span className="opacity-90">{icon}</span>
      <span className="hidden whitespace-nowrap sm:inline">{label}</span>
    </button>
  );
}
