import type { ReactionAnimationDefinition } from "../types";
import { waterCluster } from "../layout";

/**
 * 2 H₂ + O₂ → 2 H₂O
 * Six atoms with conserved ids; O₂ supplies both water oxygens, each H₂ supplies one water's hydrogens.
 */
const w1 = waterCluster([-1.4, 2.1, 0], 0.96);
const w2 = waterCluster([-1.4, -2.1, 0], 0.96);

export const WATER_FORMATION_ANIMATION: ReactionAnimationDefinition = {
  id: "water-formation",
  scale: 1.3,
  timing: {
    breakBondsMs: 800,
    dissociateMs: 1000,
    assembleMs: 2600,
    formBondsMs: 900,
    holdMs: 500,
  },
  atoms: [
    {
      id: "h2a_H1",
      element: "H",
      reactantPosition: [-3.6, 1.35, 0.25],
      intermediatePosition: [-4.4, 2.2, 0.55],
      productPosition: w1.H1,
    },
    {
      id: "h2a_H2",
      element: "H",
      reactantPosition: [-2.8, 1.35, -0.25],
      intermediatePosition: [-2.0, 2.0, -0.45],
      productPosition: w1.H2,
    },
    {
      id: "h2b_H1",
      element: "H",
      reactantPosition: [-3.6, -1.35, -0.25],
      intermediatePosition: [-4.4, -2.2, -0.55],
      productPosition: w2.H1,
    },
    {
      id: "h2b_H2",
      element: "H",
      reactantPosition: [-2.8, -1.35, 0.25],
      intermediatePosition: [-2.0, -2.0, 0.45],
      productPosition: w2.H2,
    },
    {
      id: "o2_O1",
      element: "O",
      reactantPosition: [3.1, 0, 0],
      intermediatePosition: [4.2, 0.85, 0],
      productPosition: w1.O,
    },
    {
      id: "o2_O2",
      element: "O",
      reactantPosition: [3.9, 0, 0],
      intermediatePosition: [4.2, -0.85, 0],
      productPosition: w2.O,
    },
  ],
  reactantBonds: [
    { id: "rb_h2a", from: "h2a_H1", to: "h2a_H2", order: 1 },
    { id: "rb_h2b", from: "h2b_H1", to: "h2b_H2", order: 1 },
    { id: "rb_o2", from: "o2_O1", to: "o2_O2", order: 2 },
  ],
  productBonds: [
    { id: "pb_w1_1", from: "o2_O1", to: "h2a_H1", order: 1 },
    { id: "pb_w1_2", from: "o2_O1", to: "h2a_H2", order: 1 },
    { id: "pb_w2_1", from: "o2_O2", to: "h2b_H1", order: 1 },
    { id: "pb_w2_2", from: "o2_O2", to: "h2b_H2", order: 1 },
  ],
};
