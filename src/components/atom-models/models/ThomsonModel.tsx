"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const ELECTRON_POSITIONS: [number, number, number][] = [
  [0.55, 0.35, 0.2],
  [-0.45, 0.5, -0.15],
  [0.2, -0.55, 0.4],
  [-0.3, -0.25, -0.5],
  [0.65, -0.2, -0.35],
  [-0.6, 0.1, 0.45],
];

/** Positive sphere with embedded electrons — Thomson plum pudding (1904) */
export function ThomsonModel() {
  const groupRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (groupRef.current) {
      groupRef.current.rotation.y = state.clock.elapsedTime * 0.2;
    }
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[1.5, 48, 48]} />
        <meshPhysicalMaterial
          color="#f97316"
          emissive="#ea580c"
          emissiveIntensity={0.35}
          roughness={0.4}
          metalness={0.05}
          transparent
          opacity={0.55}
          transmission={0.25}
          thickness={0.8}
          side={THREE.DoubleSide}
        />
      </mesh>
      {ELECTRON_POSITIONS.map((pos, i) => (
        <mesh key={i} position={pos}>
          <sphereGeometry args={[0.12, 16, 16]} />
          <meshStandardMaterial
            color="#3b82f6"
            emissive="#2563eb"
            emissiveIntensity={0.6}
            roughness={0.2}
            metalness={0.3}
          />
        </mesh>
      ))}
    </group>
  );
}
