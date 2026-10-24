> ⚠️ **LEGACY — not wired into the running stack, kept for reference, pending removal.** See [LEGACY.md](./LEGACY.md).

# MoleculeStudio AI Engine

FastAPI microservice: Gemini prompt-to-SMILES → RDKit 3D optimization (MMFF94/UFF).

## Quick start

```bash
cd services/ai-engine
python -m venv .venv

# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt
cp .env.example .env   # set GEMINI_API_KEY
python run.py
```

Service listens on `http://localhost:8000`.

## API

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/ai/generate-molecule` | Prompt → Gemini → SMILES → RDKit 3D |
| `GET` | `/ai/health` | Service health |
| `GET` | `/health` | Liveness |

### Request

```json
{
  "prompt": "Show me the structure of caffeine",
  "user_id": "optional-uuid-for-billing"
}
```

### Response

```json
{
  "success": true,
  "data": {
    "message": "Markdown educational text (SMILES tags stripped)",
    "smiles": "CN1C=NC2=C1C(=O)N(C(=O)N2C)C",
    "force_field": "MMFF94",
    "molecule": {
      "id": "ai-…",
      "name": "Show me the structure of caffeine",
      "formula": "C8H10N4O2",
      "atoms": [{ "id": "a1", "element": "C", "position": [x, y, z] }],
      "bonds": [{ "id": "b1", "from": "a1", "to": "a2", "order": 1 }]
    }
  }
}
```

## Gateway (Next.js BFF)

```bash
AI_ENGINE_URL=http://localhost:8000/ai
```

| Frontend | Proxied to |
|----------|------------|
| `POST /api/ai/generate-molecule` | `http://localhost:8000/ai/generate-molecule` |

## RDKit pipeline

1. `MolFromSmiles` → `AddHs`
2. `ETKDGv3` 3D embedding
3. `MMFFOptimizeMolecule` (fallback: `UFFOptimizeMolecule`)
4. Serialize atoms/bonds for the Three.js renderer

## Billing (optional)

When `user_id` is provided and billing env vars are set, the service checks balance and deducts credits before calling Gemini.
