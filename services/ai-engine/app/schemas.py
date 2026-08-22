from typing import Literal

from pydantic import BaseModel, Field


class GenerateMoleculeRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)
    user_id: str | None = Field(default=None, description="Optional user UUID for billing deduction")


class AtomOut(BaseModel):
    id: str
    element: str
    position: tuple[float, float, float]


class BondOut(BaseModel):
    id: str
    from_: str = Field(alias="from")
    to: str
    order: Literal[1, 2, 3]

    model_config = {"populate_by_name": True}


class MoleculeOut(BaseModel):
    id: str
    name: str
    formula: str
    description: str
    category: Literal["simple", "organic", "biological", "inorganic", "macro"] = "simple"
    atoms: list[AtomOut]
    bonds: list[BondOut]


class GenerateMoleculeData(BaseModel):
    message: str
    smiles: str
    molecule: MoleculeOut
    force_field: str
    credits_deducted: int | None = None


class GenerateMoleculeResponse(BaseModel):
    success: bool = True
    data: GenerateMoleculeData


class ErrorResponse(BaseModel):
    success: bool = False
    error: str
    code: str | None = None
