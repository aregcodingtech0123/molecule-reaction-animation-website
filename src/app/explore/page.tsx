"use client";

import { Suspense, useMemo, useState, useCallback, useEffect } from "react";
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
import { StudioModeToggle } from "@/components/canvas/CanvasToolbar";
import { StudioContextPills } from "@/components/layout/StudioContextPills";
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

function ExplorePageContent() {
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
    const tab = (searchParams.get("tab") ?? searchParams.get("mode") ?? "").toLowerCase();
    if (tab === "reactions" || tab === "reaction") {
      setActiveMode("reaction");
    }
    const reactionParam = searchParams.get("reaction");
    if (!reactionParam) return;
    const match = reactions.find((r) => r.id === reactionParam);
    if (match) {
      setActiveReactionId(match.id);
      setActiveMode("reaction");
    }
  }, [searchParams, setActiveMode, reactions]);

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
    <span className={cn("home-section-title", ui.accent.headline)}>
      {activeMode === "explorer" ? t.title_molecule_explorer : t.title_reaction_lab}
    </span>
  );

  const headerSubtitle =
    activeMode === "explorer" ? t.subtitle_molecule_explorer : t.subtitle_reaction;

  return (
    <main className="flex h-dvh max-h-dvh flex-col overflow-hidden pt-[4.25rem] sm:pt-[4.75rem] md:pt-20">
      <ExploreMobileDrawer {...sidebarProps} />

      {/* Compact workbench chrome — stays above the fold */}
      {/* CSS entrance (PERF-23): the title is the LCP element and must not wait for hydration. It slides
          without a fade: an element first painted at opacity 0 is not an LCP candidate at all. */}
      <header
        className="relative z-20 flex shrink-0 flex-col items-center gap-2 px-3 pb-2 pt-1 sm:px-4 sm:pb-2.5 md:px-6 animate-in ease-out fill-mode-both motion-reduce:animate-none slide-in-from-top-3 duration-450 delay-50"
      >
          <div className="flex w-full max-w-6xl flex-col items-center gap-2 sm:gap-2.5 md:flex-row md:items-center md:justify-between">
            <div className="flex min-w-0 flex-1 flex-col items-center gap-0.5 md:items-start">
              <div
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] sm:text-xs",
                  ui.panel.badge,
                )}
              >
                {activeMode === "explorer" ? (
                  <Atom className={cn("h-3 w-3 sm:h-3.5 sm:w-3.5", ui.typography.iconAccent)} />
                ) : (
                  <Sparkles className={cn("h-3 w-3 sm:h-3.5 sm:w-3.5", ui.typography.iconAccentAlt)} />
                )}
                {activeMode === "explorer" ? t.badge_interactive_studio : t.badge_reaction_animation}
              </div>
              {/* No entrance on first mount (PERF-23); switching modes still cross-fades the title. */}
              <AnimatePresence mode="wait" initial={false}>
                <motion.h1
                  key={activeMode + "-title"}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                  className="home-section-title truncate text-lg sm:text-xl md:text-2xl"
                >
                  {headerTitle}
                </motion.h1>
              </AnimatePresence>
              <p
                className={cn(
                  "hidden max-w-md truncate text-xs sm:block md:text-sm",
                  ui.typography.subtitle,
                )}
              >
                {headerSubtitle}
              </p>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-center gap-2">
              <StudioContextPills />
              <StudioModeToggle className="shrink-0" />
            </div>
          </div>
      </header>

      {/* Workbench row: sidebars scroll; canvas fills remaining height */}
      <div
        className={cn(
          "flex min-h-0 flex-1 gap-3 px-3 pb-3 sm:gap-4 sm:px-4 sm:pb-4 md:px-6 md:pb-5",
          "flex-col overflow-hidden",
          "lg:flex-row",
        )}
      >
        <ExploreSidebarPanel {...sidebarProps} />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 md:flex-row lg:contents">
          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 lg:contents">
            <ExploreSidebarToggle activeMode={activeMode} className="shrink-0 self-start lg:hidden" />

            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.55, delay: 0.1 }}
              className={cn(
                "relative min-h-0 flex-1 overflow-hidden rounded-2xl canvas-card canvas-stage md:rounded-3xl",
                "lg:min-h-0 lg:flex-1",
              )}
            >
              <div
                className={cn(
                  "pointer-events-none absolute inset-0 z-10 rounded-2xl canvas-vignette md:rounded-3xl",
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
                    <MoleculeViewer
                      moleculeId={activeMoleculeId}
                      molecules={rawMolecules}
                      onMoleculeChange={selectMolecule}
                    />
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
                      className="h-full min-h-0"
                    />

                    <div className="pointer-events-none absolute left-3 right-3 top-3 z-20 flex flex-wrap items-start justify-between gap-2 md:left-5 md:right-5 md:top-5 md:gap-3">
                      <motion.div
                        key={activeReaction.id + "-rxn-header"}
                        initial={{ opacity: 0, x: -16 }}
                        animate={{ opacity: 1, x: 0 }}
                        className="pointer-events-auto max-w-[min(100%,20rem)]"
                      >
                        <div
                          className={cn(
                            "rounded-2xl border px-4 py-3 md:px-5 md:py-3.5",
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
                            className="mb-1 text-[10px] font-semibold uppercase tracking-widest"
                            style={{ color: activeReaction.accentColor }}
                          >
                            {activeReaction.reactionType}
                          </p>
                          <h2
                            className={cn(
                              "text-base font-bold leading-tight md:text-lg",
                              ui.typography.title,
                            )}
                          >
                            {activeReaction.name}
                          </h2>
                          <p className={cn("mt-1 text-xs font-mono leading-snug", ui.typography.mono)}>
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

          <motion.aside
            initial={{ opacity: 0, x: 16 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            className={cn(
              "flex min-h-0 shrink-0 flex-col overflow-y-auto overscroll-contain scrollbar-thin",
              "max-h-[28%] md:max-h-none md:w-52 md:flex-none lg:w-56 lg:pr-1",
            )}
          >
            <ExploreQuickFactsPanel
              activeMode={activeMode}
              activeMolecule={activeMolecule}
              activeReaction={activeReaction}
            />
          </motion.aside>
        </div>
      </div>
    </main>
  );
}

/**
 * useSearchParams() opts a route into client-side rendering, which the static
 * prerender pass rejects unless the consumer sits behind a Suspense boundary.
 */
export default function ExplorePage() {
  return (
    <Suspense fallback={null}>
      <ExplorePageContent />
    </Suspense>
  );
}
