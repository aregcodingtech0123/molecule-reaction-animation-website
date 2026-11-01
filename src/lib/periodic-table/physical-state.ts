/**
 * The phase the element panel illustrates (SEO-19, owner decision after Part 2).
 *
 * - "gas": gaseous at standard temperature and pressure (H, He, N, O, F, Ne, Cl, Ar, Kr, Xe, Rn). Oganesson is NOT in this
 *   list any more: it was drawn as a gas, but no bulk oganesson has ever existed and relativistic calculations predict a
 *   solid; PubChem's own table only says "Expected to be a Gas" for it (and "Expected to be a Solid" for Ds-Ts).
 * - "unknown": no sample large enough to observe a state has been made - drawn as "State unknown / not produced in bulk",
 *   never as "Crystalline solid". The set is astatine, francium and every element from fermium (Z = 100) up. **No source
 *   could be read for this cutoff** (the RSC pages returned 403); it follows the site's own descriptions ("exists only in
 *   trace amounts", "too unstable for macroscopic applications") and is listed in docs/seo/DATA_REVIEW.md for the owner to
 *   confirm. Change the two constants below to move it.
 */
const GASEOUS_AT_STP = new Set([1, 2, 7, 8, 9, 10, 17, 18, 36, 54, 86]);

/** Elements liquid at STP. */
const LIQUID_AT_STP = new Set([35, 80]);

/** First atomic number from which no bulk sample exists; astatine and francium are listed separately. */
export const FIRST_ELEMENT_NEVER_MADE_IN_BULK = 100;
const TRACE_ONLY = new Set([85, 87]);

export type PhysicalState = "gas" | "liquid" | "solid" | "unknown";

export function getPhysicalState(atomicNumber: number): PhysicalState {
  if (atomicNumber >= FIRST_ELEMENT_NEVER_MADE_IN_BULK || TRACE_ONLY.has(atomicNumber)) return "unknown";
  if (GASEOUS_AT_STP.has(atomicNumber)) return "gas";
  if (LIQUID_AT_STP.has(atomicNumber)) return "liquid";
  return "solid";
}

export function isGaseousAtSTP(atomicNumber: number): boolean {
  return getPhysicalState(atomicNumber) === "gas";
}
