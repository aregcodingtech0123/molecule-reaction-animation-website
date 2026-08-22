"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const SHELLS = [
  { radius: 0.9, electrons: 2, speed: 1.2 },
  { radius: 1.5, electrons: 2, speed: 0.85 },
  { radius: 2.1, electrons: 1, speed: 0.55 },
];

function OrbitRing({ radius }: { radius: number }) {
  return (
    <mesh rotation={[Math.PI / 2, 0, 0]}>
      <torusGeometry args={[radius, 0.012, 8, 96]} />
      <meshBasicMaterial color="#3b82f6" transparent opacity={0.35} />
    </mesh>
  );
}

/** Quantized circular orbits — Bohr model (1913) */
export function BohrModel() {
  const groupRef = useRef<THREE.Group>(null);
  const electronGroups = useRef<THREE.Group[]>([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (groupRef.current) {
      groupRef.current.rotation.x = 0.25;
    }
    SHELLS.forEach((shell, si) => {
      const g = electronGroups.current[si];
      if (!g) return;
      g.rotation.y = t * shell.speed;
    });
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[0.32, 32, 32]} />
        <meshStandardMaterial
          color="#ef4444"
          emissive="#dc2626"
          emissiveIntensity={0.45}
          roughness={0.2}
          metalness={0.35}
        />
      </mesh>
      {SHELLS.map((shell, si) => (
        <group key={shell.radius}>
          <OrbitRing radius={shell.radius} />
          <group
            ref={(el) => {
              if (el) electronGroups.current[si] = el;
            }}
          >
            {Array.from({ length: shell.electrons }).map((_, ei) => {
              const angle = (ei / shell.electrons) * Math.PI * 2;
              return (
                <mesh
                  key={ei}
                  position={[
                    Math.cos(angle) * shell.radius,
                    0,
                    Math.sin(angle) * shell.radius,
                  ]}
                >
                  <sphereGeometry args={[0.09, 16, 16]} />
                  <meshStandardMaterial
                    color="#38bdf8"
                    emissive="#0ea5e9"
                    emissiveIntensity={0.65}
                  />
                </mesh>
              );
            })}
          </group>
        </group>
      ))}
    </group>
  );
}
