"use client";

import { Play, RotateCcw } from "lucide-react";
import { useLanguage } from "@/context/LanguageContext";
import { useTheme } from "@/context/ThemeContext";
import type { ReactionAnimationStatus } from "@/lib/reactions/animation/status";
import { cn } from "@/lib/utils";

interface ReactionPlaybackControlsProps {
  status: ReactionAnimationStatus;
  accentColor: string;
  onPlay: () => void;
  onReset: () => void;
  className?: string;
}

export function ReactionPlaybackControls({
  status,
  accentColor,
  onPlay,
  onReset,
  className,
}: ReactionPlaybackControlsProps) {
  const { t } = useLanguage();
  const { ui } = useTheme();

  const isPlaying = status === "playing";
  const isCompleted = status === "completed";

  return (
    <div className={cn("pointer-events-auto flex flex-wrap items-center gap-2", className)}>
      {isCompleted && (
        <button
          type="button"
          onClick={onReset}
          className={cn(
            "flex items-center gap-2 px-4 py-2.5 md:px-5 md:py-3 rounded-2xl text-xs md:text-sm font-semibold",
            "transition-all duration-300 border active:scale-[0.98]",
            ui.controls.play,
          )}
          aria-label={t.button_reset_reaction ?? "Reset reaction"}
        >
          <RotateCcw className="w-4 h-4" />
          {t.button_reset_reaction ?? "Reset"}
        </button>
      )}

      <button
        type="button"
        onClick={onPlay}
        disabled={isPlaying}
        className={cn(
          "flex items-center gap-2 px-4 py-2.5 md:px-5 md:py-3 rounded-2xl text-xs md:text-sm font-semibold",
          "transition-all duration-300 border disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]",
          ui.controls.play,
        )}
        style={{
          boxShadow: isPlaying ? `0 0 28px ${accentColor}33` : undefined,
        }}
        aria-label={
          isPlaying
            ? (t.button_playing ?? "Playing")
            : isCompleted
              ? (t.button_replay_reaction ?? "Replay reaction")
              : (t.button_play_reaction ?? "Play reaction")
        }
      >
        {isCompleted && !isPlaying ? (
          <RotateCcw className="w-4 h-4" />
        ) : (
          <Play className={cn("w-4 h-4", isPlaying && "animate-pulse")} />
        )}
        {isPlaying
          ? (t.button_playing ?? "Playing…")
          : isCompleted
            ? (t.button_replay_reaction ?? "Replay")
            : (t.button_play_reaction ?? "Play")}
      </button>
    </div>
  );
}
