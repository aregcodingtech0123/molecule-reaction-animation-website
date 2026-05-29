import type { AtomData, BondData } from "../types";
import { atom, bond, hexRing, ringBonds } from "../geometry/helpers";

const S = 1.15;
const ring = hexRing([0, 0, 0], 1.3 * S, 0);
const [C1, C2, C3, C4, C5, C6] = ["C1", "C2", "C3", "C4", "C5", "C6"];

export const ADRENALINE_ATOMS: AtomData[] = [
  atom(C1, "C", ring[0]),
  atom(C2, "C", ring[1]),
  atom(C3, "C", ring[2]),
  atom(C4, "C", ring[3]),
  atom(C5, "C", ring[4]),
  atom(C6, "C", ring[5]),
  atom("O7", "O", [ring[1][0] + 1.2 * S, ring[1][1] + 0.35 * S, 0.15 * S]),
  atom("H8", "H", [ring[1][0] + 1.85 * S, ring[1][1] + 0.55 * S, 0.35 * S]),
  atom("O9", "O", [ring[2][0], ring[2][1] + 1.2 * S, 0.15 * S]),
  atom("H10", "H", [ring[2][0] + 0.2 * S, ring[2][1] + 1.85 * S, 0.35 * S]),
  atom("C11", "C", [ring[4][0] + 1.45 * S, ring[4][1], 0]),
  atom("C12", "C", [ring[4][0] + 2.55 * S, ring[4][1], 0]),
  atom("C13", "C", [ring[4][0] + 3.55 * S, ring[4][1] + 0.55 * S, 0]),
  atom("O14", "O", [ring[4][0] + 4.45 * S, ring[4][1] + 1.15 * S, 0.2 * S]),
  atom("H15", "H", [ring[4][0] + 5.05 * S, ring[4][1] + 1.55 * S, 0.45 * S]),
  atom("N16", "N", [ring[4][0] + 3.75 * S, ring[4][1] - 0.75 * S, 0]),
  atom("C17", "C", [ring[4][0] + 4.85 * S, ring[4][1] - 1.35 * S, 0]),
  atom("H18", "H", [ring[0][0] + 0.55 * S, ring[0][1] + 0.35 * S, 0]),
  atom("H19", "H", [ring[3][0] - 0.55 * S, ring[3][1] - 0.35 * S, 0]),
  atom("H20", "H", [ring[5][0] - 0.55 * S, ring[5][1] + 0.35 * S, 0]),
  atom("H21a", "H", [ring[4][0] + 2.55 * S, ring[4][1] + 0.95 * S, 0]),
  atom("H21b", "H", [ring[4][0] + 2.55 * S, ring[4][1] - 0.95 * S, 0]),
  atom("H22a", "H", [ring[4][0] + 4.85 * S, ring[4][1] - 2.05 * S, 0.35 * S]),
  atom("H22b", "H", [ring[4][0] + 5.45 * S, ring[4][1] - 1.05 * S, 0.35 * S]),
  atom("H22c", "H", [ring[4][0] + 4.85 * S, ring[4][1] - 0.65 * S, -0.85 * S]),
  atom("H23", "H", [ring[4][0] + 3.75 * S, ring[4][1] - 1.55 * S, 0.35 * S]),
];

export const ADRENALINE_BONDS: BondData[] = [
  ...ringBonds("ar", [C1, C2, C3, C4, C5, C6]),
  bond("b_c2_o7", C2, "O7", 1),
  bond("b_o7_h8", "O7", "H8", 1),
  bond("b_c3_o9", C3, "O9", 1),
  bond("b_o9_h10", "O9", "H10", 1),
  bond("b_c4_c11", C4, "C11", 1),
  bond("b_c11_c12", "C11", "C12", 1),
  bond("b_c12_c13", "C12", "C13", 1),
  bond("b_c13_o14", "C13", "O14", 1),
  bond("b_o14_h15", "O14", "H15", 1),
  bond("b_c13_n16", "C13", "N16", 1),
  bond("b_n16_c17", "N16", "C17", 1),
  bond("b_n16_h23", "N16", "H23", 1),
  bond("b_c1_h18", C1, "H18", 1),
  bond("b_c4_h19", C4, "H19", 1),
  bond("b_c5_h20", C5, "H20", 1),
  bond("b_c12_h21a", "C12", "H21a", 1),
  bond("b_c12_h21b", "C12", "H21b", 1),
  bond("b_c17_h22a", "C17", "H22a", 1),
  bond("b_c17_h22b", "C17", "H22b", 1),
  bond("b_c17_h22c", "C17", "H22c", 1),
];
