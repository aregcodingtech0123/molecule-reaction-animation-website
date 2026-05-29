import type { ReactionData } from "./types";

function withFacts<T extends Omit<ReactionData, "facts">>(entry: T): ReactionData {
  return { ...entry, facts: entry.quickFacts };
}

const PLACEHOLDER_STEP = (moleculeId: string, caption: string) => ({
  moleculeId,
  caption,
});

export const HABER_BOSCH: ReactionData = withFacts({
  id: "haber-bosch",
  name: "Haber-Bosch Process",
  formula: "N₂ + 3H₂ → 2NH₃",
  equation: "N₂ + 3H₂ → 2NH₃",
  category: "SYNTHESIS",
  difficulty: "INTERMEDIATE",
  reactants: [
    { name: "Nitrogen", formula: "N₂", count: 1 },
    { name: "Hydrogen", formula: "H₂", count: 3 },
  ],
  products: [{ name: "Ammonia", formula: "NH₃", count: 2 }],
  description:
    "Industrial nitrogen fixation: atmospheric N₂ and H₂ are converted to ammonia—the backbone of global fertilizer production.",
  accentColor: "#10b981",
  reactionType: "Industrial synthesis",
  steps: [
    PLACEHOLDER_STEP("methane", "Placeholder scene — NH₃ animation coordinates pending"),
  ],
  quickFacts: {
    summary:
      "The industrial implementation of nitrogen fixation, transforming atmospheric nitrogen into ammonia to produce fertilizers that sustain global food production.",
    energyProfile: "Exothermic (ΔH = −92.4 kJ/mol).",
    conditions: "High pressure (150–250 bar), high temperature (400–500°C), and an iron (Fe) catalyst.",
    mechanism:
      "Dissociative adsorption of N₂ and H₂ gases on the iron catalyst surface, followed by stepwise hydrogenation of nitrogen atoms.",
  },
  animationMetadata: {
    status: "ready",
    animationKey: "haber-bosch",
    notes:
      "Author 8 atoms: 2×N (N₂), 6×H (3×H₂) → 2×N + 6×H in 2 NH₃. Layout: N₂ center-left, three H₂ on right; products two NH₃ pyramidal clusters.",
    atomInventory: {
      reactants: { N: 2, H: 6 },
      products: { N: 2, H: 6 },
    },
  },
});

export const PHOTOSYNTHESIS: ReactionData = withFacts({
  id: "photosynthesis",
  name: "Photosynthesis (Simplified)",
  formula: "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂",
  equation: "6CO₂ + 6H₂O → C₆H₁₂O₆ + 6O₂",
  category: "METABOLIC",
  difficulty: "EXPERT",
  reactants: [
    { name: "Carbon dioxide", formula: "CO₂", count: 6 },
    { name: "Water", formula: "H₂O", count: 6 },
  ],
  products: [
    { name: "Glucose", formula: "C₆H₁₂O₆", count: 1 },
    { name: "Oxygen", formula: "O₂", count: 6 },
  ],
  description:
    "Light-driven carbon fixation: six CO₂ and six water molecules are built into one glucose ring while releasing oxygen—the metabolic engine of the biosphere.",
  accentColor: "#22c55e",
  reactionType: "Metabolic / light-driven",
  steps: [
    PLACEHOLDER_STEP("glucose", "Product — glucose (C₆H₁₂O₆)"),
    PLACEHOLDER_STEP("water", "Reactant / product — water"),
  ],
  quickFacts: {
    summary:
      "The foundational biochemical process by which plants, algae, and some bacteria convert light energy into chemical energy (glucose), releasing oxygen as a byproduct.",
    energyProfile:
      "Endothermic / Endergonic (requires photon energy, ΔH = +2803 kJ/mol for the overall simplified equation).",
    conditions: "Sunlight (photons), chlorophyll pigments, ambient temperatures.",
    mechanism:
      "Light-dependent reactions split water to generate ATP and NADPH, followed by the light-independent Calvin Cycle fixing CO₂ into a 6-carbon sugar.",
  },
  animationMetadata: {
    status: "ready",
    animationKey: "photosynthesis",
    notes:
      "Author 48 atoms: 6C+12O+12H → 6C+12H+12O. Simplified clip: clustered CO₂ + H₂O reactants → glucose ring + dispersed O₂ products.",
    atomInventory: {
      reactants: { C: 6, O: 18, H: 12 },
      products: { C: 6, O: 18, H: 12 },
    },
  },
});

export const NEUTRALIZATION_HCL_NAOH: ReactionData = withFacts({
  id: "neutralization-hcl-naoh",
  name: "Neutralization (HCl + NaOH)",
  formula: "HCl + NaOH → NaCl + H₂O",
  equation: "HCl + NaOH → NaCl + H₂O",
  category: "ACID-BASE",
  difficulty: "BEGINNER",
  reactants: [
    { name: "Hydrochloric acid", formula: "HCl", count: 1 },
    { name: "Sodium hydroxide", formula: "NaOH", count: 1 },
  ],
  products: [
    { name: "Sodium chloride", formula: "NaCl", count: 1 },
    { name: "Water", formula: "H₂O", count: 1 },
  ],
  description:
    "A textbook Arrhenius neutralization: strong acid and strong base form a salt and water—the proton-transfer reaction every intro chemistry student meets first.",
  accentColor: "#38bdf8",
  reactionType: "Acid–base",
  steps: [PLACEHOLDER_STEP("water", "Product — water (H₂O)")],
  quickFacts: {
    summary:
      "A classic Arrhenius acid-base reaction where a strong acid and a strong base neutralize each other to produce a salt (sodium chloride) and water.",
    energyProfile: "Exothermic (heat of neutralization, ΔH ≈ −57.3 kJ/mol).",
    conditions: "Aqueous solution, room temperature.",
    mechanism:
      "Proton transfer where H⁺ ions from the acid combine with OH⁻ ions from the base to form stable covalent H₂O molecules, while Na⁺ and Cl⁻ remain as spectator ions or form a crystalline lattice upon evaporation.",
  },
  animationMetadata: {
    status: "ready",
    animationKey: "neutralization-hcl-naoh",
    notes:
      "Author 5 atoms: H, Cl, Na, O (×2 in NaOH) → H, O (water), Na, Cl. Ionic→molecular H₂O formation; bent water product geometry.",
    atomInventory: {
      reactants: { H: 2, Cl: 1, Na: 1, O: 1 },
      products: { H: 2, O: 1, Na: 1, Cl: 1 },
    },
  },
});

export const ESTERIFICATION_ETHYL_ACETATE: ReactionData = withFacts({
  id: "esterification-ethyl-acetate",
  name: "Esterification (Ethyl Acetate)",
  formula: "CH₃COOH + C₂H₅OH → CH₃COOC₂H₅ + H₂O",
  equation: "CH₃COOH + C₂H₅OH → CH₃COOC₂H₅ + H₂O",
  category: "ORGANIC",
  difficulty: "EXPERT",
  reactants: [
    { name: "Acetic acid", formula: "CH₃COOH", count: 1 },
    { name: "Ethanol", formula: "C₂H₅OH", count: 1 },
  ],
  products: [
    { name: "Ethyl acetate", formula: "CH₃COOC₂H₅", count: 1 },
    { name: "Water", formula: "H₂O", count: 1 },
  ],
  description:
    "Fischer esterification: carboxylic acid and alcohol condense into a fruity ester plus water—equilibrium chemistry with a touch of sulfuric acid and heat.",
  accentColor: "#f472b6",
  reactionType: "Condensation / organic",
  steps: [
    PLACEHOLDER_STEP("ethanol", "Reactant — ethanol"),
    PLACEHOLDER_STEP("water", "Coproduct — water"),
  ],
  quickFacts: {
    summary:
      "A condensation reaction between an organic acid (acetic acid) and an alcohol (ethanol) to produce an ester (ethyl acetate, known for its sweet, fruity odor) and water.",
    energyProfile: "Slightly exothermic, reversible equilibrium reaction.",
    conditions: "Acid catalyst (typically concentrated H₂SO₄) and heat under reflux.",
    mechanism:
      "Nucleophilic acyl substitution. The carbonyl oxygen of the carboxylic acid is protonated, followed by a nucleophilic attack by the alcohol's hydroxyl group, culminating in the elimination of a water molecule.",
  },
  animationMetadata: {
    status: "ready",
    animationKey: "esterification-ethyl-acetate",
    notes:
      "Author 18 atoms: C₄H₈O₃ (acid + alcohol) → C₄H₈O₃ (ester + water). Map acetic acid + ethanol geometries to ester linkage + H₂O.",
    atomInventory: {
      reactants: { C: 4, H: 8, O: 3 },
      products: { C: 4, H: 8, O: 3 },
    },
  },
});

export const EXTENDED_REACTIONS: ReactionData[] = [
  HABER_BOSCH,
  PHOTOSYNTHESIS,
  NEUTRALIZATION_HCL_NAOH,
  ESTERIFICATION_ETHYL_ACETATE,
];
