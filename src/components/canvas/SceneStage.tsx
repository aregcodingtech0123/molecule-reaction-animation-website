"use client";

import { Suspense, type ReactNode } from "react";
import { Environment, Stars, AdaptiveDpr, Preload } from "@react-three/drei";
import { EffectComposer, Bloom, Vignette, ChromaticAberration } from "@react-three/postprocessing";
import { BlendFunction } from "postprocessing";
import { useTheme } from "@/context/ThemeContext";
import { SceneLighting } from "./SceneLighting";
import { ParticleField } from "./ParticleField";
import { CanvasLoadingFallback } from "./CanvasLoadingFallback";

interface SceneStageProps {
  accentColor: string;
  children: ReactNode;
  /** Extra lights / content after shared rig */
  footer?: ReactNode;
  /** Skip post-processing & heavy extras on phones/tablets */
  reduceEffects?: boolean;
}

/**
 * Shared R3F environment: background, lighting, optional stars/particles, post-processing.
 */
export function SceneStage({ accentColor, children, footer, reduceEffects = false }: SceneStageProps) {
  const { scene, isWhiteLab } = useTheme();
  const particleCount = reduceEffects ? 48 : 160;

  return (
    <Suspense fallback={<CanvasLoadingFallback />}>
      {/* Opaque WebGL clear only in dark mode — light mode shows CSS studio atmosphere through alpha */}
      {!isWhiteLab && <color attach="background" args={[scene.background]} />}

      <pointLight
        position={[0, 4, 4]}
        intensity={scene.accentLightIntensity}
        color={accentColor}
        distance={22}
        decay={2}
      />

      <SceneLighting />
      <Environment preset={scene.environmentPreset} environmentIntensity={scene.environmentIntensity} />

      {scene.showStars && (
        <Stars
          radius={80}
          depth={60}
          count={scene.starCount}
          factor={4}
          saturation={scene.showStars ? 0.2 : 0}
          fade
          speed={0.4}
        />
      )}

      {scene.showParticles && (
        <ParticleField
          count={particleCount}
          spread={18}
          color={accentColor}
          speed={0.12}
          size={0.035}
          opacity={scene.particleOpacity}
        />
      )}

      {children}
      {footer}

      {!reduceEffects && (
        <EffectComposer>
          <Bloom
            luminanceThreshold={scene.bloomThreshold}
            luminanceSmoothing={0.9}
            intensity={scene.bloomIntensity}
            mipmapBlur
          />
          <Vignette eskil={false} offset={0.08} darkness={scene.vignetteDarkness} />
          <ChromaticAberration
            blendFunction={BlendFunction.NORMAL}
            offset={scene.chromaticAberration ? [0.0005, 0.0005] : [0, 0]}
          />
        </EffectComposer>
      )}

      {!reduceEffects && <AdaptiveDpr pixelated />}
      <Preload all />
    </Suspense>
  );
}
