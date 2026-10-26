"use client";

import { Canvas } from "@react-three/fiber";
import { useState, useCallback, useMemo, useEffect } from "react";
import * as THREE from "three";
import type { MoleculeData, AtomData } from "@/lib/molecules/types";
import { WATER } from "@/lib/molecules/data";
import { MoleculeRenderer } from "./MoleculeRenderer";
import { CameraRig } from "./CameraRig";
import { StudioFloor, STUDIO_FLOOR_Y } from "./StudioFloor";
import { CanvasToolbar } from "./CanvasToolbar";
import { MeasurementModeToggle } from "./MeasurementModeToggle";
import { SceneStage } from "./SceneStage";
import { useMeasurement } from "@/context/MeasurementContext";
import { useFocus } from "@/context/FocusContext";
import { useDeviceTier, resolveSphereSegments } from "@/hooks/useDeviceTier";
import { CanvasRaycasterConfig } from "@/components/canvas/CanvasRaycasterConfig";
import { CanvasRendererRelease } from "@/components/canvas/CanvasRendererRelease";
import { cn } from "@/lib/utils";

interface MoleculeSceneProps {
  molecule?: MoleculeData;
  autoRotate?: boolean;
  showLabels?: boolean;
  enableZoom?: boolean;
  enablePan?: boolean;
  className?: string;
  onAtomSelect?: (atom: AtomData | null) => void;
  toggleClassName?: string;
  showRenderModeToggle?: boolean;
  showMeasurementToggle?: boolean;
  measurementToggleClassName?: string;
  /** Override device-tier post-processing reduction (e.g. marketing previews). */
  reduceEffects?: boolean;
}

export function MoleculeScene({
  molecule = WATER,
  autoRotate = true,
  showLabels = true,
  enableZoom = true,
  enablePan = true,
  className = "",
  onAtomSelect,
  toggleClassName,
  showRenderModeToggle = true,
  showMeasurementToggle = false,
  measurementToggleClassName,
  reduceEffects,
}: MoleculeSceneProps) {
  const [selectedAtomId, setSelectedAtomId] = useState<string | null>(null);
  const { measurementMode, clearMeasurement } = useMeasurement();
  const { clearFocus, isFocused } = useFocus();
  const deviceTier = useDeviceTier();
  const sphereSegments = resolveSphereSegments(deviceTier, molecule.atoms.length);

  const handleAtomSelect = useCallback(
    (atom: AtomData | null) => {
      if (measurementMode) return;
      setSelectedAtomId(atom?.id ?? null);
      onAtomSelect?.(atom);
    },
    [onAtomSelect, measurementMode],
  );

  const handlePointerMissed = useCallback(() => {
    if (measurementMode) {
      clearMeasurement();
      return;
    }
    clearFocus();
    setSelectedAtomId(null);
    onAtomSelect?.(null);
  }, [measurementMode, clearMeasurement, clearFocus, onAtomSelect]);

  const moleculeScale = molecule.atoms.length > 10 ? 1.6 : molecule.atoms.length > 5 ? 1.8 : 2.2;
  const cameraDistance = molecule.atoms.length > 10 ? 10 : molecule.atoms.length > 5 ? 8 : 6;
  const accentColor = molecule.education?.color ?? "#818cf8";

  const studioFloorY = useMemo(() => {
    if (molecule.atoms.length === 0) return STUDIO_FLOOR_Y;
    const center = new THREE.Vector3();
    molecule.atoms.forEach((a) => center.add(new THREE.Vector3(...a.position)));
    center.divideScalar(molecule.atoms.length);
    let minY = 0;
    molecule.atoms.forEach((a) => {
      const y = (a.position[1] - center.y) * moleculeScale;
      minY = Math.min(minY, y);
    });
    return Math.min(STUDIO_FLOOR_Y, minY - 1.25);
  }, [molecule.atoms, moleculeScale]);

  return (
    <div
      className={cn(
        "relative w-full h-full canvas-touch-surface studio-canvas-atmosphere",
        deviceTier.isMobile && "max-h-[min(50vh,28rem)] touch-none overscroll-contain",
        className,
      )}
    >
      {showMeasurementToggle && (
        <MeasurementModeToggle
          accentColor={accentColor}
          className={
            measurementToggleClassName ??
            "absolute top-4 right-4 z-20 pointer-events-auto"
          }
        />
      )}
      {showRenderModeToggle && (
        <CanvasToolbar
          accentColor={accentColor}
          showRenderModes
          position="bottom-right"
          className={toggleClassName}
        />
      )}
      <div className="relative z-[1] h-full w-full">
        <Canvas
          camera={{ position: [0, 0, cameraDistance], fov: 42 }}
          dpr={deviceTier.dpr}
          gl={{
            antialias: !deviceTier.isMobile,
            alpha: true,
            powerPreference: deviceTier.isMobile ? "default" : "high-performance",
          }}
          style={{ background: "transparent", touchAction: "none" }}
          onPointerMissed={handlePointerMissed}
        >
          <CanvasRaycasterConfig />
          <CanvasRendererRelease />
          <SceneStage
            reduceEffects={reduceEffects ?? deviceTier.isMobile}
            accentColor={accentColor}
            footer={
              <>
                <StudioFloor accentColor={accentColor} shadowScale={16} y={studioFloorY} />
                <CameraRig
                  autoRotate={autoRotate && !isFocused}
                  enableZoom={enableZoom}
                  enablePan={enablePan}
                  cameraDistance={cameraDistance}
                />
              </>
            }
          >
            <MoleculeRenderer
              molecule={molecule}
              scale={moleculeScale}
              showLabels={showLabels}
              onAtomSelect={handleAtomSelect}
              selectedAtomId={measurementMode ? null : selectedAtomId}
              accentColor={accentColor}
              sphereSegments={sphereSegments}
              atomHitScale={deviceTier.atomHitScale}
              espsEnabled={deviceTier.espsEnabled}
            />
          </SceneStage>
        </Canvas>
      </div>
    </div>
  );
}

export function Scene() {
  const [isClient, setIsClient] = useState(false);

  useEffect(() => {
    setIsClient(true);
  }, []);

  return (
    <div className="absolute inset-0 z-0 pointer-events-auto">
      {isClient ? (
        <MoleculeScene molecule={WATER} showLabels={false} enableZoom={false} />
      ) : (
        <div className="absolute inset-0 studio-canvas-atmosphere" aria-hidden />
      )}
    </div>
  );
}
