# MoleculeStudio Auth Service

Isolated Node.js/Express microservice for registration, login, JWT sessions, and profile state.

## Quick start

```bash
cd services/auth-service
cp .env.example .env
npm install
npm run db:generate
npm run db:push
npm run dev
```

## Environment

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Min 32 chars — HS256 signing key |
| `JWT_EXPIRES_IN` | Token TTL (default `7d`) |
| `BCRYPT_ROUNDS` | 10–14 (default `12`) |
| `SIGNUP_CREDIT_AMOUNT` | Free credits on register (default `10`) |
| `BILLING_SERVICE_URL` | Optional billing sync endpoint |

## API

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/auth/register` | — | Create user + profile + signup credits |
| `POST` | `/auth/login` | — | Return signed JWT |
| `GET` | `/auth/me` | Bearer JWT | Current profile |
| `GET` | `/health` | — | Liveness |

## Next.js BFF gateway

```bash
# .env.local (Next.js app root)
AUTH_SERVICE_URL=http://localhost:4001/auth
```

| Frontend | Proxied to |
|----------|------------|
| `POST /api/auth/register` | `http://localhost:4001/auth/register` |
| `POST /api/auth/login` | `http://localhost:4001/auth/login` |
| `GET /api/auth/me` | `http://localhost:4001/auth/me` |

The gateway forwards the `Authorization: Bearer <jwt>` header unchanged.

## Security

- Passwords hashed with **bcrypt**
- JWT claims: `sub`, `email`, `role`, `jti` (session audit)
- Sessions stored in `session_tokens` for revocation checks
- Signup credits recorded in `credit_events` outbox → optional billing sync
- Rate limiting on `/auth/*` routes
- Helmet + CORS + structured JSON errors

## Register example

```bash
curl -X POST http://localhost:4001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@molecule.studio","password":"SecurePass1","displayName":"Demo"}'
```

## Login + /me example

```bash
TOKEN=$(curl -s -X POST http://localhost:4001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"demo@molecule.studio","password":"SecurePass1"}' | jq -r '.data.token')

curl http://localhost:4001/auth/me -H "Authorization: Bearer $TOKEN"
```
