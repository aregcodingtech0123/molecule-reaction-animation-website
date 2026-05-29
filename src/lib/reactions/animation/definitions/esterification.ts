import type { ReactionAnimationDefinition, ReactionAnimationAtom } from "../types";
import { waterCluster } from "../layout";

const h2o = waterCluster([3.8, 0, 0], 0.92);

/** Acetic acid + ethanol → ethyl acetate + water (C₄H₁₀O₃ conserved) */
const atoms: ReactionAnimationAtom[] = [
  // ── Acetic acid (left) ──
  {
    id: "ac_Cm",
    element: "C",
    reactantPosition: [-3.8, 0.4, 0],
    intermediatePosition: [-2.6, 0.8, 0],
    productPosition: [-1.85, 0.35, 0],
  },
  {
    id: "ac_Ck",
    element: "C",
    reactantPosition: [-2.5, 0, 0],
    intermediatePosition: [-1.4, 0.2, 0],
    productPosition: [-0.55, 0, 0],
  },
  {
    id: "ac_Od",
    element: "O",
    reactantPosition: [-2.5, 1.05, 0.1],
    intermediatePosition: [-1.5, 0.95, 0.15],
    productPosition: [-0.55, 0.75, 0.1],
  },
  {
    id: "ac_Ooh",
    element: "O",
    reactantPosition: [-2.5, -1.0, 0],
    intermediatePosition: [2.8, 0.2, 0],
    productPosition: h2o.O,
  },
  {
    id: "ac_Hoh",
    element: "H",
    reactantPosition: [-2.5, -1.85, 0.1],
    intermediatePosition: [3.5, 0.5, 0.2],
    productPosition: h2o.H1,
  },
  {
    id: "ac_Hm1",
    element: "H",
    reactantPosition: [-4.35, 0.4, 0.9],
    intermediatePosition: [-3.2, 0.5, 0.5],
    productPosition: [-1.85, 0.35, 0.85],
  },
  {
    id: "ac_Hm2",
    element: "H",
    reactantPosition: [-4.35, 0.4, -0.9],
    intermediatePosition: [-3.2, 0.5, -0.5],
    productPosition: [-1.85, 0.35, -0.85],
  },
  {
    id: "ac_Hm3",
    element: "H",
    reactantPosition: [-3.8, 1.25, 0],
    intermediatePosition: [-2.6, 1.1, 0],
    productPosition: [-1.85, 1.0, 0],
  },
  // ── Ethanol (right) ──
  {
    id: "et_O",
    element: "O",
    reactantPosition: [2.8, 0, 0],
    intermediatePosition: [0.15, -0.55, 0],
    productPosition: [-0.15, -0.55, 0],
  },
  {
    id: "et_Ho",
    element: "H",
    reactantPosition: [3.55, 0.15, 0.1],
    intermediatePosition: [3.2, 0.9, 0.15],
    productPosition: h2o.H2,
  },
  {
    id: "et_C1",
    element: "C",
    reactantPosition: [1.9, 0, 0],
    intermediatePosition: [0.5, 0, 0],
    productPosition: [0.55, 0, 0],
  },
  {
    id: "et_C2",
    element: "C",
    reactantPosition: [0.9, 0.95, 0],
    intermediatePosition: [1.2, 1.2, 0],
    productPosition: [1.45, 0.95, 0],
  },
  {
    id: "et_H1",
    element: "H",
    reactantPosition: [0.9, 2.0, 0.1],
    intermediatePosition: [1.2, 2.1, 0.1],
    productPosition: [1.45, 2.0, 0.1],
  },
  {
    id: "et_H2",
    element: "H",
    reactantPosition: [0.2, 0.5, 0.85],
    intermediatePosition: [0.5, 0.4, 0.6],
    productPosition: [0.75, 0.5, 0.85],
  },
  {
    id: "et_H3",
    element: "H",
    reactantPosition: [0.2, 0.5, -0.85],
    intermediatePosition: [0.5, 0.4, -0.6],
    productPosition: [0.75, 0.5, -0.85],
  },
  {
    id: "et_H4",
    element: "H",
    reactantPosition: [0.9, 1.85, 0.2],
    intermediatePosition: [1.1, 1.95, 0.15],
    productPosition: [1.45, 1.85, 0.2],
  },
  {
    id: "et_H5",
    element: "H",
    reactantPosition: [1.5, 0.95, 0.75],
    intermediatePosition: [1.7, 1.0, 0.55],
    productPosition: [1.75, 0.95, 0.75],
  },
];

export const ESTERIFICATION_ANIMATION: ReactionAnimationDefinition = {
  id: "esterification-ethyl-acetate",
  scale: 1.25,
  timing: {
    breakBondsMs: 850,
    dissociateMs: 1200,
    assembleMs: 3000,
    formBondsMs: 1000,
    holdMs: 550,
  },
  atoms,
  reactantBonds: [
    { id: "rb_ac_cm_ck", from: "ac_Cm", to: "ac_Ck", order: 1 },
    { id: "rb_ac_ck_od", from: "ac_Ck", to: "ac_Od", order: 2 },
    { id: "rb_ac_ck_ooh", from: "ac_Ck", to: "ac_Ooh", order: 1 },
    { id: "rb_ac_ooh_h", from: "ac_Ooh", to: "ac_Hoh", order: 1 },
    { id: "rb_ac_cm_h1", from: "ac_Cm", to: "ac_Hm1", order: 1 },
    { id: "rb_ac_cm_h2", from: "ac_Cm", to: "ac_Hm2", order: 1 },
    { id: "rb_ac_cm_h3", from: "ac_Cm", to: "ac_Hm3", order: 1 },
    { id: "rb_et_o_h", from: "et_O", to: "et_Ho", order: 1 },
    { id: "rb_et_c1_o", from: "et_C1", to: "et_O", order: 1 },
    { id: "rb_et_c1_c2", from: "et_C1", to: "et_C2", order: 1 },
    { id: "rb_et_c2_h1", from: "et_C2", to: "et_H1", order: 1 },
    { id: "rb_et_c2_h2", from: "et_C2", to: "et_H2", order: 1 },
    { id: "rb_et_c2_h3", from: "et_C2", to: "et_H3", order: 1 },
    { id: "rb_et_c2_h4", from: "et_C2", to: "et_H4", order: 1 },
    { id: "rb_et_c2_h5", from: "et_C2", to: "et_H5", order: 1 },
  ],
  productBonds: [
    { id: "pb_ester_cc", from: "ac_Ck", to: "et_O", order: 1 },
    { id: "pb_ester_co", from: "ac_Ck", to: "ac_Od", order: 2 },
    { id: "pb_ester_cm", from: "ac_Cm", to: "ac_Ck", order: 1 },
    { id: "pb_ester_chain", from: "et_C1", to: "et_C2", order: 1 },
    { id: "pb_ester_c1o", from: "et_C1", to: "et_O", order: 1 },
    { id: "pb_h2o_1", from: "ac_Ooh", to: "ac_Hoh", order: 1 },
    { id: "pb_h2o_2", from: "ac_Ooh", to: "et_Ho", order: 1 },
  ],
};
