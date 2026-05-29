"use client";

import { Grid, ContactShadows } from "@react-three/drei";
import { useTheme } from "@/context/ThemeContext";

/** Shared studio floor height — clears large models (C60, heme) while pivot stays at origin. */
export const STUDIO_FLOOR_Y = -6;

interface StudioFloorProps {
  accentColor?: string;
  shadowScale?: number;
  y?: number;
}

export function StudioFloor({
  accentColor = "#818cf8",
  shadowScale = 14,
  y = STUDIO_FLOOR_Y,
}: StudioFloorProps) {
  const { scene, isWhiteLab } = useTheme();
  const sectionColor = isWhiteLab ? scene.gridSectionColor : accentColor;

  return (
    <group position={[0, y, 0]}>
      <Grid
        position={[0, 0.01, 0]}
        args={[28, 28]}
        cellSize={0.55}
        cellThickness={isWhiteLab ? 0.65 : 0.5}
        sectionSize={2.75}
        sectionThickness={isWhiteLab ? 1.15 : 1}
        cellColor={scene.gridCellColor}
        sectionColor={sectionColor}
        fadeDistance={scene.gridFadeDistance}
        fadeStrength={1.1}
        infiniteGrid
      />

      <ContactShadows
        position={[0, 0, 0]}
        opacity={scene.contactShadowOpacity}
        scale={shadowScale}
        blur={scene.contactShadowBlur}
        far={8}
        color={isWhiteLab ? "#64748b" : accentColor}
      />
    </group>
  );
}
