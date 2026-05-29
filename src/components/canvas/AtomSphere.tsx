"use client";

import { useRef, useState, useMemo } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import type { AtomData, ElementSymbol } from "@/lib/molecules/types";
import { ELEMENT_PROPERTIES } from "@/lib/molecules/elements";
import { useRenderModeWeights } from "@/lib/three/render-mode-blend";
import { useTheme } from "@/context/ThemeContext";
import { useMeasurement } from "@/context/MeasurementContext";

interface AtomSphereProps {
  atom: AtomData;
  scale?: number;
  sphereSegments?: number;
  hitScale?: number;
  isHighlighted?: boolean;
  isSelected?: boolean;
  isFocused?: boolean;
  isDimmed?: boolean;
  onClick?: (atom: AtomData, worldPosition: THREE.Vector3) => void;
  onHover?: (atom: AtomData | null) => void;
}

function colorLuminance(hex: string): number {
  const c = new THREE.Color(hex);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return hsl.l;
}

export function AtomSphere({
  atom,
  scale = 1,
  sphereSegments = 48,
  hitScale = 1.15,
  isHighlighted = false,
  isSelected = false,
  isFocused = false,
  isDimmed = false,
  onClick,
  onHover,
}: AtomSphereProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const hitRef = useRef<THREE.Mesh>(null);
  const outlineRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null);
  const [hovered, setHovered] = useState(false);
  const modeWeights = useRenderModeWeights();
  const { scene, isWhiteLab } = useTheme();
  const { measurementMode } = useMeasurement();

  const props = ELEMENT_PROPERTIES[atom.element as ElementSymbol] ?? ELEMENT_PROPERTIES.C;
  const ballRadius = props.radius * scale;
  const pickRadius = ballRadius * hitScale;
  const segmentLow = Math.max(12, Math.floor(sphereSegments / 2));
  const vdwRadius = props.vdwRadius * scale;
  const vdwScaleFactor = ballRadius > 0 ? vdwRadius / ballRadius : 1;

  const needsOutline =
    isWhiteLab && colorLuminance(props.color) >= scene.lightAtomLuminanceThreshold;

  const color = useMemo(() => new THREE.Color(props.color), [props.color]);
  const emissiveColor = useMemo(() => new THREE.Color(props.emissive), [props.emissive]);
  const outlineColor = useMemo(
    () => new THREE.Color(scene.atomOutlineColor),
    [scene.atomOutlineColor],
  );

  useFrame(() => {
    const { spaceFill, esps } = modeWeights.current;
    const opaqueWeight = Math.max(0, 1 - esps);
    const radiusScale = THREE.MathUtils.lerp(1, vdwScaleFactor, spaceFill);
    const active = isFocused || isSelected;
    const hoverScale = active || hovered ? 1.12 : 1;
    const totalScale = radiusScale * hoverScale;

    if (meshRef.current) {
      meshRef.current.scale.setScalar(totalScale);
    }
    if (outlineRef.current) {
      outlineRef.current.scale.setScalar(totalScale * scene.atomOutlineScale);
      outlineRef.current.visible = esps < 0.5;
    }
    if (glowRef.current) {
      const glowScale = radiusScale * (active ? 1.9 : hovered ? 1.5 : 1);
      glowRef.current.scale.setScalar(glowScale);
      const mat = glowRef.current.material as THREE.MeshBasicMaterial;
      const targetGlowOpacity = isFocused ? 0.45 : isSelected ? 0.35 : hovered ? 0.2 : 0;
      mat.opacity = THREE.MathUtils.lerp(
        mat.opacity,
        targetGlowOpacity * opaqueWeight * (1 - spaceFill * 0.6),
        0.12,
      );
    }
    if (materialRef.current) {
      const baseOpacity = isDimmed ? 0.25 : 1;
      materialRef.current.opacity = THREE.MathUtils.lerp(
        materialRef.current.opacity,
        baseOpacity * opaqueWeight,
        0.14,
      );
      materialRef.current.depthWrite = materialRef.current.opacity > 0.08;
    }
  });

  const roughness = isWhiteLab ? 0.28 : modeWeights.current.spaceFill > 0.5 ? 0.35 : 0.15;
  const metalness = isWhiteLab ? 0.18 : 0.1;
  const envIntensity = isWhiteLab ? 1.35 : 1.2;

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    onHover?.(atom);
    document.body.style.cursor = measurementMode ? "crosshair" : "pointer";
  };

  const handlePointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(false);
    onHover?.(null);
    document.body.style.cursor = "auto";
  };

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const worldPos = new THREE.Vector3();
    hitRef.current?.getWorldPosition(worldPos);
    onClick?.(atom, worldPos);
  };

  return (
    <group position={atom.position}>
      {needsOutline && (
        <mesh ref={outlineRef} renderOrder={0} raycast={() => null}>
          <sphereGeometry args={[ballRadius, sphereSegments, sphereSegments]} />
          <meshBasicMaterial color={outlineColor} />
        </mesh>
      )}

      <mesh ref={glowRef} renderOrder={1} raycast={() => null}>
        <sphereGeometry args={[ballRadius * 1.6, segmentLow, segmentLow]} />
        <meshBasicMaterial
          color={props.emissive}
          transparent
          opacity={0}
          depthWrite={false}
        />
      </mesh>

      {/* Invisible enlarged proxy — fat-finger / touch picking */}
      <mesh
        ref={hitRef}
        renderOrder={3}
        visible={false}
        onPointerOver={handlePointerOver}
        onPointerOut={handlePointerOut}
        onClick={handleClick}
      >
        <sphereGeometry args={[pickRadius, segmentLow, segmentLow]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>

      <mesh ref={meshRef} renderOrder={2} raycast={() => null}>
        <sphereGeometry args={[ballRadius, sphereSegments, sphereSegments]} />
        <meshPhysicalMaterial
          ref={materialRef}
          color={color}
          emissive={emissiveColor}
          emissiveIntensity={
            isFocused ? 0.5 : isSelected ? 0.8 : isHighlighted ? 0.5 : isWhiteLab ? 0.05 : 0.15
          }
          roughness={roughness}
          metalness={metalness}
          clearcoat={isWhiteLab ? 0.85 : 1}
          clearcoatRoughness={isWhiteLab ? 0.15 : 0.1}
          envMapIntensity={envIntensity}
          transparent
          opacity={1}
        />
      </mesh>
    </group>
  );
}
