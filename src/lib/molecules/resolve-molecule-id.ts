import { ALL_MOLECULES } from "./data";

/**
 * Resolve a deep-link query value to a known molecule id.
 * Accepts ids like `caffeine` (case-insensitive) or display names.
 */
export function resolveMoleculeIdFromQuery(
  param: string | null | undefined,
): string | null {
  if (!param?.trim()) return null;

  const normalized = param.trim().toLowerCase();

  const byId = ALL_MOLECULES.find((m) => m.id.toLowerCase() === normalized);
  if (byId) return byId.id;

  const byName = ALL_MOLECULES.find((m) => m.name.toLowerCase() === normalized);
  if (byName) return byName.id;

  return null;
}

export function getDefaultMoleculeId(): string {
  return ALL_MOLECULES[0]?.id ?? "water";
}
