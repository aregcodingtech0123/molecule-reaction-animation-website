import { NIST_GROUND_SHELLS } from "@/lib/periodic-table/nist-ground-shells";

/**
 * Electrons per principal shell (n = 1, 2, 3, ...) of the neutral ground-state atom, derived from the NIST
 * configurations in `nist-ground-shells.ts` (SEO-21). Replaces a fill-in-order estimate that was wrong from
 * potassium on (K came out 2,8,9; the measured configuration is 2,8,8,1) and for every exception (Cr, Cu, ...).
 *
 * Returns null where NIST has no entry (Z = 109-118): those configurations are predicted, not measured, so the
 * site shows no shells for them rather than a guess.
 */
/** Bracketed cores in the NIST strings: the noble gases, plus [Cd] (Z=48) and [Hg] (Z=80) for p-block rows 5 and 6. */
const CORES: Readonly<Record<string, number>> = { He: 2, Ne: 10, Ar: 18, Kr: 36, Cd: 48, Xe: 54, Hg: 80, Rn: 86 };

/** Occupation of each subshell ("1s" -> 2, "4f" -> 14) for a NIST "Ground Shells" string such as "[Ar].3d5.4s". */
function subshellOccupancy(notation: string): Map<string, number> {
  const occupancy = new Map<string, number>();
  for (const token of notation.split(".")) {
    const core = token.match(/^\[([A-Za-z]+)\]$/);
    if (core) {
      const coreZ = CORES[core[1]];
      if (!coreZ) throw new Error(`Unknown core ${token}`);
      for (const [subshell, count] of subshellOccupancy(NIST_GROUND_SHELLS[coreZ])) {
        occupancy.set(subshell, (occupancy.get(subshell) ?? 0) + count);
      }
      continue;
    }
    const m = token.match(/^(\d+[spdfg])(\d*)$/);
    if (!m) throw new Error(`Unreadable subshell ${JSON.stringify(token)} in ${notation}`);
    occupancy.set(m[1], (occupancy.get(m[1]) ?? 0) + (m[2] ? Number(m[2]) : 1));
  }
  return occupancy;
}

export function electronShells(atomicNumber: number): number[] | null {
  const notation = NIST_GROUND_SHELLS[atomicNumber];
  if (!notation) return null;
  const shells: number[] = [];
  for (const [subshell, count] of subshellOccupancy(notation)) {
    const n = Number.parseInt(subshell, 10);
    shells[n - 1] = (shells[n - 1] ?? 0) + count;
  }
  return Array.from(shells, (count) => count ?? 0);
}
