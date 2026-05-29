"use client";

import { useEffect, useState, useMemo, useCallback, useRef, useLayoutEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { ReactionData } from "@/lib/reactions/types";
import { MOLECULE_MAP, WATER } from "@/lib/molecules/data";
import type { MoleculeData } from "@/lib/molecules/types";
import { MoleculeScene } from "@/components/canvas/Scene";
import { getReactionAnimation } from "@/lib/reactions/animation/registry";
import type { ReactionAnimationSample } from "@/lib/reactions/animation/types";
import { ReactionAnimationScene } from "@/components/reactions/animation/ReactionAnimationScene";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { getPhaseLabel, localizeMolecule } from "@/lib/i18n/localize";
import { cn } from "@/lib/utils";

const STEP_MS = 1100;

function moleculeForStep(moleculeId: string, locale: import("@/lib/i18n/types").Locale): MoleculeData {
  const base = MOLECULE_MAP[moleculeId] ?? WATER;
  return localizeMolecule(base, locale);
}

interface ReactionStageProps {
  reaction: ReactionData;
  playSignal: number;
  resetSignal?: number;
  onSequenceEnd?: () => void;
  className?: string;
}

export function ReactionStage({
  reaction,
  playSignal,
  resetSignal = 0,
  onSequenceEnd,
  className = "",
}: ReactionStageProps) {
  const { locale, t } = useLanguage();
  const { isWhiteLab } = useTheme();
  const animationDef = useMemo(
    () => getReactionAnimation(reaction.animationId ?? reaction.id),
    [reaction.animationId, reaction.id]
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [pulse, setPulse] = useState(false);
  const [animPhase, setAnimPhase] = useState<ReactionAnimationSample["phase"]>("idle");
  const onEndRef = useRef(onSequenceEnd);
  const legacyIntervalRef = useRef<number | null>(null);
  const legacyTimeoutRef = useRef<number | null>(null);

  const clearLegacyTimers = useCallback(() => {
    if (legacyIntervalRef.current != null) {
      window.clearInterval(legacyIntervalRef.current);
      legacyIntervalRef.current = null;
    }
    if (legacyTimeoutRef.current != null) {
      window.clearTimeout(legacyTimeoutRef.current);
      legacyTimeoutRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    onEndRef.current = onSequenceEnd;
  }, [onSequenceEnd]);

  const currentMolecule = useMemo(
    () => moleculeForStep(reaction.steps[stepIndex]?.moleculeId ?? "water", locale),
    [reaction.steps, stepIndex, locale],
  );

  const accent = reaction.accentColor;
  const step = reaction.steps[Math.min(stepIndex, reaction.steps.length - 1)];

  const handleAnimationComplete = useCallback(() => {
    onEndRef.current?.();
  }, []);

  const handlePhaseChange = useCallback((phase: ReactionAnimationSample["phase"]) => {
    setAnimPhase(phase);
  }, []);

  const runLegacySequence = useCallback(() => {
    clearLegacyTimers();
    const steps = reaction.steps;
    setStepIndex(0);

    if (steps.length <= 1) {
      setPulse(true);
      legacyTimeoutRef.current = window.setTimeout(() => {
        setPulse(false);
        onEndRef.current?.();
      }, 1600);
      return;
    }

    let idx = 0;
    legacyIntervalRef.current = window.setInterval(() => {
      idx += 1;
      if (idx >= steps.length) {
        clearLegacyTimers();
        onEndRef.current?.();
        return;
      }
      setStepIndex(idx);
    }, STEP_MS);
  }, [reaction.steps, clearLegacyTimers]);

  useEffect(() => {
    if (animationDef) return;
    if (playSignal === 0) return;
    const tid = window.setTimeout(() => {
      runLegacySequence();
    }, 0);
    return () => {
      window.clearTimeout(tid);
      clearLegacyTimers();
    };
  }, [playSignal, reaction.id, runLegacySequence, animationDef, clearLegacyTimers]);

  useEffect(() => {
    if (animationDef) return;
    if (resetSignal === 0) return;
    clearLegacyTimers();
    setStepIndex(0);
    setPulse(false);
    setAnimPhase("idle");
  }, [resetSignal, animationDef, clearLegacyTimers]);

  useEffect(() => {
    if (animationDef) return;
    const t = window.setTimeout(() => {
      setStepIndex(0);
      setPulse(false);
    }, 0);
    return () => window.clearTimeout(t);
  }, [reaction.id, animationDef]);

  useEffect(() => {
    if (!animationDef) return;
    const t = window.setTimeout(() => setAnimPhase("idle"), 0);
    return () => window.clearTimeout(t);
  }, [reaction.id, animationDef]);

  useEffect(() => () => clearLegacyTimers(), [clearLegacyTimers]);

  const caption = animationDef
    ? getPhaseLabel(animPhase, t)
    : step?.caption ?? t.reaction_step_default;

  if (animationDef) {
    return (
      <div className={`relative w-full h-full overflow-hidden ${className}`}>
        <ReactionAnimationScene
          definition={animationDef}
          accentColor={accent}
          playSignal={playSignal}
          resetSignal={resetSignal}
          onComplete={handleAnimationComplete}
          onPhaseChange={handlePhaseChange}
          className="h-full min-h-[420px]"
        />
        <div
          className="absolute inset-0 pointer-events-none z-0"
          style={{
            background: `radial-gradient(ellipse 60% 40% at 50% 100%, ${accent}10, transparent)`,
          }}
        />
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none max-w-[min(90%,28rem)]">
          <AnimatePresence mode="wait">
            <motion.div
              key={caption}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
              className={cn(
                "px-4 py-2 rounded-full text-center text-xs font-medium backdrop-blur-md border",
                isWhiteLab
                  ? "text-neutral-900 border-slate-200 bg-white/90 shadow-md shadow-slate-200/50"
                  : "text-white/90 border-white/10",
              )}
              style={
                isWhiteLab
                  ? { boxShadow: `0 4px 14px ${accent}22` }
                  : {
                      background: "rgba(0,0,0,0.55)",
                      boxShadow: `0 0 24px ${accent}18`,
                    }
              }
            >
              <span style={{ color: accent }} className="uppercase tracking-widest text-[10px] mr-2">
                {animPhase === "idle" ? t.label_status : t.label_phase}
              </span>
              {caption}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    );
  }

  return (
    <div className={`relative w-full h-full overflow-hidden ${className}`}>
      <motion.div
        className="absolute inset-0"
        animate={{
          scale: pulse ? [1, 1.05, 1.02, 1] : 1,
          opacity: 1,
        }}
        transition={{ duration: pulse ? 1.4 : 0.35, ease: [0.16, 1, 0.3, 1] }}
      >
        <AnimatePresence mode="wait">
          <motion.div
            key={`${reaction.id}-${stepIndex}`}
            className="absolute inset-0"
            initial={{ opacity: 0.35, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0.2, scale: 1.02 }}
            transition={{ duration: 0.35 }}
          >
            <MoleculeScene
              molecule={currentMolecule}
              autoRotate
              showLabels={false}
              enableZoom
              className="w-full h-full"
              toggleClassName="absolute top-5 right-32 z-20 pointer-events-auto"
            />
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <div
        className="absolute inset-0 pointer-events-none z-0"
        style={{
          background: `radial-gradient(ellipse 60% 40% at 50% 100%, ${accent}10, transparent)`,
        }}
      />

      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none max-w-[min(90%,28rem)]">
        <AnimatePresence mode="wait">
          <motion.div
            key={step?.caption ?? "step"}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.3 }}
            className={cn(
              "px-4 py-2 rounded-full text-center text-xs font-medium backdrop-blur-md border",
              isWhiteLab
                ? "text-neutral-900 border-slate-200 bg-white/90 shadow-md shadow-slate-200/50"
                : "text-white/90 border-white/10",
            )}
            style={
              isWhiteLab
                ? { boxShadow: `0 4px 14px ${accent}22` }
                : {
                    background: "rgba(0,0,0,0.55)",
                    boxShadow: `0 0 24px ${accent}18`,
                  }
            }
          >
            <span style={{ color: accent }} className="uppercase tracking-widest text-[10px] mr-2">
              {t.label_step}
            </span>
            {caption}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
