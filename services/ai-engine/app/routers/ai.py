from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from app.schemas import ErrorResponse, GenerateMoleculeRequest, GenerateMoleculeResponse
from app.services.billing_client import BillingError, ensure_credits_and_deduct
from app.services.gemini_client import generate_molecule_text
from app.services.rdkit_geometry import ChemistryError, build_molecule_from_smiles
from app.services.smiles_parser import extract_smiles, strip_smiles_tags

router = APIRouter(prefix="/ai", tags=["ai"])


@router.get("/health")
async def ai_health() -> dict[str, str | bool]:
    return {"success": True, "service": "ai-engine", "status": "ok"}


@router.post(
    "/generate-molecule",
    response_model=GenerateMoleculeResponse,
    responses={
        400: {"model": ErrorResponse},
        402: {"model": ErrorResponse},
        502: {"model": ErrorResponse},
        503: {"model": ErrorResponse},
    },
)
async def generate_molecule(body: GenerateMoleculeRequest) -> GenerateMoleculeResponse:
    credits_deducted: int | None = None

    if body.user_id:
        try:
            credits_deducted = await ensure_credits_and_deduct(body.user_id)
        except BillingError as err:
            raise HTTPException(
                status_code=err.status_code,
                detail={"success": False, "error": str(err), "code": err.code},
            ) from err

    try:
        raw_message = await generate_molecule_text(body.prompt)
    except RuntimeError as err:
        raise HTTPException(
            status_code=503,
            detail={"success": False, "error": str(err), "code": "GEMINI_UNAVAILABLE"},
        ) from err
    except Exception as err:
        raise HTTPException(
            status_code=502,
            detail={"success": False, "error": "Gemini request failed.", "code": "GEMINI_ERROR"},
        ) from err

    smiles = extract_smiles(raw_message)
    if not smiles:
        raise HTTPException(
            status_code=400,
            detail={
                "success": False,
                "error": "Model response did not include a valid <SMILES>...</SMILES> tag.",
                "code": "SMILES_MISSING",
            },
        )

    display_message = strip_smiles_tags(raw_message)

    try:
        molecule_dict, force_field = await asyncio.to_thread(
            build_molecule_from_smiles,
            smiles,
            prompt=body.prompt,
        )
    except ChemistryError as err:
        raise HTTPException(
            status_code=400,
            detail={"success": False, "error": str(err), "code": err.code},
        ) from err

    return GenerateMoleculeResponse(
        data={
            "message": display_message,
            "smiles": smiles,
            "molecule": molecule_dict,
            "force_field": force_field,
            "credits_deducted": credits_deducted,
        }
    )
