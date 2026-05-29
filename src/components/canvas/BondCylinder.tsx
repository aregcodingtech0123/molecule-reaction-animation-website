"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { BondData, AtomData, ElementSymbol } from "@/lib/molecules/types";
import { ELEMENT_PROPERTIES } from "@/lib/molecules/elements";
import { useRenderModeWeights } from "@/lib/three/render-mode-blend";

interface BondCylinderProps {
  bond: BondData;
  atomMap: Map<string, AtomData>;
  scale?: number;
  isDimmed?: boolean;
}

const BOND_RADIUS = 0.06;
const DOUBLE_BOND_OFFSET = 0.12;
const BALL_STICK_OPACITY = 0.85;

export function BondCylinder({ bond, atomMap, scale = 1, isDimmed = false }: BondCylinderProps) {
  const fromAtom = atomMap.get(bond.from);
  const toAtom = atomMap.get(bond.to);

  if (!fromAtom || !toAtom) return null;

  const sticks = bond.order === 1 ? [0] : bond.order === 2 ? [-1, 1] : [-1, 0, 1];

  return (
    <group>
      {sticks.map((offsetIndex) => (
        <SingleStick
          key={`${bond.id}-${offsetIndex}`}
          from={fromAtom}
          to={toAtom}
          offsetIndex={offsetIndex}
          scale={scale}
          isDimmed={isDimmed}
        />
      ))}
    </group>
  );
}

interface SingleStickProps {
  from: AtomData;
  to: AtomData;
  offsetIndex: number;
  scale: number;
  isDimmed: boolean;
}

function SingleStick({ from, to, offsetIndex, scale, isDimmed }: SingleStickProps) {
  const groupRef = useRef<THREE.Group>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const modeWeights = useRenderModeWeights();

  const { midpoint, length, quaternion, offset } = useMemo(() => {
    const start = new THREE.Vector3(...from.position);
    const end = new THREE.Vector3(...to.position);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    const dir = end.clone().sub(start);
    const len = dir.length();

    const quat = new THREE.Quaternion();
    if (len > 1e-6) {
      quat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    }

    const perp = new THREE.Vector3(1, 0, 0);
    perp.crossVectors(dir, new THREE.Vector3(0, 0, 1)).normalize();
    if (perp.length() < 0.01) {
      perp.crossVectors(dir, new THREE.Vector3(1, 0, 0)).normalize();
    }
    const off = perp.multiplyScalar(offsetIndex * DOUBLE_BOND_OFFSET * scale);

    return { midpoint: mid, length: len, quaternion: quat, offset: off };
  }, [from.position, to.position, offsetIndex, scale]);

  const fromColor = useMemo(() => {
    const p = ELEMENT_PROPERTIES[from.element as ElementSymbol] ?? ELEMENT_PROPERTIES.C;
    return new THREE.Color(p.color);
  }, [from.element]);

  const toColor = useMemo(() => {
    const p = ELEMENT_PROPERTIES[to.element as ElementSymbol] ?? ELEMENT_PROPERTIES.C;
    return new THREE.Color(p.color);
  }, [to.element]);

  const blendedColor = useMemo(
    () => fromColor.clone().lerp(toColor, 0.5),
    [fromColor, toColor],
  );

  const baseOpacity = isDimmed ? 0.15 : BALL_STICK_OPACITY;

  useFrame(() => {
    const { stick, esps } = modeWeights.current;
    const visibility = stick * (1 - esps);

    if (groupRef.current) {
      groupRef.current.scale.set(visibility, visibility, visibility);
    }
    if (materialRef.current) {
      materialRef.current.opacity = THREE.MathUtils.lerp(
        materialRef.current.opacity,
        baseOpacity * visibility,
        0.18,
      );
      materialRef.current.depthWrite = visibility > 0.02;
    }
  });

  if (length < 1e-6) return null;

  return (
    <group
      ref={groupRef}
      position={[midpoint.x + offset.x, midpoint.y + offset.y, midpoint.z + offset.z]}
      quaternion={quaternion}
    >
      <mesh>
        <cylinderGeometry args={[BOND_RADIUS * scale, BOND_RADIUS * scale, length, 12, 1]} />
        <meshPhysicalMaterial
          ref={materialRef}
          color={blendedColor}
          emissive={blendedColor}
          emissiveIntensity={0.1}
          roughness={0.3}
          metalness={0.2}
          clearcoat={0.5}
          transparent
          opacity={baseOpacity}
        />
      </mesh>
    </group>
  );
}
