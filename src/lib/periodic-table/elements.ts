import type { AtomicMassKind, ChemicalElement, ElementCategory, GridPosition } from "./types";

type ElementSeed = [
  number,
  string,
  string,
  number,
  ElementCategory,
  string,
  number,
  number | null,
];

/** Standard 18-column periodic table coordinates (1-indexed). */
function buildGridPositions(): Map<number, GridPosition> {
  const map = new Map<number, GridPosition>();

  const place = (atomicNumber: number, row: number, col: number) => {
    map.set(atomicNumber, { row, col });
  };

  place(1, 1, 1);
  place(2, 1, 18);

  const row2 = [3, 4, null, null, null, null, null, null, null, null, null, null, 5, 6, 7, 8, 9, 10];
  row2.forEach((z, i) => {
    if (z) place(z, 2, i + 1);
  });

  const row3 = [11, 12, null, null, null, null, null, null, null, null, null, null, 13, 14, 15, 16, 17, 18];
  row3.forEach((z, i) => {
    if (z) place(z, 3, i + 1);
  });

  const row4 = [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36];
  row4.forEach((z, i) => place(z, 4, i + 1));

  const row5 = [37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54];
  row5.forEach((z, i) => place(z, 5, i + 1));

  const row6 = [55, 56, 57, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86];
  row6.forEach((z, i) => place(z, 6, i + 1));

  const row7 = [87, 88, 89, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118];
  row7.forEach((z, i) => place(z, 7, i + 1));

  for (let i = 0; i < 14; i++) {
    place(58 + i, 8, 4 + i);
  }

  for (let i = 0; i < 14; i++) {
    place(90 + i, 9, 4 + i);
  }

  return map;
}

const GRID_POSITIONS = buildGridPositions();

/** Elements with no stable isotope and hence no standard atomic weight: their number is a mass number (SEO-19). */
const NO_STANDARD_WEIGHT = new Set([43, 61, 84, 85, 86, 87, 88, 89, ...Array.from({ length: 26 }, (_, i) => 93 + i)]);

const ELEMENT_SEEDS: ElementSeed[] = [
  [1, "H", "Hydrogen", 1.008, "nonmetal", "The lightest element — a colorless gas that fuels stars and forms the backbone of water and organic chemistry.", 1, 1],
  [2, "He", "Helium", 4.003, "noble-gas", "A chemically inert noble gas, second only to hydrogen in cosmic abundance, used in cryogenics and lifting balloons.", 1, 18],
  [3, "Li", "Lithium", 6.94, "alkali-metal", "The lightest metal, essential for high-energy rechargeable batteries and mood-stabilizing compounds.", 2, 1],
  [4, "Be", "Beryllium", 9.012, "alkaline-earth-metal", "A lightweight, stiff metal used in aerospace alloys and X-ray windows due to its transparency to radiation.", 2, 2],
  [5, "B", "Boron", 10.81, "metalloid", "A hard metalloid found in borosilicate glass and semiconductors, vital for heat-resistant materials.", 2, 13],
  [6, "C", "Carbon", 12.011, "nonmetal", "The foundation of all known life — forms diamond, graphite, and millions of organic molecules.", 2, 14],
  [7, "N", "Nitrogen", 14.007, "nonmetal", "Makes up 78% of Earth's atmosphere; essential for proteins, DNA, and industrial ammonia production.", 2, 15],
  [8, "O", "Oxygen", 15.999, "nonmetal", "A highly reactive nonmetal required for respiration and combustion — the most abundant element in Earth's crust by mass.", 2, 16],
  [9, "F", "Fluorine", 18.998, "halogen", "The most electronegative element — a pale yellow gas used in toothpaste, Teflon, and uranium enrichment.", 2, 17],
  [10, "Ne", "Neon", 20.18, "noble-gas", "A noble gas famed for vivid orange-red discharge tubes in neon signage.", 2, 18],
  [11, "Na", "Sodium", 22.99, "alkali-metal", "A reactive soft metal — table salt's partner ion, crucial for nerve impulses and fluid balance.", 3, 1],
  [12, "Mg", "Magnesium", 24.305, "alkaline-earth-metal", "A lightweight structural metal at the heart of chlorophyll and many high-strength alloys.", 3, 2],
  [13, "Al", "Aluminum", 26.982, "post-transition-metal", "Abundant, corrosion-resistant metal used in aircraft, packaging, and modern architecture.", 3, 13],
  [14, "Si", "Silicon", 28.085, "metalloid", "The backbone of semiconductors and computer chips — also the second-most abundant crustal element.", 3, 14],
  [15, "P", "Phosphorus", 30.974, "nonmetal", "Essential for DNA, ATP energy currency, and fertilizers that sustain global agriculture.", 3, 15],
  [16, "S", "Sulfur", 32.06, "nonmetal", "A yellow solid vital for proteins, vulcanized rubber, and sulfuric acid — one of industry’s most-produced chemicals.", 3, 16],
  [17, "Cl", "Chlorine", 35.45, "halogen", "A greenish disinfectant gas used in water purification and PVC plastic production.", 3, 17],
  [18, "Ar", "Argon", 39.948, "noble-gas", "An inert shielding gas for welding and a common fill gas inside incandescent bulbs.", 3, 18],
  [19, "K", "Potassium", 39.098, "alkali-metal", "A key electrolyte for cellular function and a staple in fertilizers and glass production.", 4, 1],
  [20, "Ca", "Calcium", 40.078, "alkaline-earth-metal", "Structural mineral in bones and shells — also critical in cement, steel, and cheese-making.", 4, 2],
  [21, "Sc", "Scandium", 44.956, "transition-metal", "A light transition metal that strengthens aluminum alloys for aerospace and sports equipment.", 4, 3],
  [22, "Ti", "Titanium", 47.867, "transition-metal", "Exceptional strength-to-weight ratio — used in implants, aircraft, and corrosion-resistant coatings.", 4, 4],
  [23, "V", "Vanadium", 50.942, "transition-metal", "Hardens steel for tools and springs; also explored for high-capacity flow batteries.", 4, 5],
  [24, "Cr", "Chromium", 51.996, "transition-metal", "Delivers stainless steel's corrosion resistance and brilliant electroplated finishes.", 4, 6],
  [25, "Mn", "Manganese", 54.938, "transition-metal", "Essential for steel production and a biological cofactor in photosynthesis.", 4, 7],
  [26, "Fe", "Iron", 55.845, "transition-metal", "The workhorse metal of civilization — core of hemoglobin and the backbone of modern infrastructure.", 4, 8],
  [27, "Co", "Cobalt", 58.933, "transition-metal", "Gives blue pigment to glass and ceramics; central to lithium-ion battery cathodes.", 4, 9],
  [28, "Ni", "Nickel", 58.693, "transition-metal", "Corrosion-resistant metal used in coins, stainless alloys, and battery electrodes.", 4, 10],
  [29, "Cu", "Copper", 63.546, "transition-metal", "One of the first metals worked by humans — unmatched electrical and thermal conductivity.", 4, 11],
  [30, "Zn", "Zinc", 65.38, "transition-metal", "Protects steel via galvanization and is essential for immune function and enzyme activity.", 4, 12],
  [31, "Ga", "Gallium", 69.723, "post-transition-metal", "Melts in your hand — critical for LEDs, semiconductors, and solar cells.", 4, 13],
  [32, "Ge", "Germanium", 72.63, "metalloid", "A semiconductor pioneer used in fiber optics, infrared optics, and transistor history.", 4, 14],
  [33, "As", "Arsenic", 74.922, "metalloid", "A notorious metalloid with a long history in pigments, pesticides, and semiconductors.", 4, 15],
  [34, "Se", "Selenium", 78.971, "nonmetal", "A photoconductive nonmetal used in photocopiers, glass decolorization, and nutrition.", 4, 16],
  [35, "Br", "Bromine", 79.904, "halogen", "A dense red-brown liquid halogen used in flame retardants and photographic chemistry.", 4, 17],
  [36, "Kr", "Krypton", 83.798, "noble-gas", "A noble gas used in high-performance lighting and lithography lasers.", 4, 18],
  [37, "Rb", "Rubidium", 85.468, "alkali-metal", "An ultrafast-reacting alkali metal used in atomic clocks and specialty glasses.", 5, 1],
  [38, "Sr", "Strontium", 87.62, "alkaline-earth-metal", "Burns crimson in fireworks and flares and is a key ingredient of ferrite magnets.", 5, 2],
  [39, "Y", "Yttrium", 88.906, "transition-metal", "Enables vivid phosphors in displays and high-temperature superconductor research.", 5, 3],
  [40, "Zr", "Zirconium", 91.224, "transition-metal", "Extremely corrosion-resistant — used in nuclear reactor cladding and surgical implants.", 5, 4],
  [41, "Nb", "Niobium", 92.906, "transition-metal", "Strengthens superalloys for jet engines and enables superconducting magnets.", 5, 5],
  [42, "Mo", "Molybdenum", 95.95, "transition-metal", "A high-melting catalyst metal essential for enzymes and high-strength steel.", 5, 6],
  [43, "Tc", "Technetium", 98, "transition-metal", "The lightest element with no stable isotopes — widely used in medical diagnostic imaging.", 5, 7],
  [44, "Ru", "Ruthenium", 101.07, "transition-metal", "A rare platinum-group metal hardening electrical contacts and catalyzing reactions.", 5, 8],
  [45, "Rh", "Rhodium", 102.906, "transition-metal", "Extraordinarily reflective and catalytic — key in automotive exhaust catalysts.", 5, 9],
  [46, "Pd", "Palladium", 106.42, "transition-metal", "Absorbs hydrogen and catalyzes organic reactions — vital in electronics and jewelry.", 5, 10],
  [47, "Ag", "Silver", 107.868, "transition-metal", "The best conductor of electricity — prized for jewelry, optics, and antimicrobial coatings.", 5, 11],
  [48, "Cd", "Cadmium", 112.414, "transition-metal", "Used in Ni-Cd batteries and pigments, though now restricted due to toxicity.", 5, 12],
  [49, "In", "Indium", 114.818, "post-transition-metal", "Creates transparent conductive coatings on touchscreens and LCD displays.", 5, 13],
  [50, "Sn", "Tin", 118.71, "post-transition-metal", "Ancient solder metal — still essential for electronics and corrosion-resistant coatings.", 5, 14],
  [51, "Sb", "Antimony", 121.76, "metalloid", "A brittle metalloid in flame retardants, semiconductors, and lead-acid batteries.", 5, 15],
  [52, "Te", "Tellurium", 127.6, "metalloid", "A rare metalloid improving steel machinability and enabling thermoelectric devices.", 5, 16],
  [53, "I", "Iodine", 126.904, "halogen", "Essential for thyroid hormones and a dark-violet solid that serves as an antiseptic in medicine.", 5, 17],
  [54, "Xe", "Xenon", 131.293, "noble-gas", "A noble gas used in ion propulsion, anesthesia, and high-intensity lamps.", 5, 18],
  [55, "Cs", "Cesium", 132.905, "alkali-metal", "Defines the SI second in atomic clocks — extremely reactive and photoelectric.", 6, 1],
  [56, "Ba", "Barium", 137.327, "alkaline-earth-metal", "Green fireworks colorant and contrast agent in medical X-ray imaging.", 6, 2],
  [57, "La", "Lanthanum", 138.905, "lanthanide", "Gateway to the lanthanide series — used in camera lenses and petroleum refining catalysts.", 6, 3],
  [58, "Ce", "Cerium", 140.116, "lanthanide", "The most abundant rare earth — sparks in lighters and polishes glass.", 6, null],
  [59, "Pr", "Praseodymium", 140.908, "lanthanide", "Creates intense yellow-green glass and magnets in hybrid vehicles.", 6, null],
  [60, "Nd", "Neodymium", 144.242, "lanthanide", "Powers the strongest permanent magnets in headphones, motors, and wind turbines.", 6, null],
  [61, "Pm", "Promethium", 145, "lanthanide", "A radioactive lanthanide used in luminous paint and nuclear batteries.", 6, null],
  [62, "Sm", "Samarium", 150.36, "lanthanide", "Forms high-temperature magnets and absorbs neutrons in nuclear reactors.", 6, null],
  [63, "Eu", "Europium", 151.964, "lanthanide", "Produces the red and blue phosphors in television and LED displays.", 6, null],
  [64, "Gd", "Gadolinium", 157.25, "lanthanide", "Enhances MRI contrast and sits in the middle of the lanthanide series.", 6, null],
  [65, "Tb", "Terbium", 158.925, "lanthanide", "Enables green phosphors and magnetostrictive alloys in actuators.", 6, null],
  [66, "Dy", "Dysprosium", 162.5, "lanthanide", "Critical for high-temperature neodymium magnets in electric vehicles.", 6, null],
  [67, "Ho", "Holmium", 164.93, "lanthanide", "Has one of the highest magnetic moments of any element — used in powerful magnets.", 6, null],
  [68, "Er", "Erbium", 167.259, "lanthanide", "Amplifies fiber-optic signals in telecommunications lasers.", 6, null],
  [69, "Tm", "Thulium", 168.934, "lanthanide", "A rare lanthanide used in portable X-ray devices and lasers.", 6, null],
  [70, "Yb", "Ytterbium", 173.054, "lanthanide", "Its atoms drive some of the most precise optical atomic clocks, and it is used in fiber lasers.", 6, null],
  [71, "Lu", "Lutetium", 174.967, "lanthanide", "The heaviest and hardest lanthanide — used in PET scan detectors.", 6, null],
  [72, "Hf", "Hafnium", 178.49, "transition-metal", "Absorbs neutrons in nuclear control rods and improves superalloys.", 6, 4],
  [73, "Ta", "Tantalum", 180.948, "transition-metal", "Forms compact, reliable capacitors in smartphones and medical implants.", 6, 5],
  [74, "W", "Tungsten", 183.84, "transition-metal", "Highest melting point of all metals — filaments, cutting tools, and armor-piercing rounds.", 6, 6],
  [75, "Re", "Rhenium", 186.207, "transition-metal", "One of the densest metals — strengthens superalloys in jet engine turbines.", 6, 7],
  [76, "Os", "Osmium", 190.23, "transition-metal", "Together with iridium, the densest naturally occurring element — used in fountain pen tips and microscopy stains.", 6, 8],
  [77, "Ir", "Iridium", 192.217, "transition-metal", "Extremely corrosion-resistant — the former kilogram prototype was a platinum–iridium alloy, and an iridium-rich layer marks the asteroid impact 66 million years ago.", 6, 9],
  [78, "Pt", "Platinum", 195.084, "transition-metal", "A noble catalyst metal for fuel cells, jewelry, and automotive emissions control.", 6, 10],
  [79, "Au", "Gold", 196.967, "transition-metal", "Inert, malleable, and eternally valued — excels in electronics, dentistry, and finance.", 6, 11],
  [80, "Hg", "Mercury", 200.592, "transition-metal", "The only liquid metal at room temperature — historic in thermometers and amalgams.", 6, 12],
  [81, "Tl", "Thallium", 204.38, "post-transition-metal", "A toxic heavy metal once used in rat poison and now in specialty electronics.", 6, 13],
  [82, "Pb", "Lead", 207.2, "post-transition-metal", "Dense and malleable — ancient plumbing metal now phased out due to neurotoxicity.", 6, 14],
  [83, "Bi", "Bismuth", 208.98, "post-transition-metal", "Low-toxicity heavy metal in pharmaceuticals and colorful crystalline cosmetics.", 6, 15],
  [84, "Po", "Polonium", 209, "metalloid", "A highly radioactive metalloid discovered by Marie and Pierre Curie — used in anti-static devices.", 6, 16],
  [85, "At", "Astatine", 210, "halogen", "Among the rarest naturally occurring elements — a radioactive halogen with fleeting chemistry.", 6, 17],
  [86, "Rn", "Radon", 222, "noble-gas", "A radioactive noble gas accumulating in basements — a leading indoor air hazard.", 6, 18],
  [87, "Fr", "Francium", 223, "alkali-metal", "The most unstable alkali metal — exists only in trace amounts from radioactive decay.", 7, 1],
  [88, "Ra", "Radium", 226, "alkaline-earth-metal", "A luminous radioactive alkaline earth — historic in watch dials, now used in cancer therapy.", 7, 2],
  [89, "Ac", "Actinium", 227, "actinide", "Gateway to the actinide series — glows blue from ionizing radiation.", 7, 3],
  [90, "Th", "Thorium", 232.038, "actinide", "A fertile nuclear fuel alternative with high melting point and natural abundance.", 7, null],
  [91, "Pa", "Protactinium", 231.036, "actinide", "A scarce, radioactive actinide intermediate in uranium decay chains.", 7, null],
  [92, "U", "Uranium", 238.029, "actinide", "Powers nuclear reactors and weapons — the heaviest element found in meaningful natural abundance.", 7, null],
  [93, "Np", "Neptunium", 237, "actinide", "The first transuranic element — a byproduct of reactor operations.", 7, null],
  [94, "Pu", "Plutonium", 244, "actinide", "Largely synthetic fissile fuel for reactors and nuclear devices — extremely toxic and regulated.", 7, null],
  [95, "Am", "Americium", 243, "actinide", "Ionizes air in household smoke detectors — a practical transuranic element.", 7, null],
  [96, "Cm", "Curium", 247, "actinide", "Named for Marie and Pierre Curie — its isotope curium-244 powers the alpha-particle X-ray spectrometers on Mars rovers.", 7, null],
  [97, "Bk", "Berkelium", 247, "actinide", "Synthesized at Berkeley — used to discover heavier elements.", 7, null],
  [98, "Cf", "Californium", 251, "actinide", "A potent neutron emitter for cancer treatment and oil well logging.", 7, null],
  [99, "Es", "Einsteinium", 252, "actinide", "Created in hydrogen bomb debris — studied only in microscopic quantities.", 7, null],
  [100, "Fm", "Fermium", 257, "actinide", "Named for Enrico Fermi — too unstable for macroscopic applications.", 7, null],
  [101, "Md", "Mendelevium", 258, "actinide", "Honors Dmitri Mendeleev — produced atom-by-atom in particle accelerators.", 7, null],
  [102, "No", "Nobelium", 259, "actinide", "Named for Alfred Nobel — even its longest-lived known isotope has a half-life of only about an hour.", 7, null],
  [103, "Lr", "Lawrencium", 266, "actinide", "Closes the actinide row — chemistry bridges transition metals and actinides.", 7, null],
  [104, "Rf", "Rutherfordium", 267, "transition-metal", "Honors Ernest Rutherford — a superheavy element with fleeting half-lives.", 7, 4],
  [105, "Db", "Dubnium", 268, "transition-metal", "Named for Dubna, Russia — studied only as individual atoms.", 7, 5],
  [106, "Sg", "Seaborgium", 269, "transition-metal", "Named for Glenn Seaborg — the first element named for a person who was still alive.", 7, 6],
  [107, "Bh", "Bohrium", 270, "transition-metal", "Honors Niels Bohr — short-lived: its longest-lived known isotope has a half-life of about a minute.", 7, 7],
  [108, "Hs", "Hassium", 270, "transition-metal", "Named for the German state of Hesse — predicted to resemble osmium chemically.", 7, 8],
  [109, "Mt", "Meitnerium", 278, "transition-metal", "Honors Lise Meitner — exists only in particle accelerator collisions.", 7, 9],
  [110, "Ds", "Darmstadtium", 281, "transition-metal", "First synthesized in Darmstadt — chemistry remains largely unexplored.", 7, 10],
  [111, "Rg", "Roentgenium", 282, "transition-metal", "Honors Wilhelm Röntgen, discoverer of X-rays.", 7, 11],
  [112, "Cn", "Copernicium", 285, "transition-metal", "Named for Nicolaus Copernicus — may behave as a volatile metal or gas.", 7, 12],
  [113, "Nh", "Nihonium", 286, "post-transition-metal", "First element discovered in Asia (Nihon = Japan) — superheavy and synthetic.", 7, 13],
  [114, "Fl", "Flerovium", 289, "post-transition-metal", "Honors the Flerov Laboratory — possibly exhibits noble-gas-like inertness.", 7, 14],
  [115, "Mc", "Moscovium", 290, "post-transition-metal", "Named for Moscow Oblast — its longest-lived known isotopes decay within about a second.", 7, 15],
  [116, "Lv", "Livermorium", 293, "post-transition-metal", "Honors Lawrence Livermore National Laboratory — among the heaviest known elements.", 7, 16],
  [117, "Ts", "Tennessine", 294, "halogen", "Named for Tennessee — a synthetic halogen with unknown bulk properties.", 7, 17],
  [118, "Og", "Oganesson", 294, "noble-gas", "The heaviest confirmed element — predicted to behave unlike the lighter noble gases because of relativistic effects.", 7, 18],
];

export const ELEMENTS: ChemicalElement[] = ELEMENT_SEEDS.map(
  ([atomicNumber, symbol, name, atomicMass, category, description, period, group]) => {
    const grid = GRID_POSITIONS.get(atomicNumber);
    if (!grid) {
      throw new Error(`Missing grid position for element ${atomicNumber}`);
    }
    return {
      atomicNumber,
      symbol,
      name,
      atomicMass,
      atomicMassKind: (NO_STANDARD_WEIGHT.has(atomicNumber) ? "mass-number" : "standard-weight") satisfies AtomicMassKind,
      category,
      description,
      grid,
      period,
      group,
    };
  },
);

export const ELEMENT_BY_NUMBER = new Map(ELEMENTS.map((el) => [el.atomicNumber, el]));

export const GRID_ROWS = 9;
export const GRID_COLS = 18;

export type GridCell = ChemicalElement | "lanthanide-label" | "actinide-label" | null;

export function buildPeriodicGrid(): GridCell[][] {
  const grid: GridCell[][] = Array.from({ length: GRID_ROWS }, () =>
    Array.from({ length: GRID_COLS }, () => null),
  );

  for (const element of ELEMENTS) {
    grid[element.grid.row - 1][element.grid.col - 1] = element;
  }

  grid[7][2] = "lanthanide-label";
  grid[8][2] = "actinide-label";

  return grid;
}

export const DEFAULT_ELEMENT = ELEMENT_BY_NUMBER.get(6)!;
