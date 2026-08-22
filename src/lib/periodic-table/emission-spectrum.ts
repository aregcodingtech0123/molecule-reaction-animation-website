export interface EmissionSpectrum {
  primary: string;
  secondary: string;
  glow: string;
  label: string;
}

/** Signature discharge / emission colors for gaseous elements. */
const EMISSION_SPECTRA: Partial<Record<number, EmissionSpectrum>> = {
  1: { primary: "#ff6b9d", secondary: "#ff3d7f", glow: "#ff6b9d88", label: "Pink-red (Hα)" },
  2: { primary: "#ffc4dd", secondary: "#ff9ec7", glow: "#ffc4dd88", label: "Pale peach" },
  7: { primary: "#b388ff", secondary: "#7c4dff", glow: "#b388ff77", label: "Violet" },
  8: { primary: "#64b5f6", secondary: "#42a5f5", glow: "#64b5f688", label: "Pale blue" },
  9: { primary: "#b2ff59", secondary: "#76ff03", glow: "#b2ff5977", label: "Yellow-green" },
  10: { primary: "#ff5722", secondary: "#ff7043", glow: "#ff572288", label: "Red-orange" },
  17: { primary: "#c6ff00", secondary: "#aeea00", glow: "#c6ff0077", label: "Yellow-green" },
  18: { primary: "#7e57c2", secondary: "#5e35b1", glow: "#7e57c288", label: "Blue-violet" },
  36: { primary: "#eceff1", secondary: "#b0bec5", glow: "#eceff188", label: "Whitish-lilac" },
  54: { primary: "#4fc3f7", secondary: "#29b6f6", glow: "#4fc3f788", label: "Sky blue" },
  86: { primary: "#a5d6a7", secondary: "#66bb6a", glow: "#a5d6a777", label: "Pale green" },
  118: { primary: "#e1bee7", secondary: "#ce93d8", glow: "#e1bee788", label: "Soft violet" },
};

const DEFAULT_GAS_SPECTRUM: EmissionSpectrum = {
  primary: "#2dd4bf",
  secondary: "#14b8a6",
  glow: "#2dd4bf77",
  label: "Teal emission",
};

export function getEmissionSpectrum(atomicNumber: number): EmissionSpectrum {
  return EMISSION_SPECTRA[atomicNumber] ?? DEFAULT_GAS_SPECTRUM;
}
