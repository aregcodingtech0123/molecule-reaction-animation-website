import type { ReactionAnimationDefinition } from "../types";
import { waterCluster } from "../layout";

const h2o = waterCluster([0, 0, 0], 0.98);

/**
 * HCl + NaOH → NaCl + H₂O
 * 5 atoms: H, Cl, Na, O, H
 */
export const NEUTRALIZATION_ANIMATION: ReactionAnimationDefinition = {
  id: "neutralization-hcl-naoh",
  scale: 1.4,
  timing: {
    breakBondsMs: 750,
    dissociateMs: 950,
    assembleMs: 2400,
    formBondsMs: 850,
    holdMs: 500,
  },
  atoms: [
    {
      id: "h_acid",
      element: "H",
      reactantPosition: [-2.35, 1.1, 0.2],
      intermediatePosition: [-1.2, 2.2, 0.5],
      productPosition: h2o.H1,
    },
    {
      id: "cl",
      element: "Cl",
      reactantPosition: [-3.15, 1.0, 0],
      intermediatePosition: [-3.8, 0.2, 0],
      productPosition: [-1.55, -0.35, 0],
    },
    {
      id: "na",
      element: "Na",
      reactantPosition: [3.0, -1.0, 0],
      intermediatePosition: [3.6, -0.2, 0],
      productPosition: [1.55, -0.35, 0],
    },
    {
      id: "o_base",
      element: "O",
      reactantPosition: [3.75, -1.15, 0],
      intermediatePosition: [0.4, 0.3, 0],
      productPosition: h2o.O,
    },
    {
      id: "h_base",
      element: "H",
      reactantPosition: [4.45, -0.85, 0.15],
      intermediatePosition: [1.0, 2.0, 0.4],
      productPosition: h2o.H2,
    },
  ],
  reactantBonds: [
    { id: "rb_hcl", from: "h_acid", to: "cl", order: 1 },
    { id: "rb_naoh", from: "na", to: "o_base", order: 1 },
    { id: "rb_oh", from: "o_base", to: "h_base", order: 1 },
  ],
  productBonds: [
    { id: "pb_h2o_1", from: "o_base", to: "h_acid", order: 1 },
    { id: "pb_h2o_2", from: "o_base", to: "h_base", order: 1 },
    { id: "pb_salt", from: "na", to: "cl", order: 1 },
  ],
};
