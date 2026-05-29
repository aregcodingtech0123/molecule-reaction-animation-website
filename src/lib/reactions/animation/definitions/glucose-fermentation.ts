import type { ReactionAnimationDefinition, ReactionAnimationAtom } from "../types";
import { centroidOfPoints, radialExpand } from "../layout";

/** Ethanol local geometry (Å) anchored at oxygen */
function ethanolProduct(anchor: [number, number, number]) {
  const [x, y, z] = anchor;
  return {
    O: [x, y, z] as [number, number, number],
    HO: [x + 0.97, y, z] as [number, number, number],
    C1: [x - 1.42, y, z] as [number, number, number],
    C2: [x - 2.42, y + 0.95, z] as [number, number, number],
    H1a: [x - 1.42, y, z + 1.0] as [number, number, number],
    H1b: [x - 1.42, y, z - 1.0] as [number, number, number],
    H2a: [x - 3.3, y + 0.5, z + 0.5] as [number, number, number],
    H2b: [x - 2.42, y + 2.0, z] as [number, number, number],
    H2c: [x - 2.0, y + 0.9, z - 0.9] as [number, number, number],
  };
}

function co2Product(anchor: [number, number, number]) {
  const [x, y, z] = anchor;
  return {
    C: [x, y, z] as [number, number, number],
    O1: [x - 1.16, y, z] as [number, number, number],
    O2: [x + 1.16, y, z] as [number, number, number],
  };
}

const eth1 = ethanolProduct([-4.2, 1.6, 0]);
const eth2 = ethanolProduct([4.2, 1.6, 0]);
const co2a = co2Product([0, 3.6, 0]);
const co2b = co2Product([0, -3.6, 0]);

/** Ring glucose layout (matches simplified GLUCOSE in data.ts), scene-centered */
const GLUCOSE_REACTANT: ReactionAnimationAtom[] = [
  { id: "C1", element: "C", reactantPosition: [1.2, 0.7, 0], productPosition: co2a.C },
  { id: "C2", element: "C", reactantPosition: [1.2, -0.7, 0], productPosition: co2b.C },
  { id: "C3", element: "C", reactantPosition: [0, -1.4, 0], productPosition: eth1.C1 },
  { id: "C4", element: "C", reactantPosition: [-1.2, -0.7, 0], productPosition: eth1.C2 },
  { id: "C5", element: "C", reactantPosition: [-1.2, 0.7, 0], productPosition: eth2.C1 },
  { id: "C6", element: "C", reactantPosition: [-2.4, 1.4, 0], productPosition: eth2.C2 },
  { id: "O1", element: "O", reactantPosition: [0, 1.4, 0], productPosition: eth1.O },
  { id: "O2", element: "O", reactantPosition: [2.3, 1.3, 0.5], productPosition: eth2.O },
  { id: "O3", element: "O", reactantPosition: [2.3, -1.3, -0.5], productPosition: co2a.O1 },
  { id: "O4", element: "O", reactantPosition: [0, -2.6, 0.5], productPosition: co2a.O2 },
  { id: "O5", element: "O", reactantPosition: [-2.3, -1.3, 0.5], productPosition: co2b.O1 },
  { id: "O6", element: "O", reactantPosition: [-3.5, 0.7, 0], productPosition: co2b.O2 },
  { id: "H1", element: "H", reactantPosition: [1.2, 0.7, 1.1], productPosition: eth1.H1a },
  { id: "H2", element: "H", reactantPosition: [1.2, -0.7, -1.1], productPosition: eth1.H1b },
  { id: "H3", element: "H", reactantPosition: [0, -1.4, -1.1], productPosition: eth1.H2a },
  { id: "H4", element: "H", reactantPosition: [-1.2, -0.7, -1.1], productPosition: eth1.H2b },
  { id: "H5", element: "H", reactantPosition: [-1.2, 0.7, 1.1], productPosition: eth1.HO },
  { id: "H6a", element: "H", reactantPosition: [-2.4, 2.0, 0.9], productPosition: eth2.H1a },
  { id: "H6b", element: "H", reactantPosition: [-2.4, 2.0, -0.9], productPosition: eth2.H1b },
];

const pivot = centroidOfPoints(GLUCOSE_REACTANT.map((a) => a.reactantPosition));
const atomsWithIntermediate: ReactionAnimationAtom[] = GLUCOSE_REACTANT.map((a) => ({
  ...a,
  intermediatePosition: radialExpand(a.reactantPosition, pivot, 1.45),
}));

export const GLUCOSE_FERMENTATION_ANIMATION: ReactionAnimationDefinition = {
  id: "glucose-fermentation",
  scale: 1.15,
  timing: {
    breakBondsMs: 1100,
    dissociateMs: 1400,
    assembleMs: 3200,
    formBondsMs: 1100,
    holdMs: 600,
  },
  atoms: atomsWithIntermediate,
  reactantBonds: [
    { id: "rb1", from: "C1", to: "C2", order: 1 },
    { id: "rb2", from: "C2", to: "C3", order: 1 },
    { id: "rb3", from: "C3", to: "C4", order: 1 },
    { id: "rb4", from: "C4", to: "C5", order: 1 },
    { id: "rb5", from: "C5", to: "O1", order: 1 },
    { id: "rb6", from: "O1", to: "C1", order: 1 },
    { id: "rb7", from: "C5", to: "C6", order: 1 },
    { id: "rb8", from: "C1", to: "O2", order: 1 },
    { id: "rb9", from: "C2", to: "O3", order: 1 },
    { id: "rb10", from: "C3", to: "O4", order: 1 },
    { id: "rb11", from: "C4", to: "O5", order: 1 },
    { id: "rb12", from: "C6", to: "O6", order: 1 },
    { id: "rb13", from: "C1", to: "H1", order: 1 },
    { id: "rb14", from: "C2", to: "H2", order: 1 },
    { id: "rb15", from: "C3", to: "H3", order: 1 },
    { id: "rb16", from: "C4", to: "H4", order: 1 },
    { id: "rb17", from: "C5", to: "H5", order: 1 },
    { id: "rb18", from: "C6", to: "H6a", order: 1 },
    { id: "rb19", from: "C6", to: "H6b", order: 1 },
  ],
  productBonds: [
    { id: "pb_co2a_1", from: "C1", to: "O3", order: 2 },
    { id: "pb_co2a_2", from: "C1", to: "O4", order: 2 },
    { id: "pb_co2b_1", from: "C2", to: "O5", order: 2 },
    { id: "pb_co2b_2", from: "C2", to: "O6", order: 2 },
    { id: "pb_eth1_O", from: "O1", to: "C3", order: 1 },
    { id: "pb_eth1_C", from: "C3", to: "C4", order: 1 },
    { id: "pb_eth1_HO", from: "O1", to: "H5", order: 1 },
    { id: "pb_eth1_H1a", from: "C3", to: "H1", order: 1 },
    { id: "pb_eth1_H1b", from: "C3", to: "H2", order: 1 },
    { id: "pb_eth1_H2a", from: "C4", to: "H3", order: 1 },
    { id: "pb_eth1_H2b", from: "C4", to: "H4", order: 1 },
    { id: "pb_eth2_O", from: "O2", to: "C5", order: 1 },
    { id: "pb_eth2_C", from: "C5", to: "C6", order: 1 },
    { id: "pb_eth2_H1a", from: "C5", to: "H6a", order: 1 },
    { id: "pb_eth2_H1b", from: "C5", to: "H6b", order: 1 },
  ],
};
