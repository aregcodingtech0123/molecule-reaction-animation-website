"use client";

import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useTheme } from "@/context/ThemeContext";

/**
 * Theme-aware lighting rig — low-light observatory (night-lab) vs bright lab (white-lab).
 */
export function SceneLighting() {
  const { scene } = useTheme();
  const accentRef = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    if (accentRef.current) {
      const t = state.clock.elapsedTime * 0.3;
      accentRef.current.position.x = Math.sin(t) * 6;
      accentRef.current.position.z = Math.cos(t) * 6;
      accentRef.current.position.y = 2 + Math.sin(t * 2) * 1;
    }
  });

  return (
    <>
      <ambientLight intensity={scene.ambient.intensity} color={scene.ambient.color} />

      <directionalLight
        position={[5, 10, 6]}
        intensity={scene.keyLight.intensity}
        color={scene.keyLight.color}
        castShadow={scene.keyLight.castShadow}
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={50}
        shadow-camera-left={-12}
        shadow-camera-right={12}
        shadow-camera-top={12}
        shadow-camera-bottom={-12}
      />

      <directionalLight
        position={[-7, 4, -3]}
        intensity={scene.fillLight.intensity}
        color={scene.fillLight.color}
      />

      <directionalLight
        position={[0, 2, -8]}
        intensity={scene.fillLight.intensity * 0.55}
        color="#ffffff"
      />

      <pointLight
        position={[0, -4, -6]}
        intensity={scene.rimLight.intensity}
        color={scene.rimLight.color}
        distance={22}
        decay={2}
      />

      <pointLight
        ref={accentRef}
        intensity={scene.accentOrbit.intensity}
        color={scene.accentOrbit.color}
        distance={18}
        decay={2}
      />

      <spotLight
        position={[0, 14, 2]}
        angle={0.45}
        penumbra={0.85}
        intensity={scene.spotLight.intensity}
        color={scene.spotLight.color}
        castShadow={false}
      />
    </>
  );
}
