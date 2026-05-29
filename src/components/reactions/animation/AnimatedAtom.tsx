"use client";

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ElementSymbol } from "@/lib/molecules/types";
import { ELEMENT_PROPERTIES } from "@/lib/molecules/elements";

interface AnimatedAtomProps {
  id: string;
  element: ElementSymbol;
  positionsRef: React.RefObject<Map<string, THREE.Vector3>>;
  scale?: number;
}

export function AnimatedAtom({ id, element, positionsRef, scale = 1 }: AnimatedAtomProps) {
  const groupRef = useRef<THREE.Group>(null);
  const props = ELEMENT_PROPERTIES[element] ?? ELEMENT_PROPERTIES.C;
  const radius = props.radius * scale;
  const color = useMemo(() => new THREE.Color(props.color), [props.color]);
  const emissive = useMemo(() => new THREE.Color(props.emissive), [props.emissive]);

  useFrame(() => {
    const pos = positionsRef.current?.get(id);
    if (pos && groupRef.current) {
      groupRef.current.position.copy(pos);
    }
  });

  return (
    <group ref={groupRef}>
      <mesh>
        <sphereGeometry args={[radius, 40, 40]} />
        <meshPhysicalMaterial
          color={color}
          emissive={emissive}
          emissiveIntensity={0.2}
          roughness={0.15}
          metalness={0.1}
          clearcoat={1}
          clearcoatRoughness={0.1}
        />
      </mesh>
    </group>
  );
}
