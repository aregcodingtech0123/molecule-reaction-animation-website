"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { MoleculeData, MoleculeEducation } from "@/lib/molecules/types";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { formatMessage, translateState } from "@/lib/i18n/localize";
import { cn } from "@/lib/utils";
import {
  X, Lightbulb, Beaker, Zap, Globe, ChevronRight,
  Atom, Layers, Thermometer, Weight, type LucideIcon
} from "lucide-react";

interface MoleculeInfoPanelProps {
  molecule: MoleculeData;
  onClose: () => void;
}

type TabId = "overview" | "bonds" | "uses" | "facts";

export function MoleculeInfoPanel({ molecule, onClose }: MoleculeInfoPanelProps) {
  const { t } = useLanguage();
  const { ui } = useTheme();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const edu = molecule.education;
  const accentColor = edu?.color ?? "#818cf8";

  const tabs = useMemo(
    (): { id: TabId; label: string; icon: LucideIcon }[] => [
      { id: "overview", label: t.panel_tab_overview, icon: Atom },
      { id: "bonds", label: t.panel_tab_structure, icon: Layers },
      { id: "uses", label: t.panel_tab_uses, icon: Globe },
      { id: "facts", label: t.panel_tab_fun_facts, icon: Lightbulb },
    ],
    [t],
  );

  return (
    <motion.div
      key={molecule.id + "-panel"}
      initial={{ opacity: 0, x: 60, scale: 0.97 }}
      animate={{ opacity: 1, x: 0, scale: 1 }}
      exit={{ opacity: 0, x: 60, scale: 0.97 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className="absolute top-4 right-4 bottom-4 z-20 w-80 flex flex-col pointer-events-auto"
      style={{ maxHeight: "calc(100% - 2rem)" }}
    >
      {/* Panel shell */}
      <div
        className="flex flex-col h-full rounded-2xl overflow-hidden"
        style={{
          background: "rgba(0,0,0,0.75)",
          backdropFilter: "blur(24px)",
          border: `1px solid ${accentColor}30`,
          boxShadow: `0 0 40px ${accentColor}15, 0 20px 60px rgba(0,0,0,0.5)`,
        }}
      >
        {/* Header */}
        <div className="px-5 pt-5 pb-4 flex-shrink-0">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h2 className={cn("text-xl font-bold leading-tight", ui.typography.title)}>
                {molecule.name}
              </h2>
              <p
                className="text-sm font-mono mt-0.5"
                style={{ color: accentColor }}
              >
                {molecule.formula}
              </p>
            </div>
            <button
              onClick={onClose}
              className={cn("transition-colors p-1 -mr-1 mt-0.5 rounded-lg hover:bg-black/5", ui.controls.iconButton)}
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Accent bar */}
          <div
            className="h-px w-full rounded-full opacity-40"
            style={{ background: `linear-gradient(90deg, ${accentColor}, transparent)` }}
          />

          {/* Stats row */}
          {edu && (
            <div className="grid grid-cols-3 gap-2 mt-4">
              <StatChip
                icon={Weight}
                label={t.panel_stat_weight}
                value={edu.molecularWeight.split(" ")[0]}
                unit={edu.molecularWeight.split(" ").slice(1).join(" ")}
                color={accentColor}
              />
              <StatChip
                icon={Atom}
                label={t.panel_stat_atoms}
                value={String(molecule.atoms.length)}
                unit={t.panel_stat_total}
                color={accentColor}
              />
              <StatChip
                icon={Zap}
                label={t.panel_stat_bonds}
                value={String(molecule.bonds.length)}
                unit={t.panel_stat_total}
                color={accentColor}
              />
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 px-4 pb-3 flex-shrink-0">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-xl text-xs font-medium transition-all duration-200 ${
                activeTab === tab.id
                  ? ui.typography.title
                  : cn(ui.typography.muted, "hover:text-neutral-800")
              }`}
              style={
                activeTab === tab.id
                  ? {
                      background: `${accentColor}20`,
                      borderBottom: `2px solid ${accentColor}`,
                    }
                  : {}
              }
            >
              <Icon className="w-3.5 h-3.5" />
              {tab.label}
            </button>
          )})}
        </div>

        {/* Tab content — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 pb-5 scrollbar-thin">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
            >
              {activeTab === "overview" && edu && (
                <OverviewTab molecule={molecule} edu={edu} accent={accentColor} t={t} />
              )}
              {activeTab === "bonds" && edu && (
                <BondsTab molecule={molecule} edu={edu} accent={accentColor} t={t} />
              )}
              {activeTab === "uses" && edu && (
                <UsesTab edu={edu} accent={accentColor} />
              )}
              {activeTab === "facts" && edu && (
                <FactsTab edu={edu} accent={accentColor} />
              )}
              {!edu && (
                <p className={cn("text-sm text-center py-8", ui.typography.muted)}>
                  {t.panel_no_education}
                </p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </motion.div>
  );
}

// ─── Tab Components ───────────────────────────────────────────

function OverviewTab({
  molecule,
  edu,
  accent,
  t,
}: {
  molecule: MoleculeData;
  edu: MoleculeEducation;
  accent: string;
  t: Record<string, string>;
}) {
  const { ui } = useTheme();

  return (
    <div className="space-y-4">
      <p className={cn("text-sm leading-relaxed", ui.typography.body)}>{molecule.description}</p>

      <div
        className="rounded-xl p-3 flex items-center gap-3"
        style={{ background: `${accent}10`, border: `1px solid ${accent}20` }}
      >
        <Thermometer className="w-4 h-4 flex-shrink-0" style={{ color: accent }} />
        <div>
          <p className={cn("text-xs", ui.panel.cardLabel)}>{t.panel_state_room_temp}</p>
          <p className={cn("text-sm font-medium capitalize", ui.panel.cardValue)}>
            {translateState(edu.state, t)}
          </p>
        </div>
      </div>

      {(edu.boilingPoint || edu.meltingPoint) && (
        <div className="grid grid-cols-2 gap-3">
          {edu.meltingPoint && (
            <TempCard label={t.label_melting_point} value={edu.meltingPoint} accent={accent} />
          )}
          {edu.boilingPoint && (
            <TempCard label={t.label_boiling_point} value={edu.boilingPoint} accent={accent} />
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        <span
          className="px-3 py-1 rounded-full text-xs font-medium capitalize"
          style={{ background: `${accent}20`, color: accent }}
        >
          {molecule.category}
        </span>
        <span className={cn("text-xs", ui.typography.muted)}>
          {formatMessage(t.card_atoms_bonds, {
            atoms: molecule.atoms.length,
            bonds: molecule.bonds.length,
          })}
        </span>
      </div>
    </div>
  );
}

function BondsTab({
  molecule,
  edu,
  accent,
  t,
}: {
  molecule: MoleculeData;
  edu: MoleculeEducation;
  accent: string;
  t: Record<string, string>;
}) {
  const { ui } = useTheme();
  const singleBonds = molecule.bonds.filter((b) => b.order === 1).length;
  const doubleBonds = molecule.bonds.filter((b) => b.order === 2).length;
  const tripleBonds = molecule.bonds.filter((b) => b.order === 3).length;

  return (
    <div className="space-y-4">
      {/* Bond type tags */}
      <div className="flex flex-wrap gap-2">
        {edu.bondTypes.map((bt) => (
          <span
            key={bt}
            className="px-2.5 py-1 rounded-lg text-xs font-medium"
            style={{ background: `${accent}15`, color: accent, border: `1px solid ${accent}25` }}
          >
            {bt}
          </span>
        ))}
      </div>

      {/* Bond counts */}
      <div className="space-y-2">
        {singleBonds > 0 && (
          <BondBar label={t.panel_single_bonds} count={singleBonds} total={molecule.bonds.length} accent="#94a3b8" />
        )}
        {doubleBonds > 0 && (
          <BondBar label={t.panel_double_bonds} count={doubleBonds} total={molecule.bonds.length} accent={accent} />
        )}
        {tripleBonds > 0 && (
          <BondBar label={t.panel_triple_bonds} count={tripleBonds} total={molecule.bonds.length} accent="#f97316" />
        )}
      </div>

      <div>
        <p className={cn("text-xs mb-2 uppercase tracking-wider", ui.panel.cardLabel)}>
          {t.panel_element_composition}
        </p>
        <ElementBreakdown atoms={molecule.atoms} accent={accent} />
      </div>
    </div>
  );
}

function UsesTab({ edu, accent }: { edu: MoleculeEducation; accent: string }) {
  const { ui } = useTheme();

  return (
    <div className="space-y-3">
      {edu.uses.map((use, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.07 }}
          className="flex items-start gap-3 p-3 rounded-xl"
          style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}
        >
          <div
            className="w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5"
            style={{ background: `${accent}20` }}
          >
            <ChevronRight className="w-3 h-3" style={{ color: accent }} />
          </div>
          <p className={cn("text-sm leading-relaxed", ui.typography.body)}>{use}</p>
        </motion.div>
      ))}
    </div>
  );
}

function FactsTab({ edu, accent }: { edu: MoleculeEducation; accent: string }) {
  const { ui } = useTheme();

  return (
    <div className="space-y-4">
      {edu.funFacts.map((fact, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.1 }}
          className="relative p-4 rounded-xl overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${accent}12, transparent)`,
            border: `1px solid ${accent}20`,
          }}
        >
          <div
            className="absolute top-3 right-3 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold opacity-30"
            style={{ background: accent, color: "#000" }}
          >
            {i + 1}
          </div>
          <Lightbulb className="w-4 h-4 mb-2 opacity-60" style={{ color: accent }} />
          <p className={cn("text-sm leading-relaxed pr-6", ui.typography.body)}>{fact}</p>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Micro-components ─────────────────────────────────────────

function StatChip({
  icon: Icon,
  label,
  value,
  unit,
  color,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  unit: string;
  color: string;
}) {
  const { ui } = useTheme();

  return (
    <div
      className="rounded-xl p-2.5 flex flex-col items-center text-center"
      style={{ background: `${color}10`, border: `1px solid ${color}15` }}
    >
      <Icon className="w-3.5 h-3.5 mb-1" style={{ color }} />
      <p className={cn("text-sm font-bold leading-none", ui.typography.title)}>{value}</p>
      <p className={cn("text-[10px] mt-0.5 leading-tight", ui.typography.muted)}>{unit}</p>
      <p className={cn("text-[9px] mt-0.5 uppercase tracking-wide", ui.panel.cardLabel)}>{label}</p>
    </div>
  );
}

function TempCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent: string;
}) {
  const { ui } = useTheme();

  return (
    <div
      className="rounded-xl p-3"
      style={{ background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <p className={cn("text-[10px] uppercase tracking-wide mb-1", ui.panel.cardLabel)}>{label}</p>
      <p className={cn("text-xs font-medium leading-snug", ui.panel.cardValue)}>{value}</p>
    </div>
  );
}

function BondBar({
  label,
  count,
  total,
  accent,
}: {
  label: string;
  count: number;
  total: number;
  accent: string;
}) {
  const { ui } = useTheme();
  const pct = Math.round((count / total) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className={ui.typography.muted}>{label}</span>
        <span style={{ color: accent }}>{count}</span>
      </div>
      <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="h-full rounded-full"
          style={{ background: accent }}
        />
      </div>
    </div>
  );
}

function ElementBreakdown({
  atoms,
  accent,
}: {
  atoms: { element: string }[];
  accent: string;
}) {
  const { ui } = useTheme();
  const counts: Record<string, number> = {};
  atoms.forEach((a) => {
    counts[a.element] = (counts[a.element] ?? 0) + 1;
  });

  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(counts).map(([el, n]) => (
        <div
          key={el}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg"
          style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <span className={cn("font-bold text-xs", ui.typography.title)}>{el}</span>
          <span className={cn("text-xs", ui.typography.muted)}>×{n}</span>
        </div>
      ))}
    </div>
  );
}
