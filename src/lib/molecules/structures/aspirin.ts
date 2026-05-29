import type { AtomData, BondData } from "../types";
import { atom, bond, hexRing, ringBonds } from "../geometry/helpers";

const S = 1.15;
const ring = hexRing([0, 0, 0], 1.35 * S, -Math.PI / 2);
const [C1, C2, C3, C4, C5, C6] = ["C1", "C2", "C3", "C4", "C5", "C6"];

export const ASPIRIN_ATOMS: AtomData[] = [
  atom(C1, "C", ring[0]),
  atom(C2, "C", ring[1]),
  atom(C3, "C", ring[2]),
  atom(C4, "C", ring[3]),
  atom(C5, "C", ring[4]),
  atom(C6, "C", ring[5]),
  atom("C7", "C", [-2.55 * S, 0, 0]),
  atom("O8", "O", [-3.35 * S, 0.95 * S, 0]),
  atom("O9", "O", [-3.35 * S, -0.95 * S, 0]),
  atom("H10", "H", [-4.05 * S, -0.95 * S, 0.35 * S]),
  atom("O11", "O", [-0.75 * S, -2.35 * S, 0]),
  atom("C12", "C", [-1.55 * S, -3.15 * S, 0]),
  atom("O13", "O", [-2.45 * S, -3.15 * S, 0.85 * S]),
  atom("C14", "C", [-1.15 * S, -4.25 * S, -0.35 * S]),
  atom("H15", "H", [ring[1][0] + 0.55 * S, ring[1][1] + 0.35 * S, 0]),
  atom("H16", "H", [ring[2][0] - 0.55 * S, ring[2][1] + 0.35 * S, 0]),
  atom("H17", "H", [ring[4][0] + 0.55 * S, ring[4][1] - 0.35 * S, 0]),
  atom("H18", "H", [ring[5][0] - 0.55 * S, ring[5][1] - 0.35 * S, 0]),
  atom("H19a", "H", [-1.85 * S, -4.25 * S, 0.55 * S]),
  atom("H19b", "H", [-0.45 * S, -4.25 * S, -0.95 * S]),
  atom("H19c", "H", [-0.45 * S, -4.95 * S, 0.15 * S]),
];

export const ASPIRIN_BONDS: BondData[] = [
  ...ringBonds("ar", [C1, C2, C3, C4, C5, C6]),
  bond("b_c3_c7", C3, "C7", 1),
  bond("b_c7_o8", "C7", "O8", 2),
  bond("b_c7_o9", "C7", "O9", 1),
  bond("b_o9_h10", "O9", "H10", 1),
  bond("b_c4_o11", C4, "O11", 1),
  bond("b_o11_c12", "O11", "C12", 1),
  bond("b_c12_o13", "C12", "O13", 2),
  bond("b_c12_c14", "C12", "C14", 1),
  bond("b_c1_h15", C1, "H15", 1),
  bond("b_c2_h16", C2, "H16", 1),
  bond("b_c5_h17", C5, "H17", 1),
  bond("b_c6_h18", C6, "H18", 1),
  bond("b_c14_h1", "C14", "H19a", 1),
  bond("b_c14_h2", "C14", "H19b", 1),
  bond("b_c14_h3", "C14", "H19c", 1),
];
