"use client";

import { Toaster } from "sonner";
import { useTheme } from "@/context/ThemeContext";

export function ThemeToaster() {
  const { isWhiteLab } = useTheme();

  return (
    <Toaster
      position="top-right"
      expand
      richColors
      closeButton
      visibleToasts={4}
      theme={isWhiteLab ? "light" : "dark"}
      toastOptions={{
        duration: 5200,
        classNames: {
          toast: isWhiteLab
            ? "backdrop-blur-md !bg-white/92 !border !border-slate-200 !text-slate-900 !shadow-lg !shadow-slate-200/50"
            : "backdrop-blur-md !bg-slate-900/92 !border !border-slate-700 !text-cyan-100 !shadow-xl !shadow-cyan-500/10",
          title: isWhiteLab ? "!text-slate-900 font-semibold" : "!text-cyan-50 font-semibold",
          description: isWhiteLab ? "!text-slate-600" : "!text-slate-300",
          actionButton: isWhiteLab
            ? "!bg-cyan-600 !text-white"
            : "!bg-cyan-500 !text-slate-950",
          cancelButton: isWhiteLab ? "!bg-slate-100 !text-slate-700" : "!bg-slate-800 !text-slate-200",
          closeButton: isWhiteLab ? "!bg-slate-100 !text-slate-600" : "!bg-slate-800 !text-slate-300",
          success: isWhiteLab
            ? "!border-emerald-200 !text-emerald-800"
            : "!border-emerald-500/30 !text-emerald-300",
          error: isWhiteLab
            ? "!border-rose-200 !text-rose-800"
            : "!border-rose-500/30 !text-rose-300",
        },
      }}
    />
  );
}
