import type {
  ReactionAnimationDefinition,
  ReactionAnimationAtom,
  ReactionBondState,
} from "../types";
import { co2Cluster, o2Cluster, waterCluster, radialExpand, centroidOfPoints } from "../layout";

/** Glucose ring product coordinates (from catalog GLUCOSE layout) */
const GLUCOSE_PRODUCT: Record<string, [number, number, number]> = {
  C1: [1.2, 0.7, 0],
  C2: [1.2, -0.7, 0],
  C3: [0, -1.4, 0],
  C4: [-1.2, -0.7, 0],
  C5: [-1.2, 0.7, 0],
  C6: [-2.4, 1.4, 0],
  O1: [0, 1.4, 0],
  O2: [2.3, 1.3, 0.5],
  O3: [2.3, -1.3, -0.5],
  O4: [0, -2.6, 0.5],
  O5: [-2.3, -1.3, 0.5],
  O6: [-3.5, 0.7, 0],
  H1: [1.2, 0.7, 1.1],
  H2: [1.2, -0.7, -1.1],
  H3: [0, -1.4, -1.1],
  H4: [-1.2, -0.7, -1.1],
  H5: [-1.2, 0.7, 1.1],
  H6a: [-2.4, 2.0, 0.9],
  H6b: [-2.4, 2.0, -0.9],
};

function buildPhotosynthesisAtoms(): ReactionAnimationAtom[] {
  const atoms: ReactionAnimationAtom[] = [];

  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 1.2 - Math.PI * 0.6;
    const co2Center: [number, number, number] = [-4.2 + Math.cos(t) * 1.8, 1.8 + Math.sin(t) * 0.4, Math.sin(t) * 1.6];
    const co2 = co2Cluster(co2Center, 1.05);
    const o2Out = o2Cluster([4.5 + Math.cos(t + 0.5) * 2.2, Math.sin(t + 0.5) * 2.8, 0], 0.55);

    const cId = `co2_${i}_C`;
    const o1Id = `co2_${i}_O1`;
    const o2Id = `co2_${i}_O2`;
    const gC = `C${i + 1}` as keyof typeof GLUCOSE_PRODUCT;

    atoms.push({
      id: cId,
      element: "C",
      reactantPosition: co2.C,
      productPosition: GLUCOSE_PRODUCT[gC],
    });
    atoms.push({
      id: o1Id,
      element: "O",
      reactantPosition: co2.O1,
      productPosition: o2Out.O1,
    });
    atoms.push({
      id: o2Id,
      element: "O",
      reactantPosition: co2.O2,
      productPosition: o2Out.O2,
    });
  }

  for (let i = 0; i < 6; i++) {
    const t = (i / 6) * Math.PI * 1.2 + Math.PI * 0.35;
    const wCenter: [number, number, number] = [4.0 + Math.cos(t) * 1.6, -1.6 + Math.sin(t) * 0.5, Math.cos(t) * 1.2];
    const w = waterCluster(wCenter, 0.88);
    const gO = (["O1", "O2", "O3", "O4", "O5", "O6"] as const)[i];
    const gH1 = (["H1", "H2", "H3", "H4", "H5", "H6a"] as const)[i];
    const gH2 = (["H2", "H3", "H4", "H5", "H6a", "H6b"] as const)[i];

    atoms.push({
      id: `h2o_${i}_O`,
      element: "O",
      reactantPosition: w.O,
      productPosition: GLUCOSE_PRODUCT[gO],
    });
    atoms.push({
      id: `h2o_${i}_H1`,
      element: "H",
      reactantPosition: w.H1,
      productPosition: GLUCOSE_PRODUCT[gH1],
    });
    atoms.push({
      id: `h2o_${i}_H2`,
      element: "H",
      reactantPosition: w.H2,
      productPosition: GLUCOSE_PRODUCT[gH2],
    });
  }

  const pivot = centroidOfPoints(atoms.map((a) => a.reactantPosition));
  return atoms.map((a) => ({
    ...a,
    intermediatePosition: radialExpand(a.reactantPosition, pivot, 1.38),
  }));
}

const PHOTO_ATOMS = buildPhotosynthesisAtoms();

const reactantBonds: ReactionBondState[] = [];
for (let i = 0; i < 6; i++) {
  reactantBonds.push(
    { id: `rb_co2_${i}_1`, from: `co2_${i}_C`, to: `co2_${i}_O1`, order: 2 },
    { id: `rb_co2_${i}_2`, from: `co2_${i}_C`, to: `co2_${i}_O2`, order: 2 },
    { id: `rb_h2o_${i}_1`, from: `h2o_${i}_O`, to: `h2o_${i}_H1`, order: 1 },
    { id: `rb_h2o_${i}_2`, from: `h2o_${i}_O`, to: `h2o_${i}_H2`, order: 1 }
  );
}

/** Glucose ring + exo O/H bonds using conserved atom ids */
const glucoseProductBonds: ReactionBondState[] = [
  { id: "pb_g1", from: "co2_0_C", to: "co2_1_C", order: 1 },
  { id: "pb_g2", from: "co2_1_C", to: "co2_2_C", order: 1 },
  { id: "pb_g3", from: "co2_2_C", to: "co2_3_C", order: 1 },
  { id: "pb_g4", from: "co2_3_C", to: "co2_4_C", order: 1 },
  { id: "pb_g5", from: "co2_4_C", to: "co2_5_C", order: 1 },
  { id: "pb_g6", from: "h2o_0_O", to: "co2_0_C", order: 1 },
  { id: "pb_g7", from: "co2_5_C", to: "co2_4_C", order: 1 },
  { id: "pb_g8", from: "co2_0_C", to: "h2o_1_O", order: 1 },
  { id: "pb_g9", from: "co2_1_C", to: "h2o_2_O", order: 1 },
  { id: "pb_g10", from: "co2_2_C", to: "h2o_3_O", order: 1 },
  { id: "pb_g11", from: "co2_3_C", to: "h2o_4_O", order: 1 },
  { id: "pb_g12", from: "co2_5_C", to: "h2o_5_O", order: 1 },
  { id: "pb_g13", from: "co2_0_C", to: "h2o_0_H1", order: 1 },
  { id: "pb_g14", from: "co2_1_C", to: "h2o_1_H1", order: 1 },
  { id: "pb_g15", from: "co2_2_C", to: "h2o_2_H1", order: 1 },
  { id: "pb_g16", from: "co2_3_C", to: "h2o_3_H1", order: 1 },
  { id: "pb_g17", from: "co2_4_C", to: "h2o_4_H1", order: 1 },
  { id: "pb_g18", from: "co2_5_C", to: "h2o_5_H1", order: 1 },
  { id: "pb_g19", from: "co2_5_C", to: "h2o_5_H2", order: 1 },
];

export const PHOTOSYNTHESIS_ANIMATION: ReactionAnimationDefinition = {
  id: "photosynthesis",
  scale: 1.05,
  timing: {
    breakBondsMs: 1000,
    dissociateMs: 1400,
    assembleMs: 3600,
    formBondsMs: 1200,
    holdMs: 600,
  },
  atoms: PHOTO_ATOMS,
  reactantBonds,
  productBonds: [
    ...glucoseProductBonds,
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `pb_o2_${i}`,
      from: `co2_${i}_O1`,
      to: `co2_${i}_O2`,
      order: 2 as const,
    })),
  ],
};
