# MoleculeStudio Auth & Billing Service

Unified Express + TypeScript microservice using raw `pg` against the core PostgreSQL schema.

## Initialize

```bash
# From repo root — start local Postgres (isolated from Supabase)
npm run docker:up

cd services/auth-billing-service
npm install
cp .env.example .env
# Keep LOCAL DATABASE_URL pointing at Docker (see comments in .env.example)

npm run db:setup   # applies database/init/001 → 005
npm run dev
```

Wipe local schema only: `npm run db:reset`  
Wipe Docker volume too: from root `npm run docker:reset` then `npm run db:setup`
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
