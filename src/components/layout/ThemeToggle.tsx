"use client";

import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { FlaskConical, Sparkles } from "lucide-react";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

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
      aria-label="Application theme"
    >
      <ThemeOption
        id="cyberpunk"
        active={theme === "cyberpunk"}
        label="Cyberpunk Glass"
        icon={<Sparkles className={cn("h-3.5 w-3.5", compact && "h-3 w-3")} />}
        onSelect={() => setTheme("cyberpunk")}
        compact={compact}
      />
      <ThemeOption
        id="white-lab"
        active={theme === "white-lab"}
        label="White Lab"
        icon={<FlaskConical className={cn("h-3.5 w-3.5", compact && "h-3 w-3")} />}
        onSelect={() => setTheme("white-lab")}
        compact={compact}
      />
    </div>
  );
}

function ThemeOption({
  id,
  active,
  label,
  icon,
  onSelect,
  compact,
}: {
  id: string;
  active: boolean;
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  compact?: boolean;
}) {
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
          ? "text-indigo-300 dark:text-indigo-200"
          : "text-neutral-500 hover:text-neutral-700 dark:hover:text-gray-300",
      )}
    >
      {active && (
        <motion.span
          layoutId="theme-pill"
          className="absolute inset-0 rounded-full bg-indigo-500/25 dark:bg-indigo-500/30 border border-indigo-400/30 shadow-[0_0_12px_rgba(99,102,241,0.25)]"
          transition={{ type: "spring", stiffness: 400, damping: 32 }}
        />
      )}
      <span className="relative z-10 opacity-90">{icon}</span>
      {!compact && <span className="relative z-10 hidden lg:inline">{id === "cyberpunk" ? "Cyber" : "Lab"}</span>}
    </motion.button>
  );
}
