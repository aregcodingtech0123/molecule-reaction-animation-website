"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useTheme } from "@/context/ThemeContext";

/** Solid, rigid billiard-ball atom — Dalton (1803) */
export function DaltonModel() {
  const meshRef = useRef<THREE.Mesh>(null);
  const { isWhiteLab } = useTheme();

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.25;
    }
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1.4, 64, 64]} />
      <meshStandardMaterial
        color={isWhiteLab ? "#475569" : "#94a3b8"}
        roughness={0.85}
        metalness={isWhiteLab ? 0.35 : 0.55}
        envMapIntensity={isWhiteLab ? 0.8 : 1.2}
      />
    </mesh>
  );
}
