"use client";

import type { ReactNode } from "react";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

export function ThemeShell({ children }: { children: ReactNode }) {
  const { ui } = useTheme();

  return (
    <div
      className={cn(
        "flex min-h-screen flex-col transition-colors duration-500",
        ui.shell.page,
        ui.shell.selection,
      )}
    >
      {children}
    </div>
  );
}
