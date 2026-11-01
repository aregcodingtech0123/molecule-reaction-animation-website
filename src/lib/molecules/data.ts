import type { MoleculeData } from "./types";
import { MULTIDISCIPLINARY_MOLECULES } from "./recent-molecules";
import {
  CAFFEINE_ATOMS,
  CAFFEINE_BONDS,
  DNA_FRAGMENT_ATOMS,
  DNA_FRAGMENT_BONDS,
  GLUCOSE_ATOMS,
  GLUCOSE_BONDS,
  PROTEIN_FRAGMENT_ATOMS,
  PROTEIN_FRAGMENT_BONDS,
} from "./structures";

export { RECENT_MOLECULE_IDS } from "./recent-molecules";

export const WATER: MoleculeData = {
  id: "water",
  name: "Water",
  formula: "H₂O",
  description: "The universal solvent essential for all known forms of life.",
  category: "simple",
  atoms: [
    { id: "O1", element: "O", position: [0, 0, 0] },
    { id: "H1", element: "H", position: [0.96, 0, 0] },
    { id: "H2", element: "H", position: [-0.24, 0.93, 0] },
  ],
  bonds: [
    { id: "b1", from: "O1", to: "H1", order: 1 },
    { id: "b2", from: "O1", to: "H2", order: 1 },
  ],
  education: {
    molecularWeight: "18.015 g/mol",
    boilingPoint: "100°C (212°F)",
    meltingPoint: "0°C (32°F)",
    state: "liquid",
    bondTypes: ["Polar Covalent", "Hydrogen Bond"],
    uses: [
      "Universal biological solvent",
      "Industrial cooling systems",
      "Hydroelectric power generation",
      "Chemical reaction medium",
    ],
    funFacts: [
      "Liquid water is densest at about 4 °C: water at 4 °C is denser than water at 0 °C.",
    ],
    color: "#3b82f6",
  },
};

export const METHANE: MoleculeData = {
  id: "methane",
  name: "Methane",
  formula: "CH₄",
  description: "The simplest hydrocarbon and a potent greenhouse gas.",
  category: "organic",
  atoms: [
    { id: "C1", element: "C", position: [0, 0, 0] },
    { id: "H1", element: "H", position: [1.09, 0, 0] },
    { id: "H2", element: "H", position: [-0.36, 1.03, 0] },
    { id: "H3", element: "H", position: [-0.36, -0.51, 0.89] },
    { id: "H4", element: "H", position: [-0.36, -0.51, -0.89] },
  ],
  bonds: [
    { id: "b1", from: "C1", to: "H1", order: 1 },
    { id: "b2", from: "C1", to: "H2", order: 1 },
    { id: "b3", from: "C1", to: "H3", order: 1 },
    { id: "b4", from: "C1", to: "H4", order: 1 },
  ],
  education: {
    molecularWeight: "16.043 g/mol",
    boilingPoint: "-161.5°C",
    meltingPoint: "-182.5°C",
    state: "gas",
    bondTypes: ["Non-polar Covalent", "Tetrahedral"],
    uses: [
      "Natural gas fuel for heating and cooking",
      "Electricity generation in power plants",
      "Production of hydrogen gas",
      "Feedstock for chemical synthesis",
    ],
    funFacts: [
      "Methane is about 81–83 times more potent than CO₂ as a greenhouse gas over a 20-year period (EPA, citing IPCC AR6).",
      "Cattle and other livestock produce methane as part of their normal digestion; microbes also make it where organic matter decays without oxygen, as in wetlands (EPA).",
    ],
    color: "#f97316",
  },
};

export const GLUCOSE: MoleculeData = {
  id: "glucose",
  name: "Glucose",
  formula: "C₆H₁₂O₆",
  description: "Primary energy source for cells and a fundamental sugar in biology.",
  category: "organic",
  atoms: GLUCOSE_ATOMS,
  bonds: GLUCOSE_BONDS,
  education: {
    molecularWeight: "180.156 g/mol",
    state: "solid",
    meltingPoint: "146°C",
    bondTypes: ["Covalent", "Polar C–O bonds", "Ring Structure"],
    uses: [
      "Primary cellular energy source via glycolysis",
      "IV glucose drips in medical care",
      "Sports and energy drinks",
      "Fermentation to produce ethanol and CO₂",
    ],
    funFacts: [
      "Glucose exists in two forms: α-glucose and β-glucose, which differ only in the orientation of one hydroxyl group.",
      "A single gram of glucose releases approximately 4 Calories when metabolized.",
    ],
    color: "#22c55e",
  },
};

export const CAFFEINE: MoleculeData = {
  id: "caffeine",
  name: "Caffeine",
  formula: "C₈H₁₀N₄O₂",
  description: "A central nervous system stimulant found in coffee and tea.",
  category: "organic",
  atoms: CAFFEINE_ATOMS,
  bonds: CAFFEINE_BONDS,
  education: {
    molecularWeight: "194.19 g/mol",
    state: "solid",
    meltingPoint: "235–238°C",
    boilingPoint: "178°C (sublimes)",
    bondTypes: ["Aromatic Ring", "Amide C=O", "N-methylation"],
    uses: [
      "Stimulant in coffee, tea, and energy drinks",
      "Pain relief medication (combined with aspirin)",
      "Treatment of apnea in premature infants",
      "Performance enhancer in endurance sports",
    ],
    funFacts: [
      "Caffeine blocks adenosine receptors in the brain, preventing the feeling of tiredness.",
      "Caffeine is the world's most widely consumed psychoactive substance.",
    ],
    color: "#a855f7",
  },
};

export const DNA_FRAGMENT: MoleculeData = {
  id: "dna-fragment",
  name: "DNA Base Pair",
  formula: "Adenine–Thymine",
  description: "A hydrogen-bonded base pair forming the rungs of the DNA double helix.",
  category: "biological",
  atoms: DNA_FRAGMENT_ATOMS,
  bonds: DNA_FRAGMENT_BONDS,
  education: {
    molecularWeight: "261.24 g/mol (adenine + thymine, free bases)",
    state: "solid",
    bondTypes: ["Aromatic", "Hydrogen Bond (×2 A–T)"],
    uses: [
      "Genetic information storage in all living organisms",
      "Template for mRNA transcription",
      "DNA fingerprinting in forensic science",
    ],
    funFacts: [
      "Adenine always pairs with Thymine via 2 hydrogen bonds — this is Watson-Crick base pairing.",
      "The human genome contains approximately 3 billion base pairs.",
    ],
    color: "#06b6d4",
  },
};

export const PROTEIN_FRAGMENT: MoleculeData = {
  id: "protein-fragment",
  name: "Peptide Bond",
  formula: "Gly-Ala",
  description: "A dipeptide fragment showing the fundamental peptide bond linkage.",
  category: "biological",
  atoms: PROTEIN_FRAGMENT_ATOMS,
  bonds: PROTEIN_FRAGMENT_BONDS,
  education: {
    molecularWeight: "146.14 g/mol",
    state: "solid",
    bondTypes: ["Peptide Bond (C–N)", "Amide Resonance", "α-Carbon Bonds"],
    uses: [
      "Fundamental unit of all protein structures",
      "Cell signaling via peptide hormones",
      "Food flavoring agents (e.g., aspartame is a dipeptide)",
    ],
    funFacts: [
      "The peptide bond has partial double-bond character due to resonance — it's planar and doesn't freely rotate.",
      "The human genome has about 20,000 protein-coding genes (19,878 in Ensembl release 116, June 2026).",
    ],
    color: "#f59e0b",
  },
};

/** All available molecules for the application */
export const ALL_MOLECULES: MoleculeData[] = [
  WATER,
  METHANE,
  GLUCOSE,
  CAFFEINE,
  DNA_FRAGMENT,
  PROTEIN_FRAGMENT,
  ...MULTIDISCIPLINARY_MOLECULES,
];

/** Quick lookup by id */
export const MOLECULE_MAP: Record<string, MoleculeData> = Object.fromEntries(
  ALL_MOLECULES.map((m) => [m.id, m])
);
