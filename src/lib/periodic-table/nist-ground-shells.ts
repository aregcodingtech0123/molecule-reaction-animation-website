/**
 * Ground-state electron configurations of the neutral atoms, Z = 1-108, copied mechanically from the NIST Atomic
 * Spectra Database ("Ground States and Ionization Energies", column "Ground Shells") - never typed by hand.
 *
 * Source: Kramida, A., Ralchenko, Yu., Reader, J. and NIST ASD Team (2024). NIST Atomic Spectra Database
 *   (version 5.12), [Online]. Available: https://physics.nist.gov/asd [retrieved 2026-11-01]. National Institute of
 *   Standards and Technology, Gaithersburg, MD. DOI: https://doi.org/10.18434/T4W30F  (NIST Standard Reference Data 78).
 * Terms: NIST Standard Reference Data may be copied, modified and redistributed if NIST is acknowledged as the source
 *   and changes are noted (https://www.nist.gov/open/license). This file contains NO changes to the values.
 *
 * NIST does not list Z = 109-118 (their configurations are predicted, not measured), so there is deliberately no
 * entry for them: `electronShells()` returns null and nothing may be published for those elements (SEO-21).
 */
export const NIST_GROUND_SHELLS: Readonly<Record<number, string>> = {
  1: "1s", // H Hydrogen, ground level 2S1/2
  2: "1s2", // He Helium, ground level 1S0
  3: "1s2.2s", // Li Lithium, ground level 2S1/2
  4: "1s2.2s2", // Be Beryllium, ground level 1S0
  5: "1s2.2s2.2p", // B Boron, ground level 2P*1/2
  6: "1s2.2s2.2p2", // C Carbon, ground level 3P0
  7: "1s2.2s2.2p3", // N Nitrogen, ground level 4S*3/2
  8: "1s2.2s2.2p4", // O Oxygen, ground level 3P2
  9: "1s2.2s2.2p5", // F Fluorine, ground level 2P*3/2
  10: "1s2.2s2.2p6", // Ne Neon, ground level 1S0
  11: "[Ne].3s", // Na Sodium, ground level 2S1/2
  12: "[Ne].3s2", // Mg Magnesium, ground level 1S0
  13: "[Ne].3s2.3p", // Al Aluminum, ground level 2P*1/2
  14: "[Ne].3s2.3p2", // Si Silicon, ground level 3P0
  15: "[Ne].3s2.3p3", // P Phosphorus, ground level 4S*3/2
  16: "[Ne].3s2.3p4", // S Sulfur, ground level 3P2
  17: "[Ne].3s2.3p5", // Cl Chlorine, ground level 2P*3/2
  18: "[Ne].3s2.3p6", // Ar Argon, ground level 1S0
  19: "[Ar].4s", // K Potassium, ground level 2S1/2
  20: "[Ar].4s2", // Ca Calcium, ground level 1S0
  21: "[Ar].3d.4s2", // Sc Scandium, ground level 2D3/2
  22: "[Ar].3d2.4s2", // Ti Titanium, ground level 3F2
  23: "[Ar].3d3.4s2", // V Vanadium, ground level 4F3/2
  24: "[Ar].3d5.4s", // Cr Chromium, ground level 7S3
  25: "[Ar].3d5.4s2", // Mn Manganese, ground level 6S5/2
  26: "[Ar].3d6.4s2", // Fe Iron, ground level 5D4
  27: "[Ar].3d7.4s2", // Co Cobalt, ground level 4F9/2
  28: "[Ar].3d8.4s2", // Ni Nickel, ground level 3F4
  29: "[Ar].3d10.4s", // Cu Copper, ground level 2S1/2
  30: "[Ar].3d10.4s2", // Zn Zinc, ground level 1S0
  31: "[Ar].3d10.4s2.4p", // Ga Gallium, ground level 2P*1/2
  32: "[Ar].3d10.4s2.4p2", // Ge Germanium, ground level 3P0
  33: "[Ar].3d10.4s2.4p3", // As Arsenic, ground level 4S*3/2
  34: "[Ar].3d10.4s2.4p4", // Se Selenium, ground level 3P2
  35: "[Ar].3d10.4s2.4p5", // Br Bromine, ground level 2P*3/2
  36: "[Ar].3d10.4s2.4p6", // Kr Krypton, ground level 1S0
  37: "[Kr].5s", // Rb Rubidium, ground level 2S1/2
  38: "[Kr].5s2", // Sr Strontium, ground level 1S0
  39: "[Kr].4d.5s2", // Y Yttrium, ground level 2D3/2
  40: "[Kr].4d2.5s2", // Zr Zirconium, ground level 3F2
  41: "[Kr].4d4.5s", // Nb Niobium, ground level 6D1/2
  42: "[Kr].4d5.5s", // Mo Molybdenum, ground level 7S3
  43: "[Kr].4d5.5s2", // Tc Technetium, ground level 6S5/2
  44: "[Kr].4d7.5s", // Ru Ruthenium, ground level 5F5
  45: "[Kr].4d8.5s", // Rh Rhodium, ground level 4F9/2
  46: "[Kr].4d10", // Pd Palladium, ground level 1S0
  47: "[Kr].4d10.5s", // Ag Silver, ground level 2S1/2
  48: "[Kr].4d10.5s2", // Cd Cadmium, ground level 1S0
  49: "[Cd].5p", // In Indium, ground level 2P*1/2
  50: "[Cd].5p2", // Sn Tin, ground level 3P0
  51: "[Cd].5p3", // Sb Antimony, ground level 4S*3/2
  52: "[Cd].5p4", // Te Tellurium, ground level 3P2
  53: "[Cd].5p5", // I Iodine, ground level 2P*3/2
  54: "[Cd].5p6", // Xe Xenon, ground level 1S0
  55: "[Xe].6s", // Cs Cesium, ground level 2S1/2
  56: "[Xe].6s2", // Ba Barium, ground level 1S0
  57: "[Xe].5d.6s2", // La Lanthanum, ground level 2D3/2
  58: "[Xe].4f.5d.6s2", // Ce Cerium, ground level 1G*4
  59: "[Xe].4f3.6s2", // Pr Praseodymium, ground level 4I*9/2
  60: "[Xe].4f4.6s2", // Nd Neodymium, ground level 5I4
  61: "[Xe].4f5.6s2", // Pm Promethium, ground level 6H*5/2
  62: "[Xe].4f6.6s2", // Sm Samarium, ground level 7F0
  63: "[Xe].4f7.6s2", // Eu Europium, ground level 8S*7/2
  64: "[Xe].4f7.5d.6s2", // Gd Gadolinium, ground level 9D*2
  65: "[Xe].4f9.6s2", // Tb Terbium, ground level 6H*15/2
  66: "[Xe].4f10.6s2", // Dy Dysprosium, ground level 5I8
  67: "[Xe].4f11.6s2", // Ho Holmium, ground level 4I*15/2
  68: "[Xe].4f12.6s2", // Er Erbium, ground level 3H6
  69: "[Xe].4f13.6s2", // Tm Thulium, ground level 2F*7/2
  70: "[Xe].4f14.6s2", // Yb Ytterbium, ground level 1S0
  71: "[Xe].4f14.5d.6s2", // Lu Lutetium, ground level 2D3/2
  72: "[Xe].4f14.5d2.6s2", // Hf Hafnium, ground level 3F2
  73: "[Xe].4f14.5d3.6s2", // Ta Tantalum, ground level 4F3/2
  74: "[Xe].4f14.5d4.6s2", // W Tungsten, ground level 5D0
  75: "[Xe].4f14.5d5.6s2", // Re Rhenium, ground level 6S5/2
  76: "[Xe].4f14.5d6.6s2", // Os Osmium, ground level 5D4
  77: "[Xe].4f14.5d7.6s2", // Ir Iridium, ground level 4F9/2
  78: "[Xe].4f14.5d9.6s", // Pt Platinum, ground level 3D3
  79: "[Xe].4f14.5d10.6s", // Au Gold, ground level 2S1/2
  80: "[Xe].4f14.5d10.6s2", // Hg Mercury, ground level 1S0
  81: "[Hg].6p", // Tl Thallium, ground level 2P*1/2
  82: "[Hg].6p2", // Pb Lead, ground level (1/2,1/2)0
  83: "[Hg].6p3", // Bi Bismuth, ground level 4S*3/2
  84: "[Hg].6p4", // Po Polonium, ground level 3P2
  85: "[Hg].6p5", // At Astatine, ground level 2P*3/2
  86: "[Hg].6p6", // Rn Radon, ground level 1S0
  87: "[Rn].7s", // Fr Francium, ground level 2S1/2
  88: "[Rn].7s2", // Ra Radium, ground level 1S0
  89: "[Rn].6d.7s2", // Ac Actinium, ground level 2D3/2
  90: "[Rn].6d2.7s2", // Th Thorium, ground level 3F2
  91: "[Rn].5f2.6d.7s2", // Pa Protactinium, ground level 4K11/2
  92: "[Rn].5f3.6d.7s2", // U Uranium, ground level 5L*6
  93: "[Rn].5f4.6d.7s2", // Np Neptunium, ground level 6L11/2
  94: "[Rn].5f6.7s2", // Pu Plutonium, ground level 7F0
  95: "[Rn].5f7.7s2", // Am Americium, ground level 8S*7/2
  96: "[Rn].5f7.6d.7s2", // Cm Curium, ground level 9D*2
  97: "[Rn].5f9.7s2", // Bk Berkelium, ground level 6H*15/2
  98: "[Rn].5f10.7s2", // Cf Californium, ground level 5I8
  99: "[Rn].5f11.7s2", // Es Einsteinium, ground level 4I*15/2
  100: "[Rn].5f12.7s2", // Fm Fermium, ground level 3H6
  101: "[Rn].5f13.7s2", // Md Mendelevium, ground level 2F*7/2
  102: "[Rn].5f14.7s2", // No Nobelium, ground level 1S0
  103: "[Rn].5f14.7s2.7p", // Lr Lawrencium, ground level 2P*1/2
  104: "[Rn].5f14.6d2.7s2", // Rf Rutherfordium, ground level 3F2
  105: "[Rn].5f14.6d3.7s2", // Db Dubnium, ground level 4F3/2
  106: "[Rn].5f14.6d4.7s2", // Sg Seaborgium, ground level 0
  107: "[Rn].5f14.6d5.7s2", // Bh Bohrium, ground level 5/2
  108: "[Rn].5f14.6d6.7s2", // Hs Hassium, ground level 4
};
