"use client";

import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AtomData, ElementSymbol, MoleculeData } from "@/lib/molecules/types";
import { ELEMENT_PROPERTIES } from "@/lib/molecules/elements";
import { ESPS_HULL_SCALE, getEspsHullColor } from "@/lib/molecules/electrostatic-charge";
import { useRenderModeWeights } from "@/lib/three/render-mode-blend";

interface EspsHullSphereProps {
  atom: AtomData;
  molecule: MoleculeData;
  scale?: number;
  hullSegments?: number;
}

const HULL_OPACITY = 0.4;

export function EspsHullSphere({
  atom,
  molecule,
  scale = 1,
  hullSegments = 40,
}: EspsHullSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const weights = useRenderModeWeights();

  const props = ELEMENT_PROPERTIES[atom.element as ElementSymbol] ?? ELEMENT_PROPERTIES.C;
  const hullRadius = props.vdwRadius * scale * ESPS_HULL_SCALE;

  const chargeColor = useMemo(
    () => getEspsHullColor(atom, molecule),
    [atom, molecule],
  );

  useFrame(() => {
    const esps = weights.current.esps;
    const visible = esps > 0.02;

    if (meshRef.current) {
      meshRef.current.visible = visible;
    }

    if (materialRef.current) {
      materialRef.current.opacity = THREE.MathUtils.lerp(
        materialRef.current.opacity,
        HULL_OPACITY * esps,
        0.16,
      );
      materialRef.current.emissiveIntensity = 0.15 + esps * 0.25;
    }
  });

  return (
    <mesh
      ref={meshRef}
      position={atom.position}
      renderOrder={5}
      raycast={() => null}
    >
      <sphereGeometry args={[hullRadius, hullSegments, hullSegments]} />
      <meshPhysicalMaterial
        ref={materialRef}
        color={chargeColor}
        emissive={chargeColor}
        emissiveIntensity={0.2}
        transparent
        opacity={0}
        transmission={0.9}
        thickness={0.65}
        ior={1.35}
        roughness={0.1}
        metalness={0}
        clearcoat={0.35}
        clearcoatRoughness={0.08}
        envMapIntensity={1.1}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        side={THREE.DoubleSide}
        toneMapped
      />
    </mesh>
  );
}
