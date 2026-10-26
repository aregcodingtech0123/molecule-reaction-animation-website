"use client";

import { useRef, useMemo, useCallback, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { MoleculeData, AtomData } from "@/lib/molecules/types";
import { AtomSphere } from "./AtomSphere";
import { BondCylinder } from "./BondCylinder";
import { AtomLabel } from "./AtomLabel";
import { MeasurementOverlay } from "./MeasurementOverlay";
import { EspsHullSphere } from "./EspsHullSphere";
import { useMeasurement } from "@/context/MeasurementContext";
import { useFocus } from "@/context/FocusContext";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import { computeFocusCameraDistance } from "@/lib/molecules/atom-focus";

interface MoleculeRendererProps {
  molecule: MoleculeData;
  scale?: number;
  showLabels?: boolean;
  onAtomSelect?: (atom: AtomData | null) => void;
  selectedAtomId?: string | null;
  enableFloat?: boolean;
  accentColor?: string;
  sphereSegments?: number;
  atomHitScale?: number;
  espsEnabled?: boolean;
}

export function MoleculeRenderer({
  molecule,
  scale = 1,
  showLabels = true,
  onAtomSelect,
  selectedAtomId = null,
  enableFloat = true,
  accentColor = "#818cf8",
  sphereSegments = 48,
  atomHitScale = 1.15,
  espsEnabled = true,
}: MoleculeRendererProps) {
  const groupRef = useRef<THREE.Group>(null);
  const [hoveredAtom, setHoveredAtom] = useState<AtomData | null>(null);
  const { measurementMode, selectedAtomIds, selectMeasurementAtom, clearMeasurement } =
    useMeasurement();
  const { focusedAtom, setFocus, clearFocus, focusTargetRef } = useFocus();
  const reduceMotion = usePrefersReducedMotion();

  useEffect(() => {
    clearMeasurement();
    clearFocus();
  }, [molecule.id, clearMeasurement, clearFocus]);

  // Center the molecule at the origin
  const centeredAtoms = useMemo(() => {
    const center = new THREE.Vector3();
    molecule.atoms.forEach((a) => {
      center.add(new THREE.Vector3(...a.position));
    });
    center.divideScalar(molecule.atoms.length || 1);

    return molecule.atoms.map((a) => ({
      ...a,
      position: [
        (a.position[0] - center.x) * scale,
        (a.position[1] - center.y) * scale,
        (a.position[2] - center.z) * scale,
      ] as [number, number, number],
    }));
  }, [molecule.atoms, scale]);

  // Centered atom map for bond rendering
  const centeredAtomMap = useMemo(
    () => new Map(centeredAtoms.map((a) => [a.id, a])),
    [centeredAtoms]
  );

  // Gentle floating animation (not under reduced motion, R14) + keep focus target synced to moving atom
  useFrame((state) => {
    if (groupRef.current && enableFloat && !reduceMotion) {
      groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.6) * 0.15;
      groupRef.current.rotation.y += 0.001;
    }

    if (focusedAtom && groupRef.current) {
      const centered = centeredAtomMap.get(focusedAtom.id);
      if (centered) {
        const wp = new THREE.Vector3(...centered.position);
        groupRef.current.localToWorld(wp);
        focusTargetRef.current.copy(wp);
      }
    }
  });

  const handleAtomClick = useCallback(
    (atom: AtomData, worldPosition: THREE.Vector3) => {
      if (measurementMode) {
        selectMeasurementAtom(atom.id);
        return;
      }
      const cameraDistance = computeFocusCameraDistance(atom.element, scale);
      setFocus(atom, worldPosition, cameraDistance, molecule.id);
      onAtomSelect?.(atom);
    },
    [measurementMode, onAtomSelect, selectMeasurementAtom, setFocus, scale, molecule.id],
  );

  const handleAtomHover = useCallback((atom: AtomData | null) => {
    setHoveredAtom(atom);
  }, []);

  const measurePositions = useMemo(() => {
    if (selectedAtomIds.length !== 2) return null;
    const a = centeredAtoms.find((atom) => atom.id === selectedAtomIds[0]);
    const b = centeredAtoms.find((atom) => atom.id === selectedAtomIds[1]);
    if (!a || !b) return null;
    return { a: a.position, b: b.position };
  }, [centeredAtoms, selectedAtomIds]);

  const activeSelectionId = measurementMode ? null : selectedAtomId;
  const focusedAtomId = !measurementMode ? focusedAtom?.id ?? null : null;
  const measureSelectionSet = useMemo(
    () => new Set(selectedAtomIds),
    [selectedAtomIds],
  );
  const hasFocus = focusedAtomId !== null;

  return (
    <group ref={groupRef}>
      {/* Bonds (render first so atoms layer on top) */}
      {molecule.bonds.map((bond) => (
        <BondCylinder
          key={bond.id}
          bond={bond}
          atomMap={centeredAtomMap}
          scale={scale}
          isDimmed={
            !measurementMode &&
            (hasFocus
              ? focusedAtomId !== bond.from && focusedAtomId !== bond.to
              : activeSelectionId !== null &&
                bond.from !== activeSelectionId &&
                bond.to !== activeSelectionId)
          }
        />
      ))}

      {/* Atoms */}
      {centeredAtoms.map((atom) => (
        <AtomSphere
          key={atom.id}
          atom={atom}
          scale={scale}
          sphereSegments={sphereSegments}
          hitScale={atomHitScale}
          isHighlighted={hoveredAtom?.id === atom.id}
          isSelected={
            measurementMode
              ? measureSelectionSet.has(atom.id)
              : activeSelectionId === atom.id
          }
          isFocused={!measurementMode && focusedAtomId === atom.id}
          isDimmed={
            measurementMode
              ? false
              : hasFocus
                ? focusedAtomId !== atom.id
                : activeSelectionId !== null && activeSelectionId !== atom.id
          }
          onClick={handleAtomClick}
          onHover={handleAtomHover}
        />
      ))}

      {/* Labels */}
      {showLabels &&
        centeredAtoms.map((atom) => (
          <AtomLabel
            key={`label-${atom.id}`}
            atom={atom}
            visible={
              measureSelectionSet.has(atom.id) ||
              focusedAtomId === atom.id ||
              activeSelectionId === atom.id ||
              hoveredAtom?.id === atom.id
            }
            isSelected={
              measureSelectionSet.has(atom.id) ||
              focusedAtomId === atom.id ||
              activeSelectionId === atom.id
            }
          />
        ))}

      {measurePositions && (
        <MeasurementOverlay
          positionA={measurePositions.a}
          positionB={measurePositions.b}
          sceneScale={scale}
          accentColor={accentColor}
        />
      )}

      {espsEnabled &&
        centeredAtoms.map((atom) => (
          <EspsHullSphere
            key={`esps-${atom.id}`}
            atom={atom}
            molecule={molecule}
            scale={scale}
            hullSegments={sphereSegments}
          />
        ))}
    </group>
  );
}
