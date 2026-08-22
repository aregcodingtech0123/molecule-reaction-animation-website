"""RDKit 3D coordinate generation with MMFF94 / UFF energy minimization."""

from __future__ import annotations

import uuid
from typing import Any

from rdkit import Chem
from rdkit.Chem import AllChem, rdMolDescriptors

from app.services.smiles_parser import infer_molecule_name


class ChemistryError(Exception):
    def __init__(self, message: str, code: str = "CHEMISTRY_ERROR") -> None:
        super().__init__(message)
        self.code = code


def _optimize_geometry(mol: Chem.Mol) -> str:
    """Embed 3D coords and minimize energy. Returns force field name used."""
    params = AllChem.ETKDGv3()
    params.randomSeed = 0xF00D
    params.useRandomCoords = True

    embed_code = AllChem.EmbedMolecule(mol, params)
    if embed_code != 0:
        raise ChemistryError("Failed to embed 3D coordinates from SMILES.", "EMBED_FAILED")

    if AllChem.MMFFHasAllMoleculeParams(mol):
        ff_result = AllChem.MMFFOptimizeMolecule(mol, maxIters=500)
        if ff_result != 0:
            raise ChemistryError("MMFF94 minimization did not converge.", "MINIMIZE_FAILED")
        return "MMFF94"

    uff_result = AllChem.UFFOptimizeMolecule(mol, maxIters=500)
    if uff_result != 0:
        raise ChemistryError("UFF minimization did not converge.", "MINIMIZE_FAILED")
    return "UFF"


def build_molecule_from_smiles(
    smiles: str,
    *,
    prompt: str = "",
    name: str | None = None,
) -> tuple[dict[str, Any], str]:
    """
    Parse SMILES, add hydrogens, generate minimized 3D structure,
    and serialize to frontend-compatible atom/bond arrays.
    """
    mol = Chem.MolFromSmiles(smiles)
    if mol is None:
        raise ChemistryError("Invalid SMILES string.", "INVALID_SMILES")

    mol = Chem.AddHs(mol)
    force_field = _optimize_geometry(mol)

    conf = mol.GetConformer()
    atoms: list[dict[str, Any]] = []
    for idx, atom in enumerate(mol.GetAtoms()):
        pos = conf.GetAtomPosition(idx)
        atoms.append(
            {
                "id": f"a{idx + 1}",
                "element": atom.GetSymbol(),
                "position": [round(pos.x, 4), round(pos.y, 4), round(pos.z, 4)],
            }
        )

    bonds: list[dict[str, Any]] = []
    for bond_idx, bond in enumerate(mol.GetBonds()):
        order = int(bond.GetBondTypeAsDouble())
        if order not in (1, 2, 3):
            order = 1
        bonds.append(
            {
                "id": f"b{bond_idx + 1}",
                "from": f"a{bond.GetBeginAtomIdx() + 1}",
                "to": f"a{bond.GetEndAtomIdx() + 1}",
                "order": order,
            }
        )

    formula = rdMolDescriptors.CalcMolFormula(mol)
    molecule_name = name or infer_molecule_name(prompt, smiles)

    molecule = {
        "id": f"ai-{uuid.uuid4()}",
        "name": molecule_name,
        "formula": formula,
        "description": "AI-generated 3D structure optimized with RDKit force field.",
        "category": "organic",
        "atoms": atoms,
        "bonds": bonds,
    }

    return molecule, force_field
