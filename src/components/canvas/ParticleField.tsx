"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

interface ParticleFieldProps {
  count?: number;
  spread?: number;
  color?: string;
  speed?: number;
  size?: number;
  opacity?: number;
}

/** Deterministic 0–1 value (pure — safe during render). */
function pseudoRandom(index: number, salt: number): number {
  const x = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

function buildParticleBuffers(count: number, spread: number) {
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    positions[i * 3 + 0] = (pseudoRandom(i, 1) - 0.5) * spread;
    positions[i * 3 + 1] = (pseudoRandom(i, 2) - 0.5) * spread;
    positions[i * 3 + 2] = (pseudoRandom(i, 3) - 0.5) * spread;
    phases[i] = pseudoRandom(i, 4) * Math.PI * 2;
  }
  return { positions, phases };
}

/**
 * Ambient floating particle field for cinematic background depth.
 * Uses a single BufferGeometry with instanced points for performance.
 */
export function ParticleField({
  count = 200,
  spread = 20,
  color = "#818cf8",
  speed = 0.15,
  size = 0.04,
  opacity = 0.5,
}: ParticleFieldProps) {
  const meshRef = useRef<THREE.Points>(null);

  const { positions, phases } = useMemo(
    () => buildParticleBuffers(count, spread),
    [count, spread],
  );

  // Animate vertical drift with individual phase offsets
  useFrame((state) => {
    if (!meshRef.current) return;
    const pos = meshRef.current.geometry.attributes.position.array as Float32Array;
    const t = state.clock.elapsedTime * speed;
    for (let i = 0; i < count; i++) {
      pos[i * 3 + 1] = positions[i * 3 + 1] + Math.sin(t + phases[i]) * 0.3;
    }
    meshRef.current.geometry.attributes.position.needsUpdate = true;
    meshRef.current.rotation.y = state.clock.elapsedTime * 0.02;
  });

  return (
    <points ref={meshRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={size}
        transparent
        opacity={opacity}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        sizeAttenuation
      />
    </points>
  );
}
