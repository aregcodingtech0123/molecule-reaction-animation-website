"use client";

import { useMemo } from "react";
import { Html, Line } from "@react-three/drei";
import { useTheme } from "@/context/ThemeContext";
import {
  distanceAngstrom,
  formatDistanceAngstrom,
  midpoint,
} from "@/lib/three/distance";

interface MeasurementOverlayProps {
  positionA: [number, number, number];
  positionB: [number, number, number];
  sceneScale: number;
  accentColor?: string;
}

export function MeasurementOverlay({
  positionA,
  positionB,
  sceneScale,
  accentColor = "#818cf8",
}: MeasurementOverlayProps) {
  const { isWhiteLab } = useTheme();

  const distance = useMemo(
    () => distanceAngstrom(positionA, positionB, sceneScale),
    [positionA, positionB, sceneScale],
  );

  const mid = useMemo(() => midpoint(positionA, positionB), [positionA, positionB]);

  const linePoints = useMemo(
    () => [positionA, positionB] as [[number, number, number], [number, number, number]],
    [positionA, positionB],
  );

  const labelBg = isWhiteLab ? "rgba(255, 255, 255, 0.96)" : "rgba(15, 23, 42, 0.88)";
  const labelText = isWhiteLab ? "#0f172a" : "#f8fafc";
  const labelBorder = isWhiteLab ? "#cbd5e1" : `${accentColor}66`;

  return (
    <group>
      <Line
        points={linePoints}
        color={accentColor}
        lineWidth={1.5}
        dashed
        dashSize={0.12}
        gapSize={0.08}
        dashScale={1}
        transparent
        opacity={0.95}
      />

      {/* Endpoint markers */}
      {[positionA, positionB].map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.06, 16, 16]} />
          <meshBasicMaterial color={accentColor} transparent opacity={0.85} />
        </mesh>
      ))}

      <group position={mid}>
        <Html center distanceFactor={10} style={{ pointerEvents: "none" }}>
          <div
            style={{
              background: labelBg,
              border: `1px solid ${labelBorder}`,
              borderRadius: "999px",
              padding: "4px 12px",
              fontFamily: "'Inter', ui-sans-serif, system-ui, sans-serif",
              fontSize: "12px",
              fontWeight: 700,
              color: labelText,
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              boxShadow: isWhiteLab
                ? "0 2px 10px rgba(15, 23, 42, 0.12)"
                : `0 0 16px ${accentColor}40`,
            }}
          >
            {formatDistanceAngstrom(distance)}
          </div>
        </Html>
      </group>
    </group>
  );
}
