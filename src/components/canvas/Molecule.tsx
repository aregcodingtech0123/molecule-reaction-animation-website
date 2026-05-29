"use client";

import { useRef } from "react";
import { useFrame, type ThreeElements } from "@react-three/fiber";
import { Sphere, Line, MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";

// A simple water molecule for demo purposes
export function Molecule(props: ThreeElements["group"]) {
  const group = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (group.current) {
      group.current.rotation.y = state.clock.elapsedTime * 0.2;
      group.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.5) * 0.1;
      group.current.position.y = Math.sin(state.clock.elapsedTime) * 0.2;
    }
  });

  return (
    <group ref={group} {...props}>
      {/* Oxygen Atom */}
      <Sphere args={[1, 64, 64]} position={[0, 0, 0]}>
        <MeshDistortMaterial color="#ef4444" emissive="#7f1d1d" emissiveIntensity={0.5} clearcoat={1} roughness={0.1} distort={0.2} speed={2} />
      </Sphere>
      
      {/* Hydrogen Atom 1 */}
      <Sphere args={[0.5, 32, 32]} position={[1.2, -0.8, 0]}>
        <MeshDistortMaterial color="#e2e8f0" emissive="#94a3b8" emissiveIntensity={0.2} clearcoat={1} roughness={0.2} distort={0.1} speed={1.5} />
      </Sphere>

      {/* Hydrogen Atom 2 */}
      <Sphere args={[0.5, 32, 32]} position={[-1.2, -0.8, 0]}>
        <MeshDistortMaterial color="#e2e8f0" emissive="#94a3b8" emissiveIntensity={0.2} clearcoat={1} roughness={0.2} distort={0.1} speed={1.5} />
      </Sphere>

      {/* Bonds */}
      <Line
        points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(1.2, -0.8, 0)]}
        color="white"
        lineWidth={3}
        transparent
        opacity={0.3}
      />
      <Line
        points={[new THREE.Vector3(0, 0, 0), new THREE.Vector3(-1.2, -0.8, 0)]}
        color="white"
        lineWidth={3}
        transparent
        opacity={0.3}
      />
    </group>
  );
}
