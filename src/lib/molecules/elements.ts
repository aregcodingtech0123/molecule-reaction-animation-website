import type { ElementMap } from "./types";

/** Van der Waals radii (Å) — Bondi convention, scaled 1:1 with molecule coordinates */
const VDW: Record<keyof ElementMap, number> = {
  H: 1.2,
  C: 1.7,
  N: 1.55,
  O: 1.52,
  S: 1.8,
  P: 1.8,
  F: 1.47,
  Cl: 1.75,
  Br: 1.85,
  I: 1.98,
  Fe: 2.05,
  Ca: 2.31,
  Na: 2.27,
  K: 2.75,
  Mg: 1.73,
  Zn: 1.39,
};

export const ELEMENT_PROPERTIES: ElementMap = {
  H:  { color: "#e8e8e8", emissive: "#a0a0ff", radius: 0.25, vdwRadius: VDW.H,  name: "Hydrogen",    atomicNumber: 1  },
  C:  { color: "#2d2d2d", emissive: "#4a6fff", radius: 0.42, vdwRadius: VDW.C,  name: "Carbon",      atomicNumber: 6  },
  N:  { color: "#3b49df", emissive: "#6e7bff", radius: 0.40, vdwRadius: VDW.N,  name: "Nitrogen",    atomicNumber: 7  },
  O:  { color: "#e63946", emissive: "#ff6b7a", radius: 0.45, vdwRadius: VDW.O,  name: "Oxygen",      atomicNumber: 8  },
  S:  { color: "#f4d35e", emissive: "#ffeaa7", radius: 0.50, vdwRadius: VDW.S,  name: "Sulfur",      atomicNumber: 16 },
  P:  { color: "#ff8c42", emissive: "#ffb380", radius: 0.50, vdwRadius: VDW.P,  name: "Phosphorus",  atomicNumber: 15 },
  F:  { color: "#81ecec", emissive: "#a8f0f0", radius: 0.38, vdwRadius: VDW.F,  name: "Fluorine",    atomicNumber: 9  },
  Cl: { color: "#00b894", emissive: "#55efc4", radius: 0.48, vdwRadius: VDW.Cl, name: "Chlorine",    atomicNumber: 17 },
  Br: { color: "#a0522d", emissive: "#cd8555", radius: 0.52, vdwRadius: VDW.Br, name: "Bromine",     atomicNumber: 35 },
  I:  { color: "#6c3483", emissive: "#9b59b6", radius: 0.58, vdwRadius: VDW.I,  name: "Iodine",      atomicNumber: 53 },
  Fe: { color: "#d68910", emissive: "#f0b840", radius: 0.55, vdwRadius: VDW.Fe, name: "Iron",        atomicNumber: 26 },
  Ca: { color: "#aab7b8", emissive: "#d0d8d8", radius: 0.60, vdwRadius: VDW.Ca, name: "Calcium",     atomicNumber: 20 },
  Na: { color: "#a569bd", emissive: "#c39bd3", radius: 0.58, vdwRadius: VDW.Na, name: "Sodium",      atomicNumber: 11 },
  K:  { color: "#7d3c98", emissive: "#a569bd", radius: 0.65, vdwRadius: VDW.K,  name: "Potassium",   atomicNumber: 19 },
  Mg: { color: "#1abc9c", emissive: "#48c9b0", radius: 0.52, vdwRadius: VDW.Mg, name: "Magnesium",   atomicNumber: 12 },
  Zn: { color: "#5dade2", emissive: "#85c1e9", radius: 0.48, vdwRadius: VDW.Zn, name: "Zinc",        atomicNumber: 30 },
};
