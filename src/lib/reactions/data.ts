import type { ReactionData } from "./types";
import { EXTENDED_REACTIONS } from "./catalog-extended";

function withFacts<T extends Omit<ReactionData, "facts">>(entry: T): ReactionData {
  return { ...entry, facts: entry.quickFacts };
}

export const METHANE_COMBUSTION: ReactionData = withFacts({
  id: "methane-combustion",
  name: "Combustion of Methane",
  formula: "CH₄ + 2O₂ → CO₂ + 2H₂O",
  equation: "CH₄ + 2 O₂ → CO₂ + 2 H₂O",
  category: "ORGANIC",
  difficulty: "BEGINNER",
  reactants: [
    { name: "Methane", formula: "CH₄", count: 1 },
    { name: "Oxygen", formula: "O₂", count: 2 },
  ],
  products: [
    { name: "Carbon dioxide", formula: "CO₂", count: 1 },
    { name: "Water", formula: "H₂O", count: 2 },
  ],
  description:
    "A classic oxidation: methane meets oxygen in a chain of radical steps that release a lot of heat and produce carbon dioxide and water.",
  accentColor: "#f97316",
  reactionType: "Combustion",
  steps: [
    { moleculeId: "methane", caption: "Fuel — methane" },
    { moleculeId: "water", caption: "Product spotlight — water" },
  ],
  quickFacts: {
    summary:
      "Complete combustion of methane is strongly exothermic and converts chemical potential energy into heat and light.",
    energyProfile: "Highly exothermic (ΔH << 0 for the balanced reaction)",
    conditions: "Initiation energy (spark/flame); sustained O₂ supply",
    mechanism:
      "Radical chain mechanism: initiation → propagation (·OH, ·CH₃, etc.) → termination; 3D view highlights representative species.",
    highlight: "Every balanced combustion story ends with better CO₂ accounting and careful handling of open flames.",
  },
  animationMetadata: {
    status: "ready",
    animationKey: "methane-combustion",
    atomInventory: {
      reactants: { C: 1, H: 4, O: 4 },
      products: { C: 1, H: 4, O: 4 },
    },
  },
});

export const WATER_FORMATION: ReactionData = withFacts({
  id: "water-formation",
  name: "Formation of Water",
  formula: "2H₂ + O₂ → 2H₂O",
  equation: "2 H₂ + O₂ → 2 H₂O",
  category: "SYNTHESIS",
  difficulty: "BEGINNER",
  reactants: [
    { name: "Hydrogen", formula: "H₂", count: 2 },
    { name: "Oxygen", formula: "O₂", count: 1 },
  ],
  products: [{ name: "Water", formula: "H₂O", count: 2 }],
  description:
    "Hydrogen burns in oxygen to make water — simple stoichiometry, enormous industrial and rocket-science relevance.",
  accentColor: "#3b82f6",
  reactionType: "Synthesis / combustion",
  steps: [{ moleculeId: "water", caption: "Product — water (H₂O)" }],
  quickFacts: {
    summary:
      "This reaction releases a large amount of energy per gram of H₂, which is why it powers clean-energy conversations.",
    energyProfile: "Exothermic; very favorable thermodynamically",
    conditions: "Ignition or catalyst (e.g. Pt); precise H₂ : O₂ ratio matters for safety",
    mechanism:
      "Often radical-mediated in the gas phase; the 3D view shows the polar product that emerges from redox partnership.",
    highlight: "The bent geometry of water is a direct consequence of lone-pair repulsion on oxygen.",
  },
  animationMetadata: {
    status: "ready",
    animationKey: "water-formation",
    atomInventory: {
      reactants: { H: 4, O: 2 },
      products: { H: 4, O: 2 },
    },
  },
});

export const GLUCOSE_FERMENTATION: ReactionData = withFacts({
  id: "glucose-fermentation",
  name: "Fermentation of Glucose",
  formula: "C₆H₁₂O₆ → 2C₂H₅OH + 2CO₂",
  equation: "C₆H₁₂O₆ → 2 C₂H₅OH + 2 CO₂",
  category: "METABOLIC",
  difficulty: "INTERMEDIATE",
  reactants: [{ name: "Glucose", formula: "C₆H₁₂O₆", count: 1 }],
  products: [
    { name: "Ethanol", formula: "C₂H₅OH", count: 2 },
    { name: "Carbon dioxide", formula: "CO₂", count: 2 },
  ],
  description:
    "Yeast-friendly biochemistry: glucose is split into ethanol and carbon dioxide — the reason bread rises and wine exists.",
  accentColor: "#a855f7",
  reactionType: "Biochemical / anaerobic",
  steps: [
    { moleculeId: "glucose", caption: "Starting sugar" },
    { moleculeId: "ethanol", caption: "Ethanol product" },
  ],
  quickFacts: {
    summary:
      "Glycolysis followed by fermentation regenerates NAD⁺ so glycolysis can keep running when oxygen is scarce.",
    energyProfile: "Partial oxidation — modest ATP compared to respiration",
    conditions: "Yeast or bacteria; anaerobic or microaerobic environment",
    mechanism:
      "Pyruvate → acetaldehyde → ethanol, with CO₂ lost as a small molecule.",
    highlight: "The same pathway family connects brewing, baking, and biofuel research.",
  },
  animationMetadata: {
    status: "ready",
    animationKey: "glucose-fermentation",
    atomInventory: {
      reactants: { C: 6, H: 12, O: 6 },
      products: { C: 6, H: 12, O: 6 },
    },
  },
});

export const CORE_REACTIONS: ReactionData[] = [
  METHANE_COMBUSTION,
  WATER_FORMATION,
  GLUCOSE_FERMENTATION,
];

export const ALL_REACTIONS: ReactionData[] = [...CORE_REACTIONS, ...EXTENDED_REACTIONS];

export const REACTION_MAP: Record<string, ReactionData> = Object.fromEntries(
  ALL_REACTIONS.map((r) => [r.id, r])
);
