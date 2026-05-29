"use client";

import { AnimatePresence, motion } from "framer-motion";
import { X } from "lucide-react";
import { useExploreSidebar } from "@/context/ExploreSidebarContext";
import { useTheme } from "@/context/ThemeContext";
import { useLanguage } from "@/context/LanguageContext";
import { cn } from "@/lib/utils";
import type { ExploreSidebarContentProps } from "@/components/explore/ExploreSidebarContent";
import { ExploreSidebarContent } from "@/components/explore/ExploreSidebarContent";

type ExploreMobileDrawerProps = ExploreSidebarContentProps;

export function ExploreMobileDrawer(props: ExploreMobileDrawerProps) {
  const { isOpen, close } = useExploreSidebar();
  const { ui, isWhiteLab } = useTheme();
  const { t } = useLanguage();

  const drawerTitle =
    props.activeMode === "explorer"
      ? (t.explore_select_molecule ?? "Select Molecule")
      : (t.explore_view_reactions ?? "View Reactions");

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.button
            type="button"
            aria-label="Close sidebar"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="fixed inset-0 z-[70] bg-black/50 backdrop-blur-sm lg:hidden"
            onClick={close}
          />
          <motion.aside
            id="explore-sidebar-drawer"
            initial={{ x: "-100%" }}
            animate={{ x: 0 }}
            exit={{ x: "-100%" }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "fixed inset-y-0 left-0 z-[75] w-64 max-w-[min(100vw-2rem,20rem)]",
              "flex flex-col pt-[5.5rem] pb-6 px-4 shadow-2xl lg:hidden",
              "transform transition-transform",
              isWhiteLab ? "bg-white border-r border-slate-200" : "bg-neutral-950 border-r border-white/10",
            )}
            role="dialog"
            aria-modal="true"
            aria-label={drawerTitle}
          >
            <div className={cn("flex items-center justify-between mb-4 pb-3 border-b", ui.borders.divider)}>
              <p className={cn("text-xs font-semibold uppercase tracking-widest", ui.sidebar.sectionLabel)}>
                {props.activeMode === "explorer" ? t.tab_molecules : t.tab_reactions}
              </p>
              <button
                type="button"
                onClick={close}
                className={cn(
                  "rounded-lg p-2 transition-colors active:opacity-80",
                  ui.controls.iconButton,
                  isWhiteLab
                    ? "[@media(hover:hover)]:hover:bg-slate-100"
                    : "[@media(hover:hover)]:hover:bg-white/10",
                )}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto scrollbar-thin pr-1 -mr-1">
              <ExploreSidebarContent {...props} onAfterSelect={close} />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
