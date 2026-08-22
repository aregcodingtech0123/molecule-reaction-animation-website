"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

const CLOUD_LAYERS = [
  { radius: 1.1, opacity: 0.12, speed: 0.3 },
  { radius: 1.45, opacity: 0.1, speed: -0.22 },
  { radius: 1.85, opacity: 0.08, speed: 0.15 },
  { radius: 2.2, opacity: 0.06, speed: -0.12 },
];

/** Probabilistic electron cloud — quantum mechanical model (1920s) */
export function QuantumModel() {
  const groupRef = useRef<THREE.Group>(null);
  const cloudRefs = useRef<THREE.Mesh[]>([]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (groupRef.current) {
      groupRef.current.rotation.y = t * 0.06;
    }
    cloudRefs.current.forEach((mesh, i) => {
      if (!mesh) return;
      const layer = CLOUD_LAYERS[i];
      mesh.rotation.y = t * layer.speed;
      mesh.rotation.z = t * layer.speed * 0.5;
      const mat = mesh.material as THREE.MeshPhysicalMaterial;
      mat.opacity =
        layer.opacity + Math.sin(t * 1.5 + i) * 0.03;
    });
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[0.3, 32, 32]} />
        <meshStandardMaterial
          color="#a855f7"
          emissive="#9333ea"
          emissiveIntensity={0.5}
          roughness={0.2}
        />
      </mesh>
      {CLOUD_LAYERS.map((layer, i) => (
        <mesh
          key={layer.radius}
          ref={(el) => {
            if (el) cloudRefs.current[i] = el;
          }}
        >
          <sphereGeometry args={[layer.radius, 32, 32]} />
          <meshPhysicalMaterial
            color="#818cf8"
            emissive="#6366f1"
            emissiveIntensity={0.25}
            transparent
            opacity={layer.opacity}
            transmission={0.6}
            thickness={0.5}
            roughness={0.9}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}
