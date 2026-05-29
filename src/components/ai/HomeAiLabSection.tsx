"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, Sparkles } from "lucide-react";
import { useAiChat } from "@/hooks/useAiChat";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
import { AiLabCanvas } from "@/components/ai/AiLabCanvas";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import type { MoleculeData } from "@/lib/molecules/types";
import { cn } from "@/lib/utils";

export function HomeAiLabSection() {
  const { t } = useLanguage();
  const { ui, isWhiteLab } = useTheme();
  const [previewMolecule, setPreviewMolecule] = useState<MoleculeData | null>(null);

  const chat = useAiChat({
    onMoleculeGenerated: setPreviewMolecule,
  });

  return (
    <section
      className={cn(
        "relative z-10 py-24 md:py-32 px-6 border-t",
        ui.borders.divider,
        isWhiteLab ? "bg-gradient-to-b from-slate-50 to-white" : "bg-gradient-to-b from-black/40 to-transparent",
      )}
    >
      <div className="max-w-7xl mx-auto">
        <div className="text-center mb-12 md:mb-16">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className={cn("inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs mb-4", ui.panel.badge)}
          >
            <Sparkles className={cn("w-3.5 h-3.5", ui.typography.iconAccent)} />
            {t.ai_home_badge ?? "Powered by Gemini"}
          </motion.div>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-3xl md:text-5xl font-bold mb-4"
          >
            {t.ai_home_title_prefix ?? "Generate with"}{" "}
            <span className="text-gradient">{t.ai_home_title_highlight ?? "AI"}</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className={cn("max-w-2xl mx-auto text-base md:text-lg", ui.typography.subtitle)}
          >
            {t.ai_home_subtitle ??
              "Describe any molecule in plain language. Watch it materialize in 3D — right here or in the full AI Lab."}
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.15 }}
          className={cn(
            "grid lg:grid-cols-2 gap-6 lg:gap-8 rounded-3xl border overflow-hidden",
            ui.panel.overlay,
            ui.borders.subtle,
            isWhiteLab ? "shadow-lg shadow-slate-200/40" : "shadow-2xl shadow-indigo-950/30",
          )}
        >
          <div className={cn("flex flex-col min-h-[360px] lg:min-h-[420px]", isWhiteLab ? "bg-white/80" : "bg-neutral-950/60")}>
            <AiChatPanel
              chat={chat}
              variant="embedded"
              className="flex-1 min-h-0"
              header={
                <div className={cn("px-4 py-3 border-b flex items-center justify-between gap-2", ui.borders.divider)}>
                  <span className={cn("text-xs font-semibold uppercase tracking-widest", ui.typography.muted)}>
                    {t.ai_chat_label ?? "AI Lab Chat"}
                  </span>
                  <Link
                    href="/ai-lab"
                    className={cn(
                      "text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1 hover:underline",
                      ui.typography.iconAccent,
                    )}
                  >
                    {t.ai_open_full_lab ?? "Full lab"} <ArrowRight className="w-3 h-3" />
                  </Link>
                </div>
              }
            />
          </div>

          <AiLabCanvas
            molecule={previewMolecule}
            loading={chat.loading}
            className="min-h-[360px] lg:min-h-[420px] lg:rounded-none lg:border-0 lg:border-l rounded-none border-t lg:border-t-0"
          />
        </motion.div>
      </div>
    </section>
  );
}
