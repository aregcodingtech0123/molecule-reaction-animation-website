"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { useDynamicMolecule } from "@/context/DynamicMoleculeContext";
import { formatMessage, getElementName, localizeMolecule } from "@/lib/i18n/localize";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import type { AtomData, ElementSymbol, MoleculeData } from "@/lib/molecules/types";
import { ELEMENT_PROPERTIES } from "@/lib/molecules/elements";
import { ALL_MOLECULES } from "@/lib/molecules/data";
import { MoleculeScene } from "@/components/canvas/Scene";
import { MoleculeInfoPanel } from "@/components/canvas/MoleculeInfoPanel";
import { CanvasToolbar } from "@/components/canvas/CanvasToolbar";
import { MeasurementModeToggle } from "@/components/canvas/MeasurementModeToggle";
import { useMeasurement } from "@/context/MeasurementContext";
import { useFocus } from "@/context/FocusContext";
import {
  RotateCcw, Tag, ChevronLeft, ChevronRight,
  X, BookOpen,
} from "lucide-react";

interface MoleculeViewerProps {
  /** Controlled molecule id — keeps sidebar + viewport in sync. */
  moleculeId: string;
  /** Catalog order (should match the explore sidebar list). Defaults to ALL_MOLECULES. */
  molecules?: MoleculeData[];
  /** Fired when prev/next/dots change the active molecule. */
  onMoleculeChange?: (id: string) => void;
}

export function MoleculeViewer({
  moleculeId,
  molecules: moleculesProp,
  onMoleculeChange,
}: MoleculeViewerProps) {
  const { locale, t } = useLanguage();
  const { ui, isWhiteLab } = useTheme();
  const catalog = moleculesProp?.length ? moleculesProp : ALL_MOLECULES;
  const currentIndex = Math.max(
    0,
    catalog.findIndex((m) => m.id === moleculeId),
  );
  const [showLabels, setShowLabels] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);
  const [selectedAtom, setSelectedAtom] = useState<AtomData | null>(null);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const { dynamicMolecule, setDynamicMolecule } = useDynamicMolecule();
  const { measurementMode, selectedAtomIds } = useMeasurement();
  const { isFocused, clearFocus } = useFocus();
  const transitionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
    };
  }, []);

  useEffect(() => {
    setSelectedAtom(null);
    setIsTransitioning(false);
  }, [moleculeId]);

  const rawMolecule = dynamicMolecule ?? catalog[currentIndex] ?? catalog[0] ?? ALL_MOLECULES[0];
  const molecule = useMemo(
    () => localizeMolecule(rawMolecule, locale),
    [rawMolecule, locale],
  );
  const localizedAll = useMemo(
    () => catalog.map((m) => localizeMolecule(m, locale)),
    [catalog, locale],
  );
  const accentColor = molecule.education?.color ?? "#818cf8";

  const switchMolecule = useCallback(
    (newIndex: number) => {
      if (isTransitioning) return;
      const next = catalog[newIndex];
      if (!next || next.id === moleculeId) return;

      setIsTransitioning(true);
      setSelectedAtom(null);
      clearFocus();
      setDynamicMolecule(null);

      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
      transitionTimerRef.current = setTimeout(() => {
        onMoleculeChange?.(next.id);
        setIsTransitioning(false);
      }, 200);
    },
    [
      isTransitioning,
      catalog,
      moleculeId,
      setDynamicMolecule,
      clearFocus,
      onMoleculeChange,
    ],
  );

  const nextMolecule = useCallback(() => {
    switchMolecule((currentIndex + 1) % catalog.length);
  }, [currentIndex, catalog.length, switchMolecule]);

  const prevMolecule = useCallback(() => {
    switchMolecule((currentIndex - 1 + catalog.length) % catalog.length);
  }, [currentIndex, catalog.length, switchMolecule]);

  const handleAtomSelect = useCallback((atom: AtomData | null) => {
    if (measurementMode) return;
    setSelectedAtom(atom);
  }, [measurementMode]);

  const toastAtom = measurementMode ? null : selectedAtom;

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* ── 3D Canvas ── */}
      <motion.div
        className="absolute inset-0"
        animate={{ opacity: isTransitioning ? 0.3 : 1, scale: isTransitioning ? 0.97 : 1 }}
        transition={{ duration: 0.2 }}
      >
        <MoleculeScene
          molecule={molecule}
          autoRotate={autoRotate}
          showLabels={showLabels}
          enableZoom
          onAtomSelect={handleAtomSelect}
          className="w-full h-full"
          showRenderModeToggle={false}
        />
      </motion.div>

      {/* ── Dynamic accent glow overlay ── */}
      <div
        className="absolute inset-0 pointer-events-none z-0"
        style={{
          background: `radial-gradient(ellipse 60% 40% at 50% 100%, ${accentColor}08, transparent)`,
          transition: "background 1s ease",
        }}
      />

      {/* ── Top bar: molecule identity only (viewport tools → CanvasToolbar) ── */}
      <div className="pointer-events-none absolute top-5 left-5 right-5 z-10 flex items-start justify-between">
        <AnimatePresence mode="wait">
          <motion.div
            key={molecule.id + "-header"}
            initial={{ opacity: 0, x: -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 24 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="pointer-events-auto"
          >
            <div
              className={cn("px-5 py-3.5 rounded-2xl border", ui.panel.overlay, ui.panel.overlayBorder)}
              style={{
                borderColor: isWhiteLab ? accentColor : `${accentColor}30`,
                boxShadow: isWhiteLab ? `0 4px 14px ${accentColor}15` : `0 0 20px ${accentColor}10`,
              }}
            >
              <div className="flex items-center gap-2.5 mb-0.5">
                <div
                  className="w-2.5 h-2.5 rounded-full animate-pulse"
                  style={{ background: accentColor, boxShadow: `0 0 6px ${accentColor}` }}
                />
                <span
                  className="text-xs font-medium uppercase tracking-widest opacity-60"
                  style={{ color: accentColor }}
                >
                  {molecule.category}
                </span>
              </div>
              <h2 className={cn("text-xl font-bold", ui.typography.title)}>{molecule.name}</h2>
              <p className={cn("text-sm font-mono mt-0.5", ui.typography.mono)}>{molecule.formula}</p>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <CanvasToolbar
        accentColor={accentColor}
        showRenderModes
        showStudioModes={false}
        position="bottom-center"
        className="bottom-20 sm:bottom-24"
        trailing={
          <>
            <MeasurementModeToggle accentColor={accentColor} compact />
            <ToolbarButton
              active={showLabels}
              onClick={() => setShowLabels((v) => !v)}
              icon={<Tag className="w-4 h-4" />}
              tooltip={t.viewer_show_labels}
              accentColor={accentColor}
            />
            <ToolbarButton
              active={autoRotate}
              onClick={() => setAutoRotate((v) => !v)}
              icon={<RotateCcw className="w-4 h-4" />}
              tooltip={t.viewer_auto_rotate}
              accentColor={accentColor}
            />
            <ToolbarButton
              active={showInfoPanel}
              onClick={() => setShowInfoPanel((v) => !v)}
              icon={<BookOpen className="w-4 h-4" />}
              tooltip={t.viewer_learn_panel}
              accentColor={accentColor}
            />
          </>
        }
      />

      {/* ── Bottom bar: navigation + info chip ── */}
      <div className="pointer-events-none absolute bottom-5 left-5 right-5 z-10 flex items-end gap-4">
        {/* Prev / Next */}
        <div className="flex gap-2 pointer-events-auto">
          <NavButton onClick={prevMolecule} disabled={isTransitioning} label={t.viewer_prev}>
            <ChevronLeft className="w-5 h-5" />
          </NavButton>
          <NavButton onClick={nextMolecule} disabled={isTransitioning} label={t.viewer_next}>
            <ChevronRight className="w-5 h-5" />
          </NavButton>
        </div>

        {/* Molecule selector dots */}
        {!dynamicMolecule ? (
          <div className="flex gap-2.5 items-center pointer-events-auto flex-1 justify-center">
            {localizedAll.map((m, i) => {
              const dotColor = m.education?.color ?? "#818cf8";
              const isActive = m.id === moleculeId;
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => switchMolecule(i)}
                  title={m.name}
                  aria-label={m.name}
                  aria-current={isActive ? "true" : undefined}
                  className="transition-all duration-300 rounded-full focus:outline-none"
                  style={{
                    width: isActive ? "28px" : "8px",
                    height: "8px",
                    background: isActive
                      ? dotColor
                      : isWhiteLab
                        ? "rgba(15,23,42,0.2)"
                        : "rgba(255,255,255,0.2)",
                    boxShadow: isActive ? `0 0 10px ${dotColor}80` : "none",
                  }}
                />
              );
            })}
          </div>
        ) : (
          <div className="flex gap-2.5 items-center pointer-events-auto flex-1 justify-center">
            <button
              onClick={() => setDynamicMolecule(null)}
              className="px-4 py-1.5 rounded-full text-xs font-semibold text-white bg-indigo-600/80 hover:bg-indigo-500 transition-colors shadow-lg backdrop-blur-md flex items-center gap-2"
            >
              <X className="w-3.5 h-3.5" />
              Close Custom Molecule
            </button>
          </div>
        )}

        {/* Description chip */}
        <AnimatePresence mode="wait">
          <motion.div
            key={molecule.id + "-desc"}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.35, delay: 0.1 }}
            className="max-w-[260px] pointer-events-auto"
          >
            <div className={cn("px-4 py-3 rounded-2xl border", ui.panel.overlay, ui.borders.subtle)}>
              <p className={cn("text-xs leading-relaxed", ui.typography.subtitle)}>{molecule.description}</p>
              {molecule.education && (
                <p className="text-xs mt-1" style={{ color: `${accentColor}80` }}>
                  {molecule.education.molecularWeight}
                </p>
              )}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

        <AnimatePresence>
        {measurementMode && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            className="absolute top-24 left-1/2 -translate-x-1/2 z-10 pointer-events-none"
          >
            <div className={cn("px-4 py-2 rounded-full text-xs font-medium border", ui.panel.overlay, ui.borders.subtle)}>
              <span className={ui.typography.subtitle}>
                {selectedAtomIds.length === 1 ? t.measure_hint_one : t.measure_hint_select}
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Selected atom info toast ── */}
      <AnimatePresence>
        {toastAtom && !showInfoPanel && !isFocused && (
          <AtomToast atom={toastAtom} onClose={() => setSelectedAtom(null)} t={t} />
        )}
      </AnimatePresence>

      {/* ── Education info panel ── */}
      <AnimatePresence>
        {showInfoPanel && (
          <MoleculeInfoPanel
            molecule={molecule}
            onClose={() => setShowInfoPanel(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────

function ToolbarButton({
  active,
  onClick,
  icon,
  tooltip,
  accentColor,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  tooltip: string;
  accentColor: string;
}) {
  const { ui, isWhiteLab } = useTheme();

  return (
    <motion.button
      onClick={onClick}
      title={tooltip}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className={cn("p-2.5 rounded-xl transition-colors duration-200 border", ui.controls.toolbar)}
      style={{
        background: active ? `${accentColor}20` : isWhiteLab ? "rgba(255,255,255,0.85)" : "rgba(0,0,0,0.5)",
        borderColor: active ? `${accentColor}50` : undefined,
        color: active ? accentColor : isWhiteLab ? "#475569" : "#6b7280",
        boxShadow: active ? `0 0 12px ${accentColor}20` : isWhiteLab ? "0 1px 2px rgb(0 0 0 / 0.04)" : "none",
      }}
    >
      {icon}
    </motion.button>
  );
}

function NavButton({
  onClick,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  label: string;
  children: React.ReactNode;
}) {
  const { ui, isWhiteLab } = useTheme();

  return (
    <motion.button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.93 }}
      className={cn(
        "p-2.5 rounded-full disabled:opacity-40 transition-opacity border",
        ui.typography.title,
        ui.controls.toolbar,
      )}
      style={{
        background: isWhiteLab ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.5)",
      }}
    >
      {children}
    </motion.button>
  );
}

function AtomToast({
  atom,
  onClose,
  t,
}: {
  atom: AtomData;
  onClose: () => void;
  t: Record<string, string>;
}) {
  const props = ELEMENT_PROPERTIES[atom.element as ElementSymbol] ?? ELEMENT_PROPERTIES.C;
  const elementName = getElementName(atom.element, t);
  const { ui, isWhiteLab } = useTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="absolute bottom-24 left-1/2 -translate-x-1/2 z-20 pointer-events-auto"
    >
      <div
        className={cn(
          "flex items-center gap-4 px-5 py-3.5 rounded-2xl border shadow-lg",
          ui.panel.overlay,
        )}
        style={{
          borderColor: isWhiteLab ? "#cbd5e1" : `${props.emissive}40`,
          boxShadow: isWhiteLab ? "0 4px 12px rgb(15 23 42 / 0.1)" : `0 0 30px ${props.emissive}20`,
        }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center font-bold text-sm"
          style={{
            background: `${props.color}20`,
            border: `1px solid ${props.color}40`,
            color: props.color,
            boxShadow: `0 0 12px ${props.emissive}40`,
          }}
        >
          {atom.element}
        </div>
        <div>
          <p className={cn("font-semibold text-sm", ui.typography.title)}>{elementName}</p>
          <p className={cn("text-xs", ui.typography.muted)}>
            {formatMessage(t.atom_detail, {
              number: props.atomicNumber,
              radius: props.radius,
            })}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label={t.viewer_close_atom}
          className={cn("transition-colors ml-2", ui.controls.iconButton)}
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </motion.div>
  );
}
