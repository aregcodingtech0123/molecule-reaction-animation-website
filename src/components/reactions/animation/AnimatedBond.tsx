"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BondOrder } from "@/lib/molecules/types";

const BOND_RADIUS = 0.055;
const DOUBLE_BOND_OFFSET = 0.1;

interface AnimatedBondProps {
  fromId: string;
  toId: string;
  order: BondOrder;
  positionsRef: React.RefObject<Map<string, THREE.Vector3>>;
  opacityRef: React.RefObject<number>;
  scale?: number;
}

export function AnimatedBond({
  fromId,
  toId,
  order,
  positionsRef,
  opacityRef,
  scale = 1,
}: AnimatedBondProps) {
  const sticks = order === 1 ? [0] : order === 2 ? [-1, 1] : [-1, 0, 1];

  return (
    <group>
      {sticks.map((offsetIndex) => (
        <BondStick
          key={offsetIndex}
          fromId={fromId}
          toId={toId}
          offsetIndex={offsetIndex}
          positionsRef={positionsRef}
          opacityRef={opacityRef}
          scale={scale}
        />
      ))}
    </group>
  );
}

function BondStick({
  fromId,
  toId,
  offsetIndex,
  positionsRef,
  opacityRef,
  scale,
}: {
  fromId: string;
  toId: string;
  offsetIndex: number;
  positionsRef: React.RefObject<Map<string, THREE.Vector3>>;
  opacityRef: React.RefObject<number>;
  scale: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const meshRef = useRef<THREE.Mesh>(null);
  const targetOpacity = useRef(0);

  useFrame(() => {
    const map = positionsRef.current;
    const group = groupRef.current;
    const mesh = meshRef.current;
    if (!map || !group || !mesh) return;

    const start = map.get(fromId);
    const end = map.get(toId);
    if (!start || !end) return;

    const mid = start.clone().add(end).multiplyScalar(0.5);
    const dir = end.clone().sub(start);
    const len = dir.length();
    if (len < 1e-6) return;

    const quat = new THREE.Quaternion();
    quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());

    const perp = new THREE.Vector3(1, 0, 0);
    perp.crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize();
    if (perp.length() < 0.01) {
      perp.crossVectors(dir, new THREE.Vector3(1, 0, 0)).normalize();
    }
    const off = perp.multiplyScalar(offsetIndex * DOUBLE_BOND_OFFSET * scale);

    group.position.set(mid.x + off.x, mid.y + off.y, mid.z + off.z);
    group.quaternion.copy(quat);
    mesh.scale.set(1, len, 1);

    targetOpacity.current = opacityRef.current ?? 0;
    const mat = mesh.material as THREE.MeshPhysicalMaterial;
    mat.opacity = THREE.MathUtils.lerp(mat.opacity, 0.88 * targetOpacity.current, 0.18);
  });

  return (
    <group ref={groupRef}>
      <mesh ref={meshRef}>
        <cylinderGeometry args={[BOND_RADIUS * scale, BOND_RADIUS * scale, 1, 12, 1]} />
        <meshPhysicalMaterial
          color="#94a3b8"
          emissive="#64748b"
          emissiveIntensity={0.08}
          roughness={0.35}
          metalness={0.15}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
