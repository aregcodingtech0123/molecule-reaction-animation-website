import * as THREE from "three";

type Vec3Input = THREE.Vector3 | [number, number, number];

function toVector3(v: Vec3Input): THREE.Vector3 {
  return v instanceof THREE.Vector3 ? v.clone() : new THREE.Vector3(...v);
}

/**
 * Euclidean distance in Å between two scene-space atom centers.
 * Atom positions in data are stored in Å; the renderer applies a uniform `sceneScale`.
 */
export function distanceAngstrom(
  a: Vec3Input,
  b: Vec3Input,
  sceneScale = 1,
): number {
  const scale = sceneScale || 1;
  return toVector3(a).distanceTo(toVector3(b)) / scale;
}

export function formatDistanceAngstrom(distance: number, decimals = 2): string {
  return `${distance.toFixed(decimals)} Å`;
}

export function midpoint(
  a: [number, number, number],
  b: [number, number, number],
): [number, number, number] {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
}
