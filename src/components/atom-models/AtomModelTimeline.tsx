"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Atom } from "lucide-react";
import { ATOM_MODEL_META, DEFAULT_ATOM_MODEL_ID } from "@/lib/atom-models/data";
import { ATOM_MODEL_IDS, type AtomModelId } from "@/lib/atom-models/types";
import { getAtomModelsBundle } from "@/lib/atom-models/content";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

interface AtomModelTimelineProps {
  activeId: AtomModelId;
  onSelect: (id: AtomModelId) => void;
  className?: string;
}

export function AtomModelTimeline({ activeId, onSelect, className }: AtomModelTimelineProps) {
  const { locale } = useLanguage();
  const { ui, isWhiteLab } = useTheme();
  const bundle = getAtomModelsBundle(locale);

  const sorted = [...ATOM_MODEL_IDS].sort(
    (a, b) => ATOM_MODEL_META[a].order - ATOM_MODEL_META[b].order,
  );

  return (
    <aside className={cn("flex flex-col gap-2", className)}>
      <p className={cn("text-xs uppercase tracking-widest mb-2 px-1", ui.sidebar.sectionLabel)}>
        {bundle.ui.atom_models_label_timeline}
      </p>
      {sorted.map((id, index) => {
        const meta = ATOM_MODEL_META[id];
        const content = bundle.models[id];
        const isActive = id === activeId;

        return (
          <motion.button
            key={id}
            type="button"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.05 + index * 0.04 }}
            onClick={() => onSelect(id)}
            className={cn(
              "text-left p-3.5 rounded-2xl w-full border transition-all duration-200",
              "cursor-pointer active:scale-[0.99]",
              isActive ? cn(ui.sidebar.itemActive, ui.sidebar.itemHover) : cn(ui.sidebar.itemIdle, ui.sidebar.itemHover),
            )}
            style={
              isActive
                ? isWhiteLab
                  ? {
                      borderColor: meta.accentColor,
                      boxShadow: `0 4px 12px ${meta.accentColor}22`,
                    }
                  : {
                      background: `${meta.accentColor}15`,
                      borderColor: `${meta.accentColor}50`,
                      boxShadow: `0 0 20px ${meta.accentColor}18`,
                    }
                : undefined
            }
          >
            <div className="flex items-center gap-2.5 mb-1">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ background: isWhiteLab ? `${meta.accentColor}18` : `${meta.accentColor}25` }}
              >
                <Atom className="w-3.5 h-3.5" style={{ color: meta.accentColor }} />
              </div>
              <span
                className={cn(
                  "text-sm font-semibold leading-snug",
                  isActive ? ui.sidebar.nameActive : ui.sidebar.nameIdle,
                )}
              >
                {content.name}
              </span>
            </div>
            <p className={cn("text-[10px] font-mono pl-[38px]", ui.typography.monoMuted)}>
              {content.year} · {content.scientist}
            </p>
          </motion.button>
        );
      })}
    </aside>
  );
}

interface AtomModelInfoPanelProps {
  modelId: AtomModelId;
  className?: string;
}

export function AtomModelInfoPanel({ modelId, className }: AtomModelInfoPanelProps) {
  const { locale } = useLanguage();
  const { ui } = useTheme();
  const bundle = getAtomModelsBundle(locale);
  const content = bundle.models[modelId];
  const meta = ATOM_MODEL_META[modelId];

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={modelId}
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -8 }}
        transition={{ duration: 0.3 }}
        className={cn("flex flex-col gap-4", className)}
      >
        <div className={cn("p-4 rounded-2xl panel-card border", ui.panel.cardHighlight)} style={{ borderColor: `${meta.accentColor}40` }}>
          <p className={cn("text-[10px] uppercase tracking-widest mb-1", ui.panel.cardLabel)}>
            {bundle.ui.atom_models_label_scientist}
          </p>
          <p className={cn("text-sm font-semibold", ui.panel.cardValue)}>{content.scientist}</p>
          <p className={cn("text-xs font-mono mt-1", ui.typography.monoMuted)}>{content.year}</p>
        </div>

        <InfoBlock label={bundle.ui.atom_models_label_history} body={content.history} accent={meta.accentColor} />
        <InfoBlock label={bundle.ui.atom_models_label_postulates} body={content.postulates} accent={meta.accentColor} />
        <InfoBlock label={bundle.ui.atom_models_label_limitations} body={content.limitations} accent={meta.accentColor} />
      </motion.div>
    </AnimatePresence>
  );
}

function InfoBlock({ label, body, accent }: { label: string; body: string; accent: string }) {
  const { ui } = useTheme();

  return (
    <div className={cn("p-4 rounded-2xl panel-card", ui.panel.card)}>
      <p className={cn("text-[10px] uppercase tracking-widest mb-2", ui.panel.cardLabel)}>{label}</p>
      <p className={cn("text-sm leading-relaxed", ui.panel.cardBody)}>{body}</p>
      <div className="h-px mt-3 rounded-full opacity-40" style={{ background: accent }} />
    </div>
  );
}
