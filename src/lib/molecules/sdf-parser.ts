import { MoleculeData, AtomData, BondData, ElementSymbol, BondOrder } from "./types";

export async function fetchMoleculeFromSMILES(smiles: string, name: string = "Custom Molecule"): Promise<MoleculeData | null> {
  try {
    // Use PubChem for robust force-field energy minimized 3D coordinates
    const url = `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/smiles/${encodeURIComponent(smiles)}/SDF?record_type=3d`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const sdfText = await res.text();
    return parseSDF(sdfText, name, smiles);
  } catch (error) {
    console.error("Failed to fetch/parse SDF from PubChem:", error);
    return null;
  }
}

function parseSDF(sdf: string, name: string, formula: string): MoleculeData {
  const lines = sdf.split(/\r?\n/);
  
  // Line 4 contains counts
  const countsLine = lines[3];
  if (!countsLine) throw new Error("Invalid SDF format");

  const atomCount = parseInt(countsLine.substring(0, 3).trim(), 10);
  const bondCount = parseInt(countsLine.substring(3, 6).trim(), 10);

  const atoms: AtomData[] = [];
  const bonds: BondData[] = [];

  // Parse atoms (starts at line 4)
  const atomStartIndex = 4;
  for (let i = 0; i < atomCount; i++) {
    const line = lines[atomStartIndex + i];
    const x = parseFloat(line.substring(0, 10).trim());
    const y = parseFloat(line.substring(10, 20).trim());
    const z = parseFloat(line.substring(20, 30).trim());
    const element = line.substring(31, 34).trim() as ElementSymbol;
    
    atoms.push({
      id: `a${i + 1}`,
      element,
      position: [x, y, z]
    });
  }

  // Parse bonds
  const bondStartIndex = atomStartIndex + atomCount;
  for (let i = 0; i < bondCount; i++) {
    const line = lines[bondStartIndex + i];
    const atom1Idx = parseInt(line.substring(0, 3).trim(), 10);
    const atom2Idx = parseInt(line.substring(3, 6).trim(), 10);
    const type = parseInt(line.substring(6, 9).trim(), 10);
    
    bonds.push({
      id: `b${i + 1}`,
      from: `a${atom1Idx}`,
      to: `a${atom2Idx}`,
      order: type as BondOrder
    });
  }

  return {
    id: `custom-${Date.now()}`,
    name,
    formula,
    description: "Dynamically generated molecule from user request.",
    category: "simple", // Default category
    atoms,
    bonds,
    education: {
      state: "solid",
      color: "#10b981", // Emerald green for dynamic molecules
      bondTypes: [],
      uses: [],
      funFacts: [],
      molecularWeight: "Unknown"
    }
  };
}
