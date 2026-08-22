"use client";

import { useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { useAiChat } from "@/hooks/useAiChat";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
import { AiLabCanvas } from "@/components/ai/AiLabCanvas";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import type { MoleculeData } from "@/lib/molecules/types";
import { cn } from "@/lib/utils";

export function HomeAiLabSection() {
  const { t } = useLanguage();
  const { ui } = useTheme();
  const [previewMolecule, setPreviewMolecule] = useState<MoleculeData | null>(null);

  const chat = useAiChat({
    onMoleculeGenerated: setPreviewMolecule,
  });

  return (
    <section className={cn("relative z-10 py-24 md:py-32 px-6 border-t", ui.borders.divider)}>
      <div className="max-w-7xl mx-auto">
        <div className="mb-12 md:mb-14 max-w-3xl">
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className={cn("home-kicker mb-4", ui.typography.muted)}
          >
            {t.ai_home_badge ?? "Powered by Gemini"}
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="home-section-title text-3xl md:text-5xl mb-4"
          >
            {t.ai_home_title_prefix ?? "Generate with"}{" "}
            <span className={ui.accent.section}>{t.ai_home_title_highlight ?? "AI"}</span>
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className={cn("text-base md:text-lg max-w-2xl", ui.typography.subtitle)}
          >
            {t.ai_home_subtitle ??
              "Describe any molecule in plain language. Watch it materialize in 3D — right here or in the full AI Lab."}
          </motion.p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.12 }}
          className={cn("grid lg:grid-cols-2", ui.marketing.aiShell, ui.borders.subtle)}
        >
          <div
            className={cn(
              "flex flex-col min-h-[360px] lg:min-h-[420px] border-b lg:border-b-0 lg:border-r",
              ui.borders.divider,
              ui.marketing.aiPanel,
            )}
          >
            <AiChatPanel
              chat={chat}
              variant="embedded"
              className="flex-1 min-h-0"
              header={
                <div
                  className={cn(
                    "px-4 py-3 border-b flex items-center justify-between gap-2",
                    ui.borders.divider,
                  )}
                >
                  <span className={cn("home-kicker", ui.typography.muted)}>
                    {t.ai_chat_label ?? "AI Lab Chat"}
                  </span>
                  <Link
                    href="/ai-lab"
                    className={cn(
                      "text-[10px] font-semibold uppercase tracking-wider flex items-center gap-1 hover:underline",
                      ui.accent.textLink,
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
            className="min-h-[360px] lg:min-h-[420px] rounded-none border-0"
          />
        </motion.div>
      </div>
    </section>
  );
}
