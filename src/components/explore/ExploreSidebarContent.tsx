"use client";

import { motion, AnimatePresence } from "framer-motion";
import { FlaskConical, Sparkles } from "lucide-react";
import type { MoleculeData } from "@/lib/molecules/types";
import type { ReactionData } from "@/lib/reactions/types";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import type { StudioActiveMode } from "@/context/StudioModeContext";
import { translateDifficulty } from "@/lib/i18n/localize";
import { cn } from "@/lib/utils";

interface SidebarListItemProps {
  isActive: boolean;
  accent: string;
  index: number;
  onSelect: () => void;
  children: React.ReactNode;
}

function SidebarListItem({ isActive, accent, index, onSelect, children }: SidebarListItemProps) {
  const { ui, isWhiteLab } = useTheme();

  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, x: -16 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.08 + index * 0.03 }}
      onClick={onSelect}
      className={cn(
        "text-left p-3.5 rounded-2xl w-full",
        "cursor-pointer transition-all duration-200 border",
        "active:scale-[0.99] active:opacity-95",
        isActive ? cn(ui.sidebar.itemActive, ui.sidebar.itemHover) : cn(ui.sidebar.itemIdle, ui.sidebar.itemHover),
      )}
      style={
        isActive
          ? isWhiteLab
            ? {
                borderColor: accent,
                boxShadow: `0 4px 12px ${accent}22, 0 2px 4px rgb(148 163 184 / 0.15)`,
              }
            : {
                background: `${accent}15`,
                borderColor: `${accent}50`,
                boxShadow: `0 0 20px ${accent}18`,
              }
          : undefined
      }
    >
      {children}
    </motion.button>
  );
}

export interface ExploreSidebarContentProps {
  activeMode: StudioActiveMode;
  molecules: MoleculeData[];
  reactions: ReactionData[];
  activeMoleculeId: string;
  activeReactionId: string;
  onSelectMolecule: (id: string) => void;
  onSelectReaction: (id: string) => void;
  onAfterSelect?: () => void;
  className?: string;
}

export function ExploreSidebarContent({
  activeMode,
  molecules,
  reactions,
  activeMoleculeId,
  activeReactionId,
  onSelectMolecule,
  onSelectReaction,
  onAfterSelect,
  className,
}: ExploreSidebarContentProps) {
  const { t } = useLanguage();
  const { ui, isWhiteLab } = useTheme();

  const pickMolecule = (id: string) => {
    onSelectMolecule(id);
    onAfterSelect?.();
  };

  const pickReaction = (id: string) => {
    onSelectReaction(id);
    onAfterSelect?.();
  };

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <AnimatePresence mode="wait">
        {activeMode === "explorer" ? (
          <motion.div
            key="sidebar-explorer"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col gap-3"
          >
            <p className={cn("text-xs uppercase tracking-widest mb-1 px-1", ui.sidebar.sectionLabel)}>
              {t.tab_molecules}
            </p>
            {molecules.map((mol, i) => {
              const accent = mol.education?.color ?? "#818cf8";
              const isActive = mol.id === activeMoleculeId;
              return (
                <SidebarListItem
                  key={mol.id}
                  isActive={isActive}
                  accent={accent}
                  index={i}
                  onSelect={() => pickMolecule(mol.id)}
                >
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div
                      className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: isWhiteLab ? `${accent}18` : `${accent}20` }}
                    >
                      <FlaskConical className="w-3.5 h-3.5" style={{ color: accent }} />
                    </div>
                    <span
                      className={cn(
                        "text-sm font-semibold transition-colors truncate min-w-0",
                        isActive ? ui.sidebar.nameActive : ui.sidebar.nameIdle,
                      )}
                    >
                      {mol.name}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "text-xs font-mono pl-[34px]",
                      isActive ? ui.sidebar.formulaActive : ui.sidebar.formulaIdle,
                    )}
                    style={!isWhiteLab && isActive ? { color: `${accent}90` } : undefined}
                  >
                    {mol.formula}
                  </p>
                  {isActive && (
                    <p className={cn("text-xs mt-1 pl-[34px] leading-snug line-clamp-2", ui.sidebar.meta)}>
                      {mol.atoms.length}a · {mol.bonds.length}b
                    </p>
                  )}
                </SidebarListItem>
              );
            })}
          </motion.div>
        ) : (
          <motion.div
            key="sidebar-reaction"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col gap-3"
          >
            <p className={cn("text-xs uppercase tracking-widest mb-1 px-1", ui.sidebar.sectionLabel)}>
              {t.tab_reactions}
            </p>
            {reactions.map((rxn, i) => {
              const accent = rxn.accentColor;
              const isActive = rxn.id === activeReactionId;
              return (
                <SidebarListItem
                  key={rxn.id}
                  isActive={isActive}
                  accent={accent}
                  index={i}
                  onSelect={() => pickReaction(rxn.id)}
                >
                  <div className="flex items-center gap-2.5 mb-1.5">
                    <div
                      className="w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: isWhiteLab ? `${accent}18` : `${accent}22` }}
                    >
                      <Sparkles className="w-3.5 h-3.5" style={{ color: accent }} />
                    </div>
                    <span
                      className={cn(
                        "text-sm font-semibold transition-colors truncate min-w-0",
                        isActive ? ui.sidebar.nameActive : ui.sidebar.nameIdle,
                      )}
                    >
                      {rxn.name}
                    </span>
                  </div>
                  <p
                    className={cn(
                      "text-[11px] font-mono pl-[34px] leading-snug line-clamp-2",
                      isActive ? ui.sidebar.formulaActive : ui.sidebar.formulaIdle,
                    )}
                    style={!isWhiteLab && isActive ? { color: `${accent}aa` } : undefined}
                  >
                    {rxn.formula}
                  </p>
                  {isActive && (
                    <p
                      className={cn(
                        "text-[10px] uppercase tracking-wide mt-1.5 pl-[34px] flex flex-wrap gap-1.5",
                        ui.sidebar.meta,
                      )}
                    >
                      <span style={{ color: isWhiteLab ? accent : `${accent}99` }}>{rxn.category}</span>
                      <span>·</span>
                      <span>{translateDifficulty(rxn.difficulty, t)}</span>
                    </p>
                  )}
                </SidebarListItem>
              );
            })}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
