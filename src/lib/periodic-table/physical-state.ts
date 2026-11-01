/** Elements that are gaseous at standard temperature and pressure (STP). */
const GASEOUS_AT_STP = new Set([
  1, 2, 7, 8, 9, 10, 17, 18, 36, 54, 86, 118,
]);

/** Elements liquid at STP. */
const LIQUID_AT_STP = new Set([35, 80]);

export type PhysicalState = "gas" | "liquid" | "solid";

export function getPhysicalState(atomicNumber: number): PhysicalState {
  if (GASEOUS_AT_STP.has(atomicNumber)) return "gas";
  if (LIQUID_AT_STP.has(atomicNumber)) return "liquid";
  return "solid";
}

export function isGaseousAtSTP(atomicNumber: number): boolean {
  return getPhysicalState(atomicNumber) === "gas";
}
