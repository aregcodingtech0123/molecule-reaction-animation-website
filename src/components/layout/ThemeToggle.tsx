"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { FlaskConical, Moon } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { THEME_UI } from "@/lib/theme/config";
import { APP_THEMES, type AppTheme } from "@/lib/theme/types";
import { cn } from "@/lib/utils";

const THEME_ICONS: Record<AppTheme, ReactNode> = {
  "night-lab": <Moon className="h-3.5 w-3.5" />,
  "white-lab": <FlaskConical className="h-3.5 w-3.5" />,
};

const THEME_SHORT_LABELS: Record<AppTheme, string> = {
  "night-lab": "Night",
  "white-lab": "Lab",
};

export function ThemeToggle({ compact }: { compact?: boolean }) {
  const { theme, setTheme, ui } = useTheme();

  return (
    <div
      className={cn(
        "flex items-center gap-0.5 rounded-full p-0.5 transition-colors duration-300",
        ui.nav.modeSwitchBg,
        "border backdrop-blur-md",
        compact ? "scale-90" : "",
      )}
      role="group"
      aria-label="Application theme: Night Lab or White Lab"
    >
      {APP_THEMES.map((themeId) => (
        <ThemeOption
          key={themeId}
          themeId={themeId}
          active={theme === themeId}
          label={THEME_UI[themeId].label}
          shortLabel={THEME_SHORT_LABELS[themeId]}
          icon={THEME_ICONS[themeId]}
          onSelect={() => setTheme(themeId)}
          compact={compact}
        />
      ))}
    </div>
  );
}

function ThemeOption({
  themeId,
  active,
  label,
  shortLabel,
  icon,
  onSelect,
  compact,
}: {
  themeId: AppTheme;
  active: boolean;
  label: string;
  shortLabel: string;
  icon: ReactNode;
  onSelect: () => void;
  compact?: boolean;
}) {
  const isNightLab = themeId === "night-lab";

  return (
    <motion.button
      type="button"
      onClick={onSelect}
      aria-label={label}
      aria-pressed={active}
      title={label}
      whileTap={{ scale: 0.96 }}
      className={cn(
        "relative flex items-center gap-1.5 rounded-full font-medium transition-colors duration-300",
        compact ? "px-2 py-1 text-[10px]" : "px-2.5 py-1.5 text-[11px]",
        active
          ? isNightLab
            ? "text-teal-100"
            : "text-indigo-950"
          : "text-neutral-500 hover:text-neutral-700 dark:hover:text-gray-300",
      )}
    >
      {active && (
        <motion.span
          layoutId="theme-pill"
          className={cn(
            "absolute inset-0 rounded-full border shadow-sm",
            isNightLab
              ? "bg-teal-500/20 border-teal-400/35 shadow-[0_0_12px_rgba(45,212,191,0.2)]"
              : "bg-indigo-100 border-indigo-400/70",
          )}
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        />
      )}
      <span className={cn("relative z-10 opacity-90", compact && "[&_svg]:h-3 [&_svg]:w-3")}>
        {icon}
      </span>
      {!compact && <span className="relative z-10 hidden lg:inline">{shortLabel}</span>}
    </motion.button>
  );
}
