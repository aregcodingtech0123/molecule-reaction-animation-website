"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Sparkles } from "lucide-react";
import { useAiChat } from "@/hooks/useAiChat";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
import { AiLabCanvas } from "@/components/ai/AiLabCanvas";
import { StudioContextPills } from "@/components/layout/StudioContextPills";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import type { MoleculeData } from "@/lib/molecules/types";
import { cn } from "@/lib/utils";

export default function AiLabPage() {
  const { t } = useLanguage();
  const { ui, isWhiteLab } = useTheme();
  const [previewMolecule, setPreviewMolecule] = useState<MoleculeData | null>(null);

  const chat = useAiChat({
    onMoleculeGenerated: setPreviewMolecule,
  });

  return (
    <main className="min-h-screen flex flex-col">
      <div className="flex-shrink-0 pt-24 pb-4 px-6 max-w-[1600px] mx-auto w-full">
        {/* CSS entrance (PERF-23): the header text is the LCP element and must not wait for hydration. It slides
            without a fade: an element first painted at opacity 0 is not an LCP candidate at all. */}
        <div className="flex flex-wrap items-end justify-between gap-4 animate-in ease-out fill-mode-both motion-reduce:animate-none slide-in-from-top-3 duration-300">
          <div>
            <div className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs mb-3", ui.panel.badge)}>
              <Sparkles className={cn("w-3.5 h-3.5", ui.typography.iconAccent)} />
              {t.ai_lab_badge ?? "MoleculeStudio AI Lab"}
            </div>
            <h1 className={cn("home-section-title text-3xl md:text-4xl", ui.typography.title)}>
              {t.ai_lab_title ?? "Your Personal AI Lab"}
            </h1>
            <p className={cn("mt-2 max-w-xl text-sm md:text-base", ui.typography.subtitle)}>
              {t.ai_lab_subtitle ??
                "Deep scientific conversations with instant 3D molecular visualization — powered by the same engine as the floating assistant."}
            </p>
          </div>
          <StudioContextPills className="justify-end" />
        </div>
      </div>

      <div className="flex-1 min-h-0 px-4 md:px-6 pb-6 max-w-[1600px] mx-auto w-full">
        <motion.div
          initial={{ opacity: 0, scale: 0.98 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className={cn(
            "h-[calc(100vh-12rem)] min-h-[480px] grid lg:grid-cols-[minmax(0,26rem)_1fr] gap-0 rounded-3xl border overflow-hidden",
            ui.borders.subtle,
            isWhiteLab ? "bg-white shadow-lg shadow-slate-200/50" : "bg-neutral-950/80 shadow-2xl",
          )}
        >
          <div
            className={cn(
              "flex flex-col min-h-0 border-b lg:border-b-0 lg:border-r",
              ui.borders.divider,
              isWhiteLab ? "bg-white/90" : "bg-neutral-950/90",
            )}
          >
            <AiChatPanel
              chat={chat}
              variant="full"
              className="flex-1 min-h-0 h-full"
              header={
                <div className={cn("px-4 py-4 border-b flex-shrink-0", ui.borders.divider)}>
                  <h2 className={cn("text-sm font-semibold", ui.typography.title)}>
                    {t.ai_chat_label ?? "Lab Assistant"}
                  </h2>
                  <p className={cn("text-[10px] mt-0.5", ui.typography.muted)}>
                    {t.ai_lab_chat_hint ?? "Chemistry · Biology · Materials · SMILES → 3D"}
                  </p>
                </div>
              }
            />
          </div>

          <AiLabCanvas
            molecule={previewMolecule}
            loading={chat.loading}
            className="min-h-[280px] lg:min-h-0 h-full rounded-none border-0"
          />
        </motion.div>
      </div>
    </main>
  );
}
