"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { MoleculeScene } from "@/components/canvas/Scene";
import { MOLECULE_MAP } from "@/lib/molecules/data";
import type { MoleculeData } from "@/lib/molecules/types";
import { useTheme } from "@/context/ThemeContext";
import { cn } from "@/lib/utils";

interface HomeMoleculePreviewProps {
  /** Molecule id (e.g. `"caffeine"`) or full molecule data. */
  molecule: MoleculeData | string;
  className?: string;
  /** Outer frame — defaults to Explore-style canvas card + stage. */
  frameClassName?: string;
  rounded?: "none" | "sm" | "xl" | "2xl" | "3xl";
  showMetadata?: boolean;
  autoRotate?: boolean;
  enableZoom?: boolean;
  /** Defer WebGL mount until the frame enters the viewport. */
  lazy?: boolean;
  /** Lighter post-processing for stacked homepage canvases. */
  reduceEffects?: boolean;
  /** Block orbit/zoom so parent links receive clicks. */
  pointerEventsNone?: boolean;
}

function resolveMolecule(molecule: MoleculeData | string): MoleculeData | undefined {
  return typeof molecule === "string" ? MOLECULE_MAP[molecule] : molecule;
}

function previewRadiusClass(rounded: HomeMoleculePreviewProps["rounded"]) {
  if (rounded === "none") return "rounded-none";
  if (rounded === "sm") return "rounded-sm";
  if (rounded === "3xl") return "rounded-3xl";
  if (rounded === "xl") return "rounded-xl";
  return "rounded-2xl";
}

/** SSR-safe shell — identical markup on server and first client paint. */
function PreviewPlaceholder({ radiusClass }: { radiusClass: string }) {
  return (
    <div
      className={cn("absolute inset-0 z-[1]", radiusClass)}
      style={{ background: "var(--canvas-card-bg)" }}
      aria-hidden
    />
  );
}

export function HomeMoleculePreview({
  molecule,
  className,
  frameClassName,
  rounded = "2xl",
  showMetadata = false,
  autoRotate = true,
  enableZoom = false,
  lazy = true,
  reduceEffects = true,
  pointerEventsNone = true,
}: HomeMoleculePreviewProps) {
  const { ui } = useTheme();
  const resolved = useMemo(() => resolveMolecule(molecule), [molecule]);
  const rootRef = useRef<HTMLDivElement>(null);
  /** Never render WebGL until after hydration — Canvas must not SSR. */
  const [isClient, setIsClient] = useState(false);
  const [showScene, setShowScene] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  useEffect(() => {
    if (!isClient) return;

    if (!lazy) {
      setShowScene(true);
      return;
    }

    const node = rootRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShowScene(true);
          observer.disconnect();
        }
      },
      { rootMargin: "160px", threshold: 0.08 },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [isClient, lazy]);

  if (!resolved) return null;

  const radiusClass = previewRadiusClass(rounded);

  return (
    <div
      ref={rootRef}
      className={cn(
        "relative overflow-hidden canvas-card canvas-stage",
        radiusClass,
        frameClassName,
        className,
      )}
    >
      <div
        className={cn(
          "absolute inset-0 pointer-events-none z-10",
          radiusClass,
          "canvas-vignette",
        )}
      />

      {showScene ? (
        <div
          className={cn("absolute inset-0 z-[5]", pointerEventsNone && "pointer-events-none")}
        >
          <MoleculeScene
            molecule={resolved}
            autoRotate={autoRotate}
            showLabels={false}
            enableZoom={enableZoom}
            enablePan={!pointerEventsNone && enableZoom}
            showRenderModeToggle={false}
            showMeasurementToggle={false}
            reduceEffects={reduceEffects}
            className="h-full w-full"
          />
        </div>
      ) : (
        <PreviewPlaceholder radiusClass={radiusClass} />
      )}

      {showMetadata && showScene && (
        <div className="absolute bottom-4 left-4 z-20 pointer-events-none">
          <div className={cn("px-3 py-2 rounded-xl border text-xs", ui.panel.overlay, ui.borders.subtle)}>
            <p className={cn("font-semibold", ui.typography.title)}>{resolved.name}</p>
            <p className={cn("font-mono mt-0.5", ui.typography.monoMuted)}>{resolved.formula}</p>
          </div>
        </div>
      )}
    </div>
  );
}
