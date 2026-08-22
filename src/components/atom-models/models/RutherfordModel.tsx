"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const ORBIT_RADIUS = 2.2;
const ELECTRON_COUNT = 4;

/** Dense nucleus + distant orbiting electrons — Rutherford (1911) */
export function RutherfordModel() {
  const groupRef = useRef<THREE.Group>(null);
  const electronRefs = useRef<THREE.Mesh[]>([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.08;
    }
    electronRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const angle = t * (0.6 + i * 0.15) + (i * Math.PI * 2) / ELECTRON_COUNT;
      const tilt = 0.4 + i * 0.35;
      mesh.position.set(
        Math.cos(angle) * ORBIT_RADIUS * Math.cos(tilt),
        Math.sin(angle) * ORBIT_RADIUS * 0.5,
        Math.sin(angle) * ORBIT_RADIUS * Math.sin(tilt),
      );
    });
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[0.35, 32, 32]} />
        <meshStandardMaterial
          color="#eab308"
          emissive="#ca8a04"
          emissiveIntensity={0.5}
          roughness={0.25}
          metalness={0.4}
        />
      </mesh>
      {Array.from({ length: ELECTRON_COUNT }).map((_, i) => (
        <mesh
          key={i}
          ref={(el) => {
            if (el) electronRefs.current[i] = el;
          }}
        >
          <sphereGeometry args={[0.1, 16, 16]} />
          <meshStandardMaterial
            color="#60a5fa"
            emissive="#3b82f6"
            emissiveIntensity={0.55}
            roughness={0.15}
          />
        </mesh>
      ))}
    </group>
  );
}
