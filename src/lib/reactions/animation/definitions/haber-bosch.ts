import type { ReactionAnimationDefinition } from "../types";
import { nh3Cluster, h2Cluster } from "../layout";

/**
 * N₂ + 3H₂ → 2NH₃
 * 8 atoms: 2N + 6H — full conservation
 */
const nh3a = nh3Cluster([-1.5, 1.35, 0], 1.02);
const nh3b = nh3Cluster([-1.5, -1.35, 0], 1.02);

const h2pos = (c: [number, number, number]) => h2Cluster(c, 0.37);

export const HABER_BOSCH_ANIMATION: ReactionAnimationDefinition = {
  id: "haber-bosch",
  scale: 1.35,
  timing: {
    breakBondsMs: 900,
    dissociateMs: 1100,
    assembleMs: 2800,
    formBondsMs: 1000,
    holdMs: 500,
  },
  atoms: [
    {
      id: "n2_N1",
      element: "N",
      reactantPosition: [-3.2, 0, 0],
      intermediatePosition: [-3.6, 0, 0],
      productPosition: nh3a.N,
    },
    {
      id: "n2_N2",
      element: "N",
      reactantPosition: [-2.1, 0, 0],
      intermediatePosition: [-2.5, 0, 0],
      productPosition: nh3b.N,
    },
    {
      id: "h2_1_H1",
      element: "H",
      reactantPosition: h2pos([1.8, 2.0, 0.4]).H1,
      intermediatePosition: [-0.5, 2.6, 0.6],
      productPosition: nh3a.H1,
    },
    {
      id: "h2_1_H2",
      element: "H",
      reactantPosition: h2pos([1.8, 2.0, 0.4]).H2,
      intermediatePosition: [0.2, 2.4, 0.2],
      productPosition: nh3a.H2,
    },
    {
      id: "h2_2_H1",
      element: "H",
      reactantPosition: h2pos([2.4, 0, -0.5]).H1,
      intermediatePosition: [0.4, 0.5, -1.2],
      productPosition: nh3a.H3,
    },
    {
      id: "h2_2_H2",
      element: "H",
      reactantPosition: h2pos([2.4, 0, -0.5]).H2,
      intermediatePosition: [0.8, -0.2, -0.8],
      productPosition: nh3b.H1,
    },
    {
      id: "h2_3_H1",
      element: "H",
      reactantPosition: h2pos([1.8, -2.0, 0.3]).H1,
      intermediatePosition: [-0.3, -2.5, 0.5],
      productPosition: nh3b.H2,
    },
    {
      id: "h2_3_H2",
      element: "H",
      reactantPosition: h2pos([1.8, -2.0, 0.3]).H2,
      intermediatePosition: [0.1, -2.2, 0.1],
      productPosition: nh3b.H3,
    },
  ],
  reactantBonds: [
    { id: "rb_n2", from: "n2_N1", to: "n2_N2", order: 3 },
    { id: "rb_h2_1", from: "h2_1_H1", to: "h2_1_H2", order: 1 },
    { id: "rb_h2_2", from: "h2_2_H1", to: "h2_2_H2", order: 1 },
    { id: "rb_h2_3", from: "h2_3_H1", to: "h2_3_H2", order: 1 },
  ],
  productBonds: [
    { id: "pb_a1", from: "n2_N1", to: "h2_1_H1", order: 1 },
    { id: "pb_a2", from: "n2_N1", to: "h2_1_H2", order: 1 },
    { id: "pb_a3", from: "n2_N1", to: "h2_2_H1", order: 1 },
    { id: "pb_b1", from: "n2_N2", to: "h2_2_H2", order: 1 },
    { id: "pb_b2", from: "n2_N2", to: "h2_3_H1", order: 1 },
    { id: "pb_b3", from: "n2_N2", to: "h2_3_H2", order: 1 },
  ],
};
