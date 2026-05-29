import type { AtomData, BondData } from "../types";
import { atom, bond, hexRing, ringBonds } from "../geometry/helpers";

const S = 1.2;
const ring = hexRing([0, 0, 0], 1.3 * S, 0);
const [C1, C2, C3, C4, C5, C6] = ["C1", "C2", "C3", "C4", "C5", "C6"];

export const DOPAMINE_ATOMS: AtomData[] = [
  atom(C1, "C", ring[0]),
  atom(C2, "C", ring[1]),
  atom(C3, "C", ring[2]),
  atom(C4, "C", ring[3]),
  atom(C5, "C", ring[4]),
  atom(C6, "C", ring[5]),
  atom("O7", "O", [ring[1][0] + 1.25 * S, ring[1][1] + 0.35 * S, 0.15 * S]),
  atom("H8", "H", [ring[1][0] + 1.85 * S, ring[1][1] + 0.55 * S, 0.35 * S]),
  atom("O9", "O", [ring[2][0] - 0.15 * S, ring[2][1] + 1.25 * S, 0.15 * S]),
  atom("H10", "H", [ring[2][0] + 0.05 * S, ring[2][1] + 1.85 * S, 0.35 * S]),
  atom("C11", "C", [ring[4][0] + 1.45 * S, ring[4][1], 0]),
  atom("C12", "C", [ring[4][0] + 2.55 * S, ring[4][1], 0]),
  atom("N13", "N", [ring[4][0] + 3.65 * S, ring[4][1] + 0.35 * S, 0]),
  atom("H14", "H", [ring[4][0] + 4.45 * S, ring[4][1] + 0.15 * S, 0.35 * S]),
  atom("H15", "H", [ring[4][0] + 3.65 * S, ring[4][1] + 1.25 * S, 0.35 * S]),
  atom("H16", "H", [ring[0][0] + 0.55 * S, ring[0][1] + 0.35 * S, 0]),
  atom("H17", "H", [ring[3][0] - 0.55 * S, ring[3][1] - 0.35 * S, 0]),
  atom("H18", "H", [ring[5][0] - 0.55 * S, ring[5][1] + 0.35 * S, 0]),
  atom("H19a", "H", [ring[4][0] + 2.55 * S, ring[4][1] + 0.95 * S, 0]),
  atom("H19b", "H", [ring[4][0] + 2.55 * S, ring[4][1] - 0.95 * S, 0]),
];

export const DOPAMINE_BONDS: BondData[] = [
  ...ringBonds("ar", [C1, C2, C3, C4, C5, C6]),
  bond("b_c2_o7", C2, "O7", 1),
  bond("b_o7_h8", "O7", "H8", 1),
  bond("b_c3_o9", C3, "O9", 1),
  bond("b_o9_h10", "O9", "H10", 1),
  bond("b_c4_c11", C4, "C11", 1),
  bond("b_c11_c12", "C11", "C12", 1),
  bond("b_c12_n13", "C12", "N13", 1),
  bond("b_n13_h14", "N13", "H14", 1),
  bond("b_n13_h15", "N13", "H15", 1),
  bond("b_c1_h16", C1, "H16", 1),
  bond("b_c4_h17", C4, "H17", 1),
  bond("b_c5_h18", C5, "H18", 1),
  bond("b_c12_h1", "C12", "H19a", 1),
  bond("b_c12_h2", "C12", "H19b", 1),
];
