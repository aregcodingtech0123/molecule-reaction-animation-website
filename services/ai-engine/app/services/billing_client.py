"""Optional billing pre-check and credit deduction."""

from __future__ import annotations

import uuid

import httpx

from app.config import settings


class BillingError(Exception):
    def __init__(self, message: str, code: str, status_code: int = 402) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code


async def ensure_credits_and_deduct(user_id: str, *, idempotency_key: str | None = None) -> int | None:
    if not settings.billing_service_url or not settings.internal_api_key:
        return None

    base = settings.billing_service_url.rstrip("/")
    headers = {
        "Content-Type": "application/json",
        "X-Internal-Api-Key": settings.internal_api_key,
    }
    deduct_key = idempotency_key or f"ai-gen-{user_id}-{uuid.uuid4()}"

    async with httpx.AsyncClient(timeout=10.0) as client:
        balance_res = await client.get(
            f"{base}/billing/balance/{user_id}",
            headers=headers,
        )
        if balance_res.status_code != 200:
            raise BillingError("Unable to verify credit balance.", "BILLING_UNAVAILABLE", 503)

        payload = balance_res.json()
        has_credits = payload.get("data", {}).get("hasCredits", False)
        if not has_credits:
            raise BillingError("Insufficient credits.", "INSUFFICIENT_CREDITS", 402)

        deduct_res = await client.post(
            f"{base}/billing/deduct",
            headers=headers,
            json={
                "userId": user_id,
                "amount": settings.credit_cost_per_generation,
                "reason": "ai_molecule_generation",
                "idempotencyKey": deduct_key,
            },
        )
        if deduct_res.status_code == 402:
            raise BillingError("Insufficient credits.", "INSUFFICIENT_CREDITS", 402)
        if deduct_res.status_code != 200:
            raise BillingError("Credit deduction failed.", "DEDUCT_FAILED", 503)

    return settings.credit_cost_per_generation
