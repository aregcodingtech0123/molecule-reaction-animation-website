"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Bot, X, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useAiChat } from "@/hooks/useAiChat";
import { AiChatPanel } from "@/components/ai/AiChatPanel";
import { useTheme } from "@/context/ThemeContext";
import { useDynamicMolecule } from "@/context/DynamicMoleculeContext";
import { cn } from "@/lib/utils";

export function LabAssistantChat() {
  const [open, setOpen] = useState(false);
  const { setDynamicMolecule } = useDynamicMolecule();
  const router = useRouter();
  const { ui, isWhiteLab } = useTheme();

  const chat = useAiChat({
    onMoleculeGenerated: (mol) => {
      setDynamicMolecule(mol);
      router.push("/explore");
    },
  });

  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => chat.inputRef.current?.focus(), 200);
      return () => window.clearTimeout(t);
    }
  }, [open, chat.inputRef]);

  return (
    <>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className={cn(
              "fixed bottom-24 right-5 z-[70] flex w-[min(100vw-2.5rem,22rem)] flex-col overflow-hidden rounded-2xl shadow-2xl backdrop-blur-xl",
              "sm:w-[24rem] sm:bottom-24 sm:right-6",
              isWhiteLab
                ? "border border-slate-200 bg-white/95 shadow-slate-200/50"
                : "border border-white/10 bg-neutral-950/95",
            )}
            style={{ maxHeight: "min(32rem, calc(100vh - 7rem))" }}
            role="dialog"
            aria-label="MoleculeStudio Lab Assistant"
          >
            <header
              className={cn(
                "flex items-center justify-between gap-3 border-b px-4 py-3 flex-shrink-0",
                ui.borders.divider,
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <div
                  className={cn(
                    "flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl border",
                    isWhiteLab
                      ? "bg-indigo-100 border-indigo-300"
                      : "bg-indigo-500/20 border-indigo-400/30",
                  )}
                >
                  <Sparkles
                    className={cn("h-4 w-4", isWhiteLab ? "text-indigo-700" : "text-indigo-300")}
                  />
                </div>
                <div className="min-w-0">
                  <h2 className={cn("text-sm font-semibold truncate", ui.typography.title)}>
                    Lab Assistant
                  </h2>
                  <p className={cn("text-[10px] truncate", ui.typography.muted)}>
                    Chemistry · Biology · Materials
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className={cn(
                  "rounded-lg p-1.5 transition-colors",
                  ui.controls.iconButton,
                  isWhiteLab ? "hover:bg-slate-100" : "hover:bg-white/10",
                )}
                aria-label="Close chat"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <AiChatPanel chat={chat} variant="compact" className="flex-1 min-h-0" />
          </motion.div>
        )}
      </AnimatePresence>

      <motion.button
        type="button"
        onClick={() => setOpen((v) => !v)}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className={cn(
          "fixed bottom-5 right-5 z-[70] flex h-14 w-14 items-center justify-center rounded-full",
          "bg-gradient-to-br from-indigo-600 to-purple-700 text-white",
          "border border-white/15 shadow-[0_0_30px_rgba(99,102,241,0.45)]",
          "transition-shadow hover:shadow-[0_0_40px_rgba(99,102,241,0.55)]",
          open && "ring-2 ring-indigo-400/50",
        )}
        aria-label={open ? "Close Lab Assistant" : "Open Lab Assistant"}
        aria-expanded={open}
      >
        <AnimatePresence mode="wait" initial={false}>
          {open ? (
            <motion.span
              key="close"
              initial={{ opacity: 0, rotate: -90 }}
              animate={{ opacity: 1, rotate: 0 }}
              exit={{ opacity: 0, rotate: 90 }}
            >
              <X className="h-6 w-6" />
            </motion.span>
          ) : (
            <motion.span
              key="open"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
            >
              <Bot className="h-6 w-6" />
            </motion.span>
          )}
        </AnimatePresence>
      </motion.button>
    </>
  );
}
