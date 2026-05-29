"use client";

import { useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import type {
  ReactionAnimationDefinition,
  ReactionAnimationSample,
} from "@/lib/reactions/animation/types";
import { CameraRig, ORBIT_MAX_DISTANCE } from "@/components/canvas/CameraRig";
import { getReactionCameraDistance } from "@/lib/reactions/animation/center";
import { StudioFloor } from "@/components/canvas/StudioFloor";
import { SceneStage } from "@/components/canvas/SceneStage";
import { CanvasRaycasterConfig } from "@/components/canvas/CanvasRaycasterConfig";
import { useDeviceTier } from "@/hooks/useDeviceTier";
import { cn } from "@/lib/utils";
import { ReactionAnimator } from "./ReactionAnimator";

interface ReactionAnimationSceneProps {
  definition: ReactionAnimationDefinition;
  accentColor?: string;
  playSignal: number;
  resetSignal?: number;
  onComplete?: () => void;
  onPhaseChange?: (phase: ReactionAnimationSample["phase"]) => void;
  className?: string;
}

export function ReactionAnimationScene({
  definition,
  accentColor = "#f97316",
  playSignal,
  resetSignal = 0,
  onComplete,
  onPhaseChange,
  className = "",
}: ReactionAnimationSceneProps) {
  const cameraDistance = useMemo(
    () => getReactionCameraDistance(definition),
    [definition],
  );
  const deviceTier = useDeviceTier();

  return (
    <div
      className={cn(
        "w-full h-full canvas-touch-surface",
        deviceTier.isMobile && "max-h-[min(50vh,28rem)] touch-none overscroll-contain",
        className,
      )}
    >
      <Canvas
        camera={{ position: [0, 0, cameraDistance], fov: 48 }}
        dpr={deviceTier.dpr}
        gl={{
          antialias: !deviceTier.isMobile,
          alpha: true,
          powerPreference: deviceTier.isMobile ? "default" : "high-performance",
        }}
        style={{ background: "transparent", touchAction: "none" }}
      >
        <CanvasRaycasterConfig />
        <SceneStage
          accentColor={accentColor}
          reduceEffects={deviceTier.isMobile}
          footer={
            <>
              <StudioFloor accentColor={accentColor} shadowScale={18} />
              <CameraRig
                autoRotate={false}
                enableZoom
                enablePan
                cameraDistance={cameraDistance}
                maxDistance={ORBIT_MAX_DISTANCE}
              />
            </>
          }
        >
          <ReactionAnimator
            definition={definition}
            playSignal={playSignal}
            resetSignal={resetSignal}
            onComplete={onComplete}
            onPhaseChange={onPhaseChange}
          />
        </SceneStage>
      </Canvas>
    </div>
  );
}
