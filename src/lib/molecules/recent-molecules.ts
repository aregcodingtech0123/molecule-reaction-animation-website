import type { MoleculeData } from "./types";
import {
  ASPIRIN_ATOMS,
  ASPIRIN_BONDS,
  CAPSAICIN_ATOMS,
  CAPSAICIN_BONDS,
  SEROTONIN_ATOMS,
  SEROTONIN_BONDS,
  DOPAMINE_ATOMS,
  DOPAMINE_BONDS,
  ADRENALINE_ATOMS,
  ADRENALINE_BONDS,
  BUCKMINSTERFULLERENE_ATOMS,
  BUCKMINSTERFULLERENE_BONDS,
  HEME_ATOMS,
  HEME_BONDS,
} from "./structures";

/** Ordered ids for molecules added in the multidisciplinary expansion (Explorer highlights). */
export const RECENT_MOLECULE_IDS: readonly string[] = [
  "ethanol",
  "aspirin",
  "capsaicin",
  "serotonin",
  "dopamine",
  "adrenaline",
  "buckminsterfullerene",
  "heme-group",
] as const;

export const ETHANOL: MoleculeData = {
  id: "ethanol",
  name: "Ethanol",
  formula: "C₂H₅OH",
  description:
    "The familiar two-carbon alcohol behind beer, wine, and antiseptic gels—small, polar, and surprisingly influential in chemistry labs and parties alike.",
  category: "organic",
  disciplineTag: "DAILY LIFE",
  modelPath: null,
  atoms: [
    { id: "O1", element: "O", position: [0, 0, 0] },
    { id: "HO", element: "H", position: [0.97, 0, 0] },
    { id: "C1", element: "C", position: [-1.42, 0, 0] },
    { id: "C2", element: "C", position: [-2.42, 0.95, 0] },
    { id: "H1a", element: "H", position: [-1.42, 0, 1.0] },
    { id: "H1b", element: "H", position: [-1.42, 0, -1.0] },
    { id: "H2a", element: "H", position: [-3.3, 0.5, 0.5] },
    { id: "H2b", element: "H", position: [-2.42, 2.0, 0] },
    { id: "H2c", element: "H", position: [-2.0, 0.9, -0.9] },
  ],
  bonds: [
    { id: "b1", from: "O1", to: "HO", order: 1 },
    { id: "b2", from: "O1", to: "C1", order: 1 },
    { id: "b3", from: "C1", to: "C2", order: 1 },
    { id: "b4", from: "C1", to: "H1a", order: 1 },
    { id: "b5", from: "C1", to: "H1b", order: 1 },
    { id: "b6", from: "C2", to: "H2a", order: 1 },
    { id: "b7", from: "C2", to: "H2b", order: 1 },
    { id: "b8", from: "C2", to: "H2c", order: 1 },
  ],
  education: {
    molecularWeight: "46.07 g/mol",
    boilingPoint: "78.37°C",
    meltingPoint: "-114.1°C",
    state: "liquid",
    bondTypes: ["Polar covalent (C–O, O–H)", "Nonpolar C–C / C–H", "Hydrogen bonding (between molecules)"],
    uses: [
      "Alcoholic beverages (dilute solutions)",
      "Solvent in labs and tinctures",
      "Antiseptic and fuel bio-additives",
    ],
    funFacts: [
      "Your liver turns ethanol into acetaldehyde before it becomes acetate—pace matters.",
      "Ethanol is miscible with water (PubChem lists it as miscible, citing HSDB, ICSC and NIOSH).",
    ],
    color: "#38bdf8",
  },
};

export const ASPIRIN: MoleculeData = {
  id: "aspirin",
  name: "Aspirin",
  formula: "C₉H₈O₄",
  description:
    "Acetylsalicylic acid: a classic pain reliever that irreversibly tweaks platelet chemistry—medicine, history, and organic synthesis in one tiny tablet.",
  category: "organic",
  disciplineTag: "MEDICINE",
  modelPath: null,
  atoms: ASPIRIN_ATOMS,
  bonds: ASPIRIN_BONDS,
  education: {
    molecularWeight: "180.16 g/mol",
    meltingPoint: "135°C (sharp; commercial samples may broaden)",
    state: "solid",
    bondTypes: ["Aromatic (benzene ring)", "Ester linkage", "Carboxylic acid"],
    uses: [
      "Analgesic (pain) and antipyretic (fever)",
      "Anti-inflammatory (NSAID)",
      "Low-dose antiplatelet therapy (under medical guidance)",
    ],
    funFacts: [
      "Willow bark salicin is the plant-world ancestor of this synthetic superstar.",
      "Its systematic name, 2-acetyloxybenzoic acid, describes a benzoic acid carrying an acetyloxy group (PubChem).",
    ],
    color: "#f43f5e",
  },
};

export const CAPSAICIN: MoleculeData = {
  id: "capsaicin",
  name: "Capsaicin",
  formula: "C₁₈H₂₇NO₃",
  description:
    "The fiery vanilloid that makes chili peppers bite—an evolutionary deterrent for mammals and a neuroscientist’s favorite TRPV1 conversation starter.",
  category: "organic",
  disciplineTag: "ORGANIC",
  modelPath: null,
  atoms: CAPSAICIN_ATOMS,
  bonds: CAPSAICIN_BONDS,
  education: {
    molecularWeight: "305.41 g/mol",
    meltingPoint: "65–67°C",
    state: "solid",
    bondTypes: ["Phenolic aromatic core", "Amide linkage", "Ether (methoxy) and aliphatic chain"],
    uses: [
      "Culinary heat and capsaicinoid blends",
      "Topical analgesic creams (TRPV1 modulation)",
      "Pest-deterrent formulations",
    ],
    funFacts: [
      "Birds often lack the receptor sensitivity mammals have—chili seeds spread farther that way.",
      "Spice “heat” is not a taste on the tongue map; it’s nociceptor theater.",
    ],
    color: "#ef4444",
  },
};

export const SEROTONIN: MoleculeData = {
  id: "serotonin",
  name: "Serotonin",
  formula: "C₁₀H₁₂N₂O",
  description:
    "5-HT: a monoamine signal with a résumé spanning mood, sleep, and gut motility—proof that one scaffold can wear many biological hats.",
  category: "biological",
  disciplineTag: "NEUROSCIENCE",
  modelPath: null,
  atoms: SEROTONIN_ATOMS,
  bonds: SEROTONIN_BONDS,
  education: {
    molecularWeight: "176.22 g/mol",
    state: "solid",
    bondTypes: ["Aromatic indole", "Primary amine", "Phenolic hydroxyl"],
    uses: [
      "Neurotransmission and neuromodulation",
      "Pharmacology targets (e.g. SSRIs act upstream in pathways)",
      "Peripheral roles in the enteric nervous system",
    ],
    funFacts: [
      "Most of your body’s serotonin isn’t “in your mood”—a large share is entangled with the gut and platelets.",
      "Its name nods to blood serum, where it was first noticed to constrict vessels.",
    ],
    color: "#22d3ee",
  },
};

export const DOPAMINE: MoleculeData = {
  id: "dopamine",
  name: "Dopamine",
  formula: "C₈H₁₁NO₂",
  description:
    "A catecholamine built from a brave little ethylamine tail on a catechol ring—motivation, movement, and mesolimbic myths all orbit this structure.",
  category: "biological",
  disciplineTag: "NEUROSCIENCE",
  modelPath: null,
  atoms: DOPAMINE_ATOMS,
  bonds: DOPAMINE_BONDS,
  education: {
    molecularWeight: "153.18 g/mol",
    state: "solid",
    bondTypes: ["Aromatic (catechol)", "Primary amine", "Phenolic O–H"],
    uses: [
      "Neurotransmitter in reward and motor pathways",
      "Clinical shock support (as hydrochloride salt, IV, under care)",
      "Teaching ligand for GPCR and transporter biology",
    ],
    funFacts: [
      "Parkinson’s pathology is tightly linked to dopamine neuron loss in the substantia nigra.",
      "It’s polar enough that free dopamine doesn’t casually joyride across the blood–brain barrier.",
    ],
    color: "#eab308",
  },
};

export const ADRENALINE: MoleculeData = {
  id: "adrenaline",
  name: "Adrenaline",
  formula: "C₉H₁₃NO₃",
  description:
    "Epinephrine: the molecule behind the pulse spike when something jumps in the bushes—sympathetic chemistry distilled into three oxygens of urgency.",
  category: "biological",
  disciplineTag: "NEUROSCIENCE",
  modelPath: null,
  atoms: ADRENALINE_ATOMS,
  bonds: ADRENALINE_BONDS,
  education: {
    molecularWeight: "183.20 g/mol",
    state: "solid",
    bondTypes: ["Aromatic (catechol)", "Secondary amine (benzylic substitution)", "Primary alcohol"],
    uses: [
      "Anaphylaxis rescue autoinjectors (with clinical training/indication)",
      "Local anesthesia adjuncts (with vasoconstrictive rationale)",
      "Physiology demos of fight-or-flight signaling",
    ],
    funFacts: [
      "\"Adrenaline\" vs \"epinephrine\" is largely UK/US naming—they’re the same impatient little hormone.",
      "It hits α- and β-adrenergic receptors, explaining both vasoconstriction stories and bronchodilator uses.",
    ],
    color: "#a855f7",
  },
};

export const BUCKMINSTERFULLERENE: MoleculeData = {
  id: "buckminsterfullerene",
  name: "Buckminsterfullerene",
  formula: "C₆₀",
  description:
    "A closed cage of 60 carbon atoms: a truncated icosahedron with 12 pentagonal and 20 hexagonal faces, one carbon at each of its 60 corners.",
  category: "macro",
  disciplineTag: "NANOTECH",
  modelPath: null,
  atoms: BUCKMINSTERFULLERENE_ATOMS,
  bonds: BUCKMINSTERFULLERENE_BONDS,
  education: {
    molecularWeight: "720.66 g/mol",
    state: "solid",
    bondTypes: ["Sp²-like carbon networking (truncated icosahedron)", "Delocalized π systems on curved surfaces"],
    uses: [
      "Materials science prototypes (thin films, composites)",
      "Electron acceptor motifs in organic electronics research",
      "Nanoscale carbon allotrope teaching tool",
    ],
    funFacts: [
      "12 pentagons and 20 hexagons—Euler’s handshake with graphite’s wild cousin.",
      "Named after architect Buckminster Fuller, who popularized geodesic domes.",
    ],
    color: "#64748b",
  },
};

export const HEME_GROUP: MoleculeData = {
  id: "heme-group",
  name: "Hemoglobin Heme Group",
  formula: "C₃₄H₃₂FeN₄O₄",
  description:
    "The iron-chelating porphyrin prosthetic group that turns hemoglobin into an oxygen shuttle: reversible O₂ binding with protein allostery backstage.",
  category: "biological",
  disciplineTag: "BIOLOGICAL",
  modelPath: null,
  atoms: HEME_ATOMS,
  bonds: HEME_BONDS,
  education: {
    molecularWeight: "616.49 g/mol",
    state: "solid",
    bondTypes: [
      "Aromatic porphyrin macrocycle",
      "Metal coordination (Fe–N)",
      "Propionate/carboxylate-like substituents (context-dependent protonation)",
    ],
    uses: [
      "O₂ transport and storage inside hemoproteins",
      "Enzyme active sites (e.g. catalase, cytochromes)",
      "Biochemistry teaching for ligand-field and cooperative binding",
    ],
    funFacts: [
      "Four heme units in hemoglobin enable cooperative binding—sigmoidal curves aren’t chemistry trivia, they’re physiology.",
    ],
    color: "#dc2626",
  },
};

export const MULTIDISCIPLINARY_MOLECULES: MoleculeData[] = [
  ETHANOL,
  ASPIRIN,
  CAPSAICIN,
  SEROTONIN,
  DOPAMINE,
  ADRENALINE,
  BUCKMINSTERFULLERENE,
  HEME_GROUP,
];
