"use client";

import { List, FlaskConical } from "lucide-react";
import { useExploreSidebar } from "@/context/ExploreSidebarContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import type { StudioActiveMode } from "@/context/StudioModeContext";
import { cn } from "@/lib/utils";

interface ExploreSidebarToggleProps {
  activeMode: StudioActiveMode;
  className?: string;
}

/**
 * Mobile/tablet control — opens the off-canvas molecule/reaction list.
 * Visible below `lg` where the desktop sidebar is hidden.
 */
export function ExploreSidebarToggle({ activeMode, className }: ExploreSidebarToggleProps) {
  const { open, isOpen } = useExploreSidebar();
  const { t } = useLanguage();
  const { ui, isWhiteLab } = useTheme();

  const label =
    activeMode === "explorer"
      ? (t.explore_select_molecule ?? "Select Molecule")
      : (t.explore_view_reactions ?? "View Reactions");

  const Icon = activeMode === "explorer" ? List : FlaskConical;

  return (
    <button
      type="button"
      onClick={open}
      aria-expanded={isOpen}
      aria-controls="explore-sidebar-drawer"
      className={cn(
        "lg:hidden inline-flex items-center gap-2 rounded-xl border px-3.5 py-2.5",
        "text-sm font-semibold transition-all duration-300 active:scale-[0.98]",
        "shadow-md pointer-events-auto",
        isWhiteLab
          ? "bg-white border-slate-200 text-neutral-800 shadow-slate-200/40 [@media(hover:hover)]:hover:bg-slate-50"
          : "bg-neutral-900/90 border-white/15 text-gray-100 shadow-black/30 backdrop-blur-md [@media(hover:hover)]:hover:bg-neutral-800/90",
        className,
      )}
    >
      <Icon className={cn("w-4 h-4 flex-shrink-0", ui.typography.iconAccent)} />
      <span>{label}</span>
    </button>
  );
}
