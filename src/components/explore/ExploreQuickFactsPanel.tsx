"use client";

import { motion, AnimatePresence } from "framer-motion";
import type { MoleculeData } from "@/lib/molecules/types";
import type { ReactionData } from "@/lib/reactions/types";
import type { StudioActiveMode } from "@/context/StudioModeContext";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { useFocus } from "@/context/FocusContext";
import { cn } from "@/lib/utils";
import type { AtomData } from "@/lib/molecules/types";
import { getAtomFocusFacts } from "@/lib/molecules/atom-focus";
import { ELEMENT_PROPERTIES } from "@/lib/molecules/elements";
import type { ElementSymbol } from "@/lib/molecules/types";
import {
  formatMessage,
  translateDifficulty,
  translateState,
} from "@/lib/i18n/localize";

interface ExploreQuickFactsPanelProps {
  activeMode: StudioActiveMode;
  activeMolecule: MoleculeData;
  activeReaction: ReactionData;
  className?: string;
}

export function ExploreQuickFactsPanel({
  activeMode,
  activeMolecule,
  activeReaction,
  className,
}: ExploreQuickFactsPanelProps) {
  const { t } = useLanguage();
  const { ui } = useTheme();
  const { focusedAtom, focusedMoleculeId, clearFocus } = useFocus();

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <AnimatePresence mode="wait">
        {activeMode === "explorer" ? (
          <motion.div
            key="facts-explorer"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col gap-3"
          >
            <p className={cn("text-xs uppercase tracking-widest mb-1 px-1", ui.sidebar.sectionLabel)}>
              {focusedAtom && focusedMoleculeId === activeMolecule.id
                ? t.label_atom_focus
                : t.label_quick_facts}
            </p>
            {focusedAtom && focusedMoleculeId === activeMolecule.id ? (
              <AtomFocusQuickFacts atom={focusedAtom} molecule={activeMolecule} onClear={clearFocus} />
            ) : (
              <MoleculeQuickFactCards molecule={activeMolecule} />
            )}
          </motion.div>
        ) : (
          <motion.div
            key="facts-reaction"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col gap-3"
          >
            <p className={cn("text-xs uppercase tracking-widest mb-1 px-1", ui.sidebar.sectionLabel)}>
              {t.label_quick_facts}
            </p>
            <ReactionQuickFactCards reaction={activeReaction} />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function AtomFocusQuickFacts({
  atom,
  molecule,
  onClear,
}: {
  atom: AtomData;
  molecule: MoleculeData;
  onClear: () => void;
}) {
  const { t } = useLanguage();
  const { ui, isWhiteLab } = useTheme();
  const facts = getAtomFocusFacts(atom, molecule, t);
  const props = ELEMENT_PROPERTIES[atom.element as ElementSymbol] ?? ELEMENT_PROPERTIES.C;
  const accent = molecule.education?.color ?? props.color;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={atom.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col gap-3"
      >
        <div
          className={cn("p-3.5 rounded-2xl panel-card flex items-center gap-3", ui.panel.cardHighlight)}
          style={{ borderColor: `${accent}50` }}
        >
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm flex-shrink-0"
            style={{
              background: `${props.color}22`,
              border: `1px solid ${props.color}55`,
              color: props.color,
              boxShadow: isWhiteLab ? undefined : `0 0 14px ${props.emissive}35`,
            }}
          >
            {atom.element}
          </div>
          <div className="min-w-0">
            <p className={cn("text-sm font-bold truncate", ui.typography.title)}>{facts.elementLabel}</p>
            <p className={cn("text-[10px] font-mono", ui.typography.monoMuted)}>{atom.id}</p>
          </div>
        </div>

        <MiniCard label={t.focus_element} value={facts.elementLabel} accent={accent} />
        <MiniCard label={t.focus_hybridization} value={facts.hybridization} accent={accent} />
        <MiniCard label={t.focus_bonds} value={String(facts.bondCount)} accent={accent} />
        <MiniCard label={t.focus_atomic_number} value={String(facts.atomicNumber)} accent={accent} />
        <MiniCard label={t.focus_radius} value={`${facts.radiusAngstrom} Å`} accent={accent} />

        <p className={cn("text-[10px] leading-snug px-1", ui.typography.muted)}>{t.focus_unfocus_hint}</p>

        <button
          type="button"
          onClick={onClear}
          className={cn(
            "text-xs font-semibold rounded-xl border px-3 py-2 transition-colors active:opacity-90",
            ui.controls.play,
          )}
        >
          {t.focus_clear}
        </button>
      </motion.div>
    </AnimatePresence>
  );
}

function MoleculeQuickFactCards({ molecule }: { molecule: MoleculeData }) {
  const { t } = useLanguage();
  const { ui } = useTheme();
  const edu = molecule.education;
  const accent = edu?.color ?? "#818cf8";
  const factLine = edu?.funFacts?.[0];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={molecule.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col gap-3"
      >
        {molecule.disciplineTag && (
          <div
            className={cn("p-3 rounded-xl panel-card", ui.panel.cardHighlight)}
            style={{ borderColor: `${accent}40` }}
          >
            <p className={cn("text-[10px] uppercase tracking-wide mb-1", ui.panel.cardLabel)}>
              {t.label_discipline}
            </p>
            <p className={cn("text-xs font-semibold", ui.panel.cardValue)}>{molecule.disciplineTag}</p>
          </div>
        )}
        {edu && (
          <>
            <MiniCard label={t.label_molecular_weight} value={edu.molecularWeight} accent={accent} />
            <MiniCard label={t.label_state} value={translateState(edu.state, t)} accent={accent} />
            {edu.boilingPoint && (
              <MiniCard label={t.label_boiling_point} value={edu.boilingPoint} accent={accent} />
            )}
            {edu.bondTypes[0] && (
              <MiniCard label={t.label_bond_types} value={edu.bondTypes[0]} accent={accent} />
            )}
          </>
        )}
        {factLine && (
          <div className={cn("p-3.5 rounded-2xl mt-1 panel-card", ui.panel.cardHighlight)}>
            <p className={cn("text-xs leading-relaxed italic", ui.panel.cardQuote)}>
              &ldquo;{factLine.split(".")[0]}.&rdquo;
            </p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function formatSpeciesList(species: ReactionData["reactants"]): string {
  return species
    .map((s) => `${s.count > 1 ? `${s.count} ` : ""}${s.formula ?? s.name}`)
    .join(" + ");
}

function ReactionQuickFactCards({ reaction }: { reaction: ReactionData }) {
  const { t } = useLanguage();
  const { ui } = useTheme();
  const accent = reaction.accentColor;
  const f = reaction.quickFacts;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={reaction.id}
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -10 }}
        transition={{ duration: 0.3 }}
        className="flex flex-col gap-3"
      >
        <div className="flex flex-wrap gap-1.5">
          <span
            className="text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md"
            style={{ color: accent, background: `${accent}15`, border: `1px solid ${accent}28` }}
          >
            {reaction.category}
          </span>
          <span
            className={cn(
              "text-[9px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-md",
              ui.panel.chipMuted,
            )}
          >
            {translateDifficulty(reaction.difficulty, t)}
          </span>
        </div>
        <MiniCard label={t.label_equation} value={reaction.formula} accent={accent} />
        <MiniCard label={t.label_reactants} value={formatSpeciesList(reaction.reactants)} accent={accent} />
        <MiniCard label={t.label_products} value={formatSpeciesList(reaction.products)} accent={accent} />
        <div className={cn("p-3 rounded-xl panel-card", ui.panel.cardHighlight)}>
          <p className={cn("text-[10px] uppercase tracking-wide mb-1", ui.panel.cardLabel)}>{t.fact_overview}</p>
          <p className={cn("text-xs font-medium leading-snug", ui.panel.cardBody)}>{f.summary}</p>
        </div>
        {f.energyProfile && <MiniCard label={t.fact_energy} value={f.energyProfile} accent={accent} />}
        {f.conditions && <MiniCard label={t.fact_conditions} value={f.conditions} accent={accent} />}
        {f.mechanism && <MiniCard label={t.fact_mechanism} value={f.mechanism} accent={accent} />}
        {reaction.animationMetadata?.status === "placeholder" && (
          <p className={cn("text-[10px] leading-snug px-1", ui.typography.muted)}>
            {formatMessage(t.reaction_animation_placeholder, {
              key: reaction.animationMetadata.animationKey ?? reaction.id,
            })}
          </p>
        )}
        {reaction.animationMetadata?.status === "ready" && (
          <p className="text-[10px] text-emerald-500/80 leading-snug px-1">{t.reaction_animation_ready}</p>
        )}
        {f.highlight && (
          <div className={cn("p-3.5 rounded-2xl mt-1 panel-card", ui.panel.cardHighlight)}>
            <p className={cn("text-xs leading-relaxed italic", ui.panel.cardQuote)}>&ldquo;{f.highlight}&rdquo;</p>
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

function MiniCard({
  label,
  value,
  accent,
  capitalize = false,
}: {
  label: string;
  value: string;
  accent: string;
  capitalize?: boolean;
}) {
  const { ui } = useTheme();

  return (
    <div className={cn("p-3 rounded-xl panel-card", ui.panel.card)}>
      <p className={cn("text-[10px] uppercase tracking-wide mb-1", ui.panel.cardLabel)}>{label}</p>
      <p className={cn("text-xs font-semibold leading-snug", ui.panel.cardValue, capitalize && "capitalize")}>
        {value}
      </p>
      <div className="h-px mt-2 rounded-full opacity-40" style={{ background: accent }} />
    </div>
  );
}
