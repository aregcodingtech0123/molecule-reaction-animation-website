"use client";

import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { CameraRig } from "@/components/canvas/CameraRig";
import { CanvasRaycasterConfig } from "@/components/canvas/CanvasRaycasterConfig";
import { CanvasRendererRelease } from "@/components/canvas/CanvasRendererRelease";
import { SceneStage } from "@/components/canvas/SceneStage";
import { CanvasLoadingFallback } from "@/components/canvas/CanvasLoadingFallback";
import { useDeviceTier } from "@/hooks/useDeviceTier";
import type { AtomModelId } from "@/lib/atom-models/types";
import { ATOM_MODEL_META } from "@/lib/atom-models/data";
import { cn } from "@/lib/utils";
import { DaltonModel } from "./models/DaltonModel";
import { ThomsonModel } from "./models/ThomsonModel";
import { RutherfordModel } from "./models/RutherfordModel";
import { BohrModel } from "./models/BohrModel";
import { QuantumModel } from "./models/QuantumModel";

interface AtomModelSceneProps {
  modelId: AtomModelId;
  className?: string;
}

function ModelSwitch({ modelId }: { modelId: AtomModelId }) {
  switch (modelId) {
    case "dalton":
      return <DaltonModel />;
    case "thomson":
      return <ThomsonModel />;
    case "rutherford":
      return <RutherfordModel />;
    case "bohr":
      return <BohrModel />;
    case "quantum":
      return <QuantumModel />;
  }
}

export function AtomModelScene({ modelId, className }: AtomModelSceneProps) {
  const meta = ATOM_MODEL_META[modelId];
  const deviceTier = useDeviceTier();

  return (
    <div
      className={cn(
        "relative w-full h-full min-h-[280px] canvas-touch-surface canvas-card canvas-stage rounded-2xl lg:rounded-3xl overflow-hidden",
        deviceTier.isMobile && "max-h-[min(50vh,28rem)] touch-none overscroll-contain",
        className,
      )}
    >
      <Canvas
        camera={{ position: [0, 0, 6], fov: 42 }}
        dpr={deviceTier.dpr}
        gl={{
          antialias: !deviceTier.isMobile,
          alpha: true,
          powerPreference: deviceTier.isMobile ? "default" : "high-performance",
        }}
        style={{ background: "transparent", touchAction: "none" }}
      >
        <CanvasRaycasterConfig />
        <CanvasRendererRelease />
        <Suspense fallback={<CanvasLoadingFallback label="Loading atom model…" />}>
          <SceneStage accentColor={meta.accentColor} reduceEffects={deviceTier.isMobile}>
            <CameraRig autoRotate enableZoom enablePan cameraDistance={6} />
            <ModelSwitch modelId={modelId} />
          </SceneStage>
        </Suspense>
      </Canvas>
    </div>
  );
}
