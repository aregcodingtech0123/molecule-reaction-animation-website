"use client";

import { Html } from "@react-three/drei";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

/**
 * Centered R3F Suspense fallback — shown while Environment, molecules, and assets load.
 */
export function CanvasLoadingFallback({ label = "Loading 3D scene…" }: { label?: string }) {
  const { isWhiteLab } = useTheme();

  return (
    <Html center transform zIndexRange={[100, 0]}>
      <div
        className={cn(
          "flex flex-col items-center gap-4 px-6 py-5 rounded-2xl border backdrop-blur-md select-none pointer-events-none",
          isWhiteLab
            ? "border-slate-200/90 bg-white/85 shadow-lg shadow-slate-200/40"
            : "border-slate-700/80 bg-slate-900/85 shadow-xl shadow-cyan-500/10",
        )}
        aria-live="polite"
        aria-busy="true"
      >
        <div className="relative h-14 w-14">
          <div
            className={cn(
              "absolute inset-0 rounded-full border-2 border-dashed animate-spin",
              isWhiteLab ? "border-cyan-400/50" : "border-cyan-400/40",
            )}
            style={{ animationDuration: "3s" }}
          />
          <svg
            viewBox="0 0 64 64"
            className="absolute inset-1 h-12 w-12 animate-pulse"
            aria-hidden
          >
            <circle
              cx="32"
              cy="32"
              r="6"
              className={isWhiteLab ? "fill-cyan-600" : "fill-cyan-400"}
            />
            <ellipse
              cx="32"
              cy="32"
              rx="22"
              ry="8"
              fill="none"
              strokeWidth="2"
              className={isWhiteLab ? "stroke-cyan-500/70" : "stroke-cyan-300/60"}
              transform="rotate(-20 32 32)"
            />
            <ellipse
              cx="32"
              cy="32"
              rx="22"
              ry="8"
              fill="none"
              strokeWidth="2"
              className={isWhiteLab ? "stroke-teal-500/50" : "stroke-teal-300/45"}
              transform="rotate(40 32 32)"
            />
            <ellipse
              cx="32"
              cy="32"
              rx="22"
              ry="8"
              fill="none"
              strokeWidth="2"
              className={isWhiteLab ? "stroke-cyan-400/40" : "stroke-cyan-200/35"}
              transform="rotate(100 32 32)"
            />
          </svg>
        </div>
        <p
          className={cn(
            "text-xs font-medium tracking-wide uppercase",
            isWhiteLab ? "text-slate-600" : "text-cyan-200/90",
          )}
        >
          {label}
        </p>
      </div>
    </Html>
  );
}
