"""Async Gemini API client for prompt-to-SMILES generation."""

from __future__ import annotations

import asyncio
from functools import lru_cache

from google import genai
from google.genai import types

from app.config import settings

MOLECULE_GENERATION_SYSTEM_INSTRUCTION = """You are the MoleculeStudio Cheminformatics Engine.

Given a user prompt about a chemical compound, you MUST:
1. Reply with clear, educational Markdown explaining the molecule (structure, properties, uses).
2. End your response with exactly one SMILES string wrapped in <SMILES>...</SMILES> tags.
3. Use a valid, canonical SMILES for the requested compound — no placeholders, no prose inside the tags.
4. Match the user's language in your explanatory text.
5. If the request is not chemistry-related, politely decline and do NOT emit <SMILES> tags.

Example format:
Caffeine is a methylxanthine alkaloid found in coffee...

<SMILES>CN1C=NC2=C1C(=O)N(C(=O)N2C)C</SMILES>

Never output SMILES outside the tags. Never include markdown code fences inside the tags."""


@lru_cache(maxsize=1)
def _get_client() -> genai.Client:
    if not settings.gemini_api_key:
        raise RuntimeError("GEMINI_API_KEY is not configured.")
    return genai.Client(api_key=settings.gemini_api_key)


def _generate_sync(prompt: str) -> str:
    client = _get_client()
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=[{"role": "user", "parts": [{"text": prompt.strip()}]}],
        config=types.GenerateContentConfig(
            system_instruction=MOLECULE_GENERATION_SYSTEM_INSTRUCTION,
            temperature=0.4,
        ),
    )

    text = (response.text or "").strip()
    if not text:
        raise RuntimeError("Gemini returned an empty response.")
    return text


async def generate_molecule_text(prompt: str) -> str:
    """Call Gemini asynchronously (SDK is sync — offloaded to a worker thread)."""
    return await asyncio.to_thread(_generate_sync, prompt)
