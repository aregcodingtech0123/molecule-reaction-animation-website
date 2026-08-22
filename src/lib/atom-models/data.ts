import type { AtomModelId, AtomModelMeta } from "./types";

export const ATOM_MODEL_META: Record<AtomModelId, AtomModelMeta> = {
  dalton: { id: "dalton", accentColor: "#64748b", order: 1 },
  thomson: { id: "thomson", accentColor: "#f97316", order: 2 },
  rutherford: { id: "rutherford", accentColor: "#eab308", order: 3 },
  bohr: { id: "bohr", accentColor: "#3b82f6", order: 4 },
  quantum: { id: "quantum", accentColor: "#a855f7", order: 5 },
};

export const DEFAULT_ATOM_MODEL_ID: AtomModelId = "dalton";
