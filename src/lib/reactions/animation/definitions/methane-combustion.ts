import type { ReactionAnimationDefinition } from "../types";

/**
 * CH₄ + 2 O₂ → CO₂ + 2 H₂O
 *
 * Layout (Å-scale coordinates, scene scale 1.35):
 *   Reactants: CH₄ left, two O₂ dimers right
 *   Products:  CO₂ center, two H₂O flanking
 *
 * Atom correspondence (conservation of atoms for lerp):
 *   C, H×4 from methane → C in CO₂ + H in each water
 *   O×4 from two O₂     → O in CO₂ + O in each water
 */
export const METHANE_COMBUSTION_ANIMATION: ReactionAnimationDefinition = {
  id: "methane-combustion",
  scale: 1.35,
  timing: {
    breakBondsMs: 850,
    transformMs: 2400,
    formBondsMs: 950,
    holdMs: 500,
  },
  atoms: [
    // ── Methane (reactant cluster, left) ──
    {
      id: "ch4_C",
      element: "C",
      reactantPosition: [-3.8, 0, 0],
      productPosition: [0, 0, 0],
    },
    {
      id: "ch4_H1",
      element: "H",
      reactantPosition: [-2.71, 0, 0],
      productPosition: [-2.15, 1.85, 0.15],
    },
    {
      id: "ch4_H2",
      element: "H",
      reactantPosition: [-4.16, 1.03, 0],
      productPosition: [-2.55, 2.35, -0.35],
    },
    {
      id: "ch4_H3",
      element: "H",
      reactantPosition: [-4.16, -0.51, 0.89],
      productPosition: [-2.1, -1.75, 0.2],
    },
    {
      id: "ch4_H4",
      element: "H",
      reactantPosition: [-4.16, -0.51, -0.89],
      productPosition: [-2.45, -2.25, -0.25],
    },
    // ── O₂ #1 (upper right) ──
    {
      id: "o2a_O1",
      element: "O",
      reactantPosition: [2.2, 1.35, 0],
      productPosition: [-1.16, 0, 0],
    },
    {
      id: "o2a_O2",
      element: "O",
      reactantPosition: [3.0, 1.35, 0],
      productPosition: [1.16, 0, 0],
    },
    // ── O₂ #2 (lower right) ──
    {
      id: "o2b_O1",
      element: "O",
      reactantPosition: [2.2, -1.35, 0],
      productPosition: [-3.05, 1.95, 0],
    },
    {
      id: "o2b_O2",
      element: "O",
      reactantPosition: [3.0, -1.35, 0],
      productPosition: [-3.05, -1.95, 0],
    },
  ],
  reactantBonds: [
    { id: "rb_ch4_1", from: "ch4_C", to: "ch4_H1", order: 1 },
    { id: "rb_ch4_2", from: "ch4_C", to: "ch4_H2", order: 1 },
    { id: "rb_ch4_3", from: "ch4_C", to: "ch4_H3", order: 1 },
    { id: "rb_ch4_4", from: "ch4_C", to: "ch4_H4", order: 1 },
    { id: "rb_o2a", from: "o2a_O1", to: "o2a_O2", order: 2 },
    { id: "rb_o2b", from: "o2b_O1", to: "o2b_O2", order: 2 },
  ],
  productBonds: [
    { id: "pb_co2_1", from: "ch4_C", to: "o2a_O1", order: 2 },
    { id: "pb_co2_2", from: "ch4_C", to: "o2a_O2", order: 2 },
    { id: "pb_w1_1", from: "o2b_O1", to: "ch4_H1", order: 1 },
    { id: "pb_w1_2", from: "o2b_O1", to: "ch4_H2", order: 1 },
    { id: "pb_w2_1", from: "o2b_O2", to: "ch4_H3", order: 1 },
    { id: "pb_w2_2", from: "o2b_O2", to: "ch4_H4", order: 1 },
  ],
};
