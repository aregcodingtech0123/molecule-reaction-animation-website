# MoleculeStudio Auth & Billing Service

Unified Express + TypeScript microservice using raw `pg` against the core PostgreSQL schema.

## Initialize

```bash
cd services/auth-billing-service
npm install
cp .env.example .env
# Edit .env — set DATABASE_URL and JWT_SECRET (32+ chars)

# Ensure DB schema is applied first:
# psql "$DATABASE_URL" -f ../../database/init/001_moleculestudio_core.sql

npm run dev
```

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/auth/register` | — | Create user, allocate 10 signup credits via `post_credit_transaction` |
| `POST` | `/api/auth/login` | — | Return JWT |
| `POST` | `/api/auth/google` | — | Verify Google ID token; register or sign in |
| `GET` | `/api/billing/balance` | Bearer JWT | Current credit balance |
| `GET` | `/health` | — | Liveness |

## Register example

```bash
curl -X POST http://localhost:4000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@molecule.studio","password":"SecurePass1"}'
```

## Balance example

```bash
curl http://localhost:4000/api/billing/balance \
  -H "Authorization: Bearer <jwt>"
```

## Google sign-in example

```bash
curl -X POST http://localhost:4000/api/auth/google \
  -H "Content-Type: application/json" \
  -d '{"idToken":"<google-id-token-from-frontend>"}'
```

Requires `GOOGLE_CLIENT_ID` in `.env` (Web client ID from Google Cloud Console).

## Signup transaction

Registration runs in a single SQL transaction:

1. `INSERT INTO users … RETURNING id`
2. `INSERT INTO user_balances (user_id, balance) VALUES (id, 0)` — seed row
3. `SELECT post_credit_transaction(id, 10, 'SIGNUP_BONUS', 'signup')` — allocates 10 credits + immutable ledger entry

Step 2 starts at `0` so step 3 does not double-count (the DB function increments balance by `+10`).
