import re

SMILES_TAG_RE = re.compile(r"<SMILES>([\s\S]*?)</SMILES>", re.IGNORECASE)


def extract_smiles(text: str) -> str | None:
    match = SMILES_TAG_RE.search(text)
    if not match:
        return None
    candidate = match.group(1).strip()
    return candidate or None


def strip_smiles_tags(text: str) -> str:
    return SMILES_TAG_RE.sub("", text).strip()


def infer_molecule_name(prompt: str, smiles: str) -> str:
    cleaned = prompt.strip().rstrip("?.!")
    if len(cleaned) <= 80:
        return cleaned or "Generated Molecule"
    return f"Molecule ({smiles[:24]}…)" if len(smiles) > 24 else f"Molecule ({smiles})"
