"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { MoleculeViewer } from "@/components/canvas/MoleculeViewer";
import { ReactionStage } from "@/components/reactions/ReactionStage";
import { ALL_MOLECULES, RECENT_MOLECULE_IDS } from "@/lib/molecules/data";
import {
  getDefaultMoleculeId,
  resolveMoleculeIdFromQuery,
} from "@/lib/molecules/resolve-molecule-id";
import type { MoleculeData } from "@/lib/molecules/types";
import { ALL_REACTIONS } from "@/lib/reactions/data";
import { useStudioMode } from "@/context/StudioModeContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { localizeMolecule, localizeReaction } from "@/lib/i18n/localize";
import { Atom, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFocus } from "@/context/FocusContext";
import { ExploreSidebarPanel } from "@/components/explore/ExploreSidebarPanel";
import { ExploreSidebarToggle } from "@/components/explore/ExploreSidebarToggle";
import { ExploreMobileDrawer } from "@/components/explore/ExploreMobileDrawer";
import { ExploreQuickFactsPanel } from "@/components/explore/ExploreQuickFactsPanel";
import { ReactionPlaybackControls } from "@/components/reactions/ReactionPlaybackControls";
import type { ReactionAnimationStatus } from "@/lib/reactions/animation/status";

function useExploreMoleculeOrder(): MoleculeData[] {
  return useMemo(() => {
    const recentIdSet = new Set(RECENT_MOLECULE_IDS);
    const head = RECENT_MOLECULE_IDS.map((id) => ALL_MOLECULES.find((m) => m.id === id)).filter(
      (m): m is MoleculeData => m != null,
    );
    const tail = ALL_MOLECULES.filter((m) => !recentIdSet.has(m.id));
    return [...head, ...tail];
  }, []);
}

function moleculeIdFromSearchParams(
  searchParams: ReturnType<typeof useSearchParams>,
): string {
  const param = searchParams.get("molecule") ?? searchParams.get("id");
  return resolveMoleculeIdFromQuery(param) ?? getDefaultMoleculeId();
}

export default function ExplorePage() {
  const searchParams = useSearchParams();
  const { activeMode, setActiveMode } = useStudioMode();
  const { locale, t } = useLanguage();
  const { ui, isWhiteLab } = useTheme();
  const rawMolecules = useExploreMoleculeOrder();
  const molecules = useMemo(
    () => rawMolecules.map((m) => localizeMolecule(m, locale)),
    [rawMolecules, locale],
  );
  const reactions = useMemo(
    () => ALL_REACTIONS.map((r) => localizeReaction(r, locale)),
    [locale],
  );
  const [activeMoleculeId, setActiveMoleculeId] = useState(() =>
    moleculeIdFromSearchParams(searchParams),
  );
  const [activeReactionId, setActiveReactionId] = useState(ALL_REACTIONS[0]?.id ?? "");
  const [playSignal, setPlaySignal] = useState(0);
  const [resetSignal, setResetSignal] = useState(0);
  const [reactionStatus, setReactionStatus] = useState<ReactionAnimationStatus>("idle");

  const activeMolecule = molecules.find((m) => m.id === activeMoleculeId) ?? molecules[0];
  const activeReaction = reactions.find((r) => r.id === activeReactionId) ?? reactions[0];

  const selectMolecule = useCallback((id: string) => {
    setActiveMoleculeId(id);
  }, []);

  const { clearFocus } = useFocus();

  useEffect(() => {
    const param = searchParams.get("molecule") ?? searchParams.get("id");
    if (!param) return;
    const resolved = resolveMoleculeIdFromQuery(param);
    if (resolved) {
      setActiveMoleculeId(resolved);
      setActiveMode("explorer");
    }
  }, [searchParams, setActiveMode]);

  useEffect(() => {
    clearFocus();
  }, [activeMoleculeId, clearFocus]);

  const selectReaction = useCallback((id: string) => {
    setReactionStatus("idle");
    setPlaySignal(0);
    setResetSignal((n) => n + 1);
    setActiveReactionId(id);
  }, []);

  useEffect(() => {
    if (activeMode === "reaction") return;
    const timer = window.setTimeout(() => setReactionStatus("idle"), 0);
    return () => window.clearTimeout(timer);
  }, [activeMode]);

  const handleResetReaction = useCallback(() => {
    setResetSignal((n) => n + 1);
    setReactionStatus("idle");
  }, []);

  const handlePlayReaction = useCallback(() => {
    if (activeMode !== "reaction" || reactionStatus === "playing") return;
    if (reactionStatus === "completed") {
      setResetSignal((n) => n + 1);
    }
    setReactionStatus("playing");
    setPlaySignal((n) => n + 1);
  }, [activeMode, reactionStatus]);

  const handleReactionSequenceEnd = useCallback(() => {
    setReactionStatus("completed");
  }, []);

  const sidebarProps = {
    activeMode,
    molecules,
    reactions,
    activeMoleculeId,
    activeReactionId,
    onSelectMolecule: selectMolecule,
    onSelectReaction: selectReaction,
  };

  const headerTitle = (
    <span className="text-gradient">
      {activeMode === "explorer" ? t.title_molecule_explorer : t.title_reaction_lab}
    </span>
  );

  const headerSubtitle =
    activeMode === "explorer" ? t.subtitle_molecule_explorer : t.subtitle_reaction;

  return (
    <main className="min-h-screen flex flex-col lg:overflow-hidden">
      <ExploreMobileDrawer {...sidebarProps} />

      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1 }}
        className="relative z-20 pt-20 md:pt-24 pb-4 md:pb-6 px-4 md:px-6 text-center flex-shrink-0"
      >
        <div
          className={cn(
            "inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs mb-3 md:mb-4",
            ui.panel.badge,
          )}
        >
          {activeMode === "explorer" ? (
            <Atom className={cn("w-3.5 h-3.5", ui.typography.iconAccent)} />
          ) : (
            <Sparkles className={cn("w-3.5 h-3.5", ui.typography.iconAccentAlt)} />
          )}
          {activeMode === "explorer" ? t.badge_interactive_studio : t.badge_reaction_animation}
        </div>
        <AnimatePresence mode="wait">
          <motion.h1
            key={activeMode + "-title"}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="text-2xl sm:text-3xl md:text-5xl font-bold mb-2"
          >
            {headerTitle}
          </motion.h1>
        </AnimatePresence>
        <AnimatePresence mode="wait">
          <motion.p
            key={activeMode + "-sub"}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.25 }}
            className={cn("text-sm max-w-md mx-auto px-2", ui.typography.subtitle)}
          >
            {headerSubtitle}
          </motion.p>
        </AnimatePresence>
      </motion.div>

      {/* lg+: 3-column row | <lg: scrollable stack */}
      <div
        className={cn(
          "flex-1 min-h-0 px-4 md:px-6 pb-6 md:pb-8 gap-4 md:gap-5",
          "flex flex-col overflow-y-auto lg:overflow-hidden",
          "lg:flex-row lg:px-6",
        )}
      >
        {/* Desktop sidebar — hidden below lg */}
        <ExploreSidebarPanel {...sidebarProps} />

        {/* Canvas + Quick Facts: stack on mobile, 2-col on md, canvas grows on lg */}
        <div className="flex flex-col md:grid md:grid-cols-2 lg:contents gap-4 md:gap-5 min-h-0 flex-1">
          <div className="flex flex-col gap-2 min-h-0 lg:contents">
            <ExploreSidebarToggle activeMode={activeMode} className="self-start flex-shrink-0" />

            <motion.div
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.7, delay: 0.15 }}
            className={cn(
              "relative rounded-2xl md:rounded-3xl overflow-hidden flex-shrink-0 canvas-card canvas-stage",
              "h-[50vh] min-h-[260px] max-h-[420px]",
              "md:min-h-[320px] md:max-h-none md:h-full md:min-h-0",
              "lg:flex-1 lg:min-h-[420px] lg:h-auto lg:max-h-none",
            )}
          >
            <div
              className={cn(
                "absolute inset-0 pointer-events-none z-10 rounded-2xl md:rounded-3xl canvas-vignette",
                isWhiteLab && "canvas-vignette-light",
              )}
            />

            <AnimatePresence mode="wait">
              {activeMode === "explorer" ? (
                <motion.div
                  key="view-explorer"
                  className="absolute inset-0 z-[5]"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.02 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                >
                  <MoleculeViewer initialMoleculeId={activeMoleculeId} key={activeMoleculeId} />
                </motion.div>
              ) : (
                <motion.div
                  key="view-reaction"
                  className="absolute inset-0 z-[5]"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1.02 }}
                  transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                >
                  <ReactionStage
                    reaction={activeReaction}
                    playSignal={playSignal}
                    resetSignal={resetSignal}
                    onSequenceEnd={handleReactionSequenceEnd}
                    className="h-full min-h-[260px]"
                  />

                  <div className="absolute top-3 left-3 right-3 md:top-5 md:left-5 md:right-5 z-20 flex flex-wrap items-start justify-between gap-2 md:gap-3 pointer-events-none">
                    <motion.div
                      key={activeReaction.id + "-rxn-header"}
                      initial={{ opacity: 0, x: -16 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="pointer-events-auto max-w-[min(100%,20rem)]"
                    >
                      <div
                        className={cn(
                          "px-4 py-3 md:px-5 md:py-3.5 rounded-2xl border",
                          ui.panel.overlay,
                          ui.panel.overlayBorder,
                        )}
                        style={{
                          borderColor: isWhiteLab
                            ? activeReaction.accentColor
                            : `${activeReaction.accentColor}33`,
                          boxShadow: isWhiteLab
                            ? `0 4px 14px ${activeReaction.accentColor}18`
                            : `0 0 24px ${activeReaction.accentColor}12`,
                        }}
                      >
                        <p
                          className="text-[10px] font-semibold uppercase tracking-widest mb-1"
                          style={{ color: activeReaction.accentColor }}
                        >
                          {activeReaction.reactionType}
                        </p>
                        <h2 className={cn("text-base md:text-lg font-bold leading-tight", ui.typography.title)}>
                          {activeReaction.name}
                        </h2>
                        <p className={cn("text-xs font-mono mt-1 leading-snug", ui.typography.mono)}>
                          {activeReaction.equation}
                        </p>
                      </div>
                    </motion.div>

                    <ReactionPlaybackControls
                      status={reactionStatus}
                      accentColor={activeReaction.accentColor}
                      onPlay={handlePlayReaction}
                      onReset={handleResetReaction}
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
          </div>

          {/* Quick Facts: below canvas on mobile; beside on md; right column on lg */}
          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className={cn(
              "flex flex-col gap-3 flex-shrink-0 pb-4 md:pb-0",
              "md:overflow-y-auto md:max-h-[50vh] md:scrollbar-thin",
              "lg:w-52 lg:max-h-full lg:flex-shrink-0 lg:overflow-y-auto lg:pr-1",
            )}
          >
            <ExploreQuickFactsPanel
              activeMode={activeMode}
              activeMolecule={activeMolecule}
              activeReaction={activeReaction}
            />
          </motion.div>
        </div>
      </div>
    </main>
  );
}
