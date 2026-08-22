# MoleculeStudio Billing Service

Double-entry credit ledger with Stripe checkout integration.

## Quick start

```bash
cd services/billing-service
cp .env.example .env
npm install
npm run db:generate
npm run db:push
npm run dev
```

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/billing/webhook` | Stripe signature | Credit pack purchase (`checkout.session.completed`) |
| `POST` | `/billing/deduct` | Internal API key | Atomic credit deduction for AI usage |
| `GET` | `/billing/balance/:userId` | Internal API key | Balance + `hasCredits` flag |
| `POST` | `/internal/credits/grant` | Internal API key | Signup bonus sync from auth-service |
| `GET` | `/health` | — | Liveness |

## Gateway (Next.js BFF)

```bash
BILLING_SERVICE_URL=http://localhost:4002/billing
```

| Frontend | Proxied to |
|----------|------------|
| `POST /api/billing/webhook` | `http://localhost:4002/billing/webhook` |
| `POST /api/billing/deduct` | `http://localhost:4002/billing/deduct` |
| `GET /api/billing/balance/:userId` | `http://localhost:4002/billing/balance/:userId` |

Internal auth header:

```http
X-Internal-Api-Key: <INTERNAL_API_KEY>
```

## Stripe checkout metadata

Set on Checkout Session creation:

```json
{
  "metadata": {
    "userId": "<uuid>",
    "creditAmount": "100"
  }
}
```

Or use `client_reference_id` for `userId`.

## Examples

**Deduct (AI engine):**

```bash
curl -X POST http://localhost:4002/billing/deduct \
  -H "Content-Type: application/json" \
  -H "X-Internal-Api-Key: $INTERNAL_API_KEY" \
  -d '{"userId":"...","amount":1,"reason":"ai_molecule_generation","idempotencyKey":"gen-abc123"}'
```

**Balance check:**

```bash
curl http://localhost:4002/billing/balance/<userId> \
  -H "X-Internal-Api-Key: $INTERNAL_API_KEY"
```

## Ledger design

- `credit_accounts` — cached per-user balance
- `ledger_transactions` — idempotent transaction groups
- `ledger_entries` — balanced DEBIT/CREDIT legs (user ↔ platform suspense)
- Deductions use `updateMany … balance >= amount` inside a DB transaction to prevent race conditions
