# Molecule Architecture Studio

A premium interactive chemistry platform for exploring molecules in 3D, running AI-assisted lab sessions, and learning atomic structure — with accounts, credit-based billing, and a dual-theme design system (**Night Lab** / **White Lab**).

## Features

| Area | Description |
|------|-------------|
| **Explore** | Interactive 3D molecule canvas with structure panels and comparisons |
| **AI Lab** | Gemini-powered molecule generation gated by auth and credit balance |
| **Atom Models** | Timeline of historical atomic models with animated 3D scenes |
| **Periodic Table** | Full interactive table with element detail panel, orbit animation, and real-world views |
| **Dashboard** | Account overview, credit balance, transaction ledger, and checkout |
| **Auth** | Email/password registration & login, Google OAuth, JWT sessions |
| **Billing** | Credit packs via Lemon Squeezy MoR (USD); immutable PostgreSQL ledger |

## Architecture

```
Browser (Next.js 16, port 3000)
    │
    ├── /api/auth/*     ──BFF──► auth-billing-service :4000
    ├── /api/billing/*  ──BFF──► auth-billing-service :4000
    └── /api/chat       ──► Gemini (server-side, cookie session)

auth-billing-service (Express + TypeScript, internal :4000)
    ├── PostgreSQL (local Docker, Neon, or Supabase)
    └── Lemon Squeezy (USD MoR checkout + order_created webhook)
```

The Next.js app acts as a **BFF gateway** — the browser calls `/api/auth/*` and `/api/billing/*` on the same origin; route handlers proxy to the Express microservice. Sessions use an **httpOnly `session_token` cookie** (JWT is never stored in `localStorage`). The legacy `/api/ai/*` proxy has been **removed**; all AI traffic goes through secured `/api/chat`.

**Checkout must go through the API.** Do not share raw Lemon Squeezy store/product links for production purchases — those omit `custom_data` (`user_id`, `package_id`, `pending_order_id`). Always create checkouts via `POST /api/billing/checkout` so the webhook can attribute and credit the correct account.

## Tech Stack

**Frontend**
- Next.js 16 (App Router), React 19, TypeScript
- Three.js / React Three Fiber, Framer Motion
- Tailwind CSS 4, shadcn/ui primitives
- 12-locale i18n (EN, TR, DE, ES, FR, …)

**Backend**
- `services/auth-billing-service` — Express 5, `pg`, JWT, bcrypt, Lemon Squeezy, Google OAuth
- PostgreSQL 14+ with `post_credit_transaction()` ledger function (local Docker, Neon, or Supabase)

## Prerequisites

- Node.js 20+
- Docker Desktop (recommended for local Postgres) **or** PostgreSQL 14+ / Neon / Supabase
- [Lemon Squeezy](https://www.lemonsqueezy.com) store + API key + variants (USD MoR)
- [Google Cloud](https://console.cloud.google.com) OAuth Web client ID (optional, for Google sign-in)
- [Gemini API key](https://ai.google.dev) (for AI Lab)
- [ngrok](https://ngrok.com) (optional — local Lemon webhook testing against Express `:4000`)

## Quick Start

### 1. Clone and install the web app

```bash
npm install
cp .env.example .env
# Edit .env — see Environment Variables below
```

### 2. Local Postgres (Docker) + auth-billing service

```bash
# Start isolated local Postgres (never touches production Neon/Supabase)
npm run docker:up

cd services/auth-billing-service
npm install
cp .env.example .env
# Keep the LOCAL DATABASE_URL (Docker). Do not paste a production URI here for day-to-day dev.

npm run db:setup    # waits for health, creates DB if needed, applies every migration in database/init
npm run dev         # http://localhost:4000
```

**3-step local DB loop**

```bash
npm run docker:up                                          # 1. start Postgres
cd services/auth-billing-service && npm run db:setup       # 2. migrate
npm run dev                                                # 3. run Express (from service dir)
```

Wipe local data and re-migrate: `npm run docker:reset` then `npm run db:setup`  
Or SQL-only reset (refuses production URLs): `npm run db:reset` from the service folder.

#### Local Postgres 16 → 18

`docker-compose.yml` now runs `postgres:18-alpine` (production is PostgreSQL 18.6) on a **new** volume,
`molecule_studio_postgres18_data`. A PostgreSQL 16 data directory cannot be opened by 18, so your old volume
(`molecule_studio_postgres_data`) is left as it is. Pick one:

* **Start fresh** (local data is disposable): `npm run docker:up`, then `npm run db:setup` in the service folder.
* **Keep your local data** — dump it with the old 16 container *before* switching, then restore into 18:
  ```bash
  git stash                      # or check out a commit with the postgres:16 compose file
  docker compose up -d           # the old 16 container on the old volume
  docker exec molecule_studio_postgres pg_dumpall -U postgres > local-dev-backup.sql
  git stash pop                  # back to the postgres:18 compose file
  docker compose up -d           # recreates the container on 18 with the new, empty volume
  docker exec -i molecule_studio_postgres psql -U postgres < local-dev-backup.sql
  ```
  Keep `local-dev-backup.sql` out of git. Once you are happy, remove the old volume yourself:
  `docker volume rm molecule_studio_postgres_data`.

### 3. Run the full local stack (recommended)

From the repository root:

```bash
npm run db:setup    # once, after Docker is healthy
npm run dev:all     # tries docker:up, then Next (:3000) + Express (:4000)
```

`npm run dev` still starts **Next.js only**. Use `npm run dev:all:nodocker` if you want both apps without touching Docker.

> **Env changes require a restart.** After editing any `.env` file, stop and restart Next.js and/or `auth-billing-service` (or re-run `npm run dev:all`). Stale processes keep old `AUTH_SERVICE_URL` / `BILLING_SERVICE_URL` / Lemon keys and can surface mysterious 404s or failed checkouts.

### Switching to hosted Postgres (Neon / Supabase)

1. In `services/auth-billing-service/.env`, set `DATABASE_URL` to your hosted URI (`?sslmode=require`).
2. Migrations run through a tracked runner (`schema_migrations` table). Use a **direct** (non-pooled)
   connection for it — set `MIGRATION_DATABASE_URL` if `DATABASE_URL` points at a pooler; pooled URLs are refused.
3. A database created before the runner existed must be adopted once with `npm run db:migrate:baseline`
   (preview with `node scripts/migrate.mjs --baseline --dry-run`). See `docs/ops/PRODUCTION_RUNBOOK.md`.
4. `db:reset` refuses every non-local host; never run `docker:reset` against production.

#### Neon cold starts

Neon (and similar serverless Postgres) may **auto-suspend** idle databases. The first query after wake can take several seconds. The Lemon webhook **fast-acknowledge** design (below) returns `200 OK` *before* any DB work, so Neon cold-start latency does **not** cause Lemon deliveries to sit in “Pending” or time out. Credit allocation still runs in the background once the pool connects.

## Environment Variables

### Root `.env` (Next.js)

| Variable | Description |
|----------|-------------|
| `AUTH_SERVICE_URL` | BFF upstream, e.g. `http://localhost:4000/api/auth` |
| `BILLING_SERVICE_URL` | BFF upstream, e.g. `http://localhost:4000/api/billing` |
| `NEXT_PUBLIC_BILLING_SERVICE_URL` | Direct browser → Express billing API (checkout) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | Google Identity Services (must match backend) |
| `GEMINI_API_KEY` | Server-side Gemini for AI Lab |

### `services/auth-billing-service/.env`

| Variable | Description |
|----------|-------------|
| `DATABASE_URL` | Local Docker, Neon, or Supabase (see `.env.example`) |
| `JWT_SECRET` | At least 32 characters |
| `GOOGLE_CLIENT_ID` | Google OAuth Web client ID |
| `FRONTEND_URL` | e.g. `http://localhost:3000` (return URLs) |
| `LEMONSQUEEZY_API_KEY` / `LEMONSQUEEZY_STORE_ID` | Lemon Squeezy MoR (USD) |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | HMAC secret for `X-Signature` |
| `LEMONSQUEEZY_VARIANT_STARTER` / `_PRO` / `_ENTERPRISE` | Variant IDs (Starter $5/50, Pro $20/250, Studio $50/700) |

See `.env.example` files in each location for full templates (placeholders only — never commit real secrets).

## Payment gateway (Lemon Squeezy)

Lemon Squeezy is the **sole** payment provider (Merchant of Record, USD).

### Credit packs

| Package ID | Price | Credits | Env variant |
|------------|-------|---------|-------------|
| `starter` | $5 | 50 | `LEMONSQUEEZY_VARIANT_STARTER` |
| `pro` | $20 | 250 | `LEMONSQUEEZY_VARIANT_PRO` |
| `enterprise` | $50 | 700 | `LEMONSQUEEZY_VARIANT_ENTERPRISE` |

### Purchase flow

1. UI calls **`POST /api/billing/checkout`** `{ packageId }` (authenticated BFF → Express).
2. Express creates a Lemon checkout with `custom_data` (`user_id`, `package_id`, `pending_order_id`) and returns `checkoutUrl`.
3. Browser redirects to Lemon’s hosted checkout.
4. Lemon POSTs `order_created` to Express:
   `POST /api/billing/webhooks/lemonsqueezy`
5. After a verified webhook, credits are posted as `CREDIT_PURCHASE` via `post_credit_transaction()`.

> **Do not use raw store links in production.** Purchases that bypass `POST /api/billing/checkout` often arrive without `custom_data`. The webhook can still fall back to buyer email, but API checkout is required for reliable attribution.

### Webhook URL (Express only — not Next.js)

```text
POST https://YOUR_PUBLIC_HOST/api/billing/webhooks/lemonsqueezy
```

Subscribe to **`order_created`**. HMAC verification needs the **raw body** — expose `auth-billing-service` directly (or tunnel to **port 4000**). Do not route webhooks through a JSON-rewriting proxy or the Next.js BFF on port 3000.

### Local webhook testing (ngrok)

Tunnel **Express `:4000`**, not Next `:3000`:

```bash
ngrok http 4000 --domain=<your-static-domain>
```

Then set the Lemon dashboard webhook to:

```text
https://<your-static-domain>/api/billing/webhooks/lemonsqueezy
```

Signing secret in the dashboard must match `LEMONSQUEEZY_WEBHOOK_SECRET`.

### 3-stage webhook architecture (`auth-billing-service`)

```
Lemon POST /api/billing/webhooks/lemonsqueezy
        │
        ├─ Stage 1  Synchronous gate (crypto only)
        │           HMAC-SHA256(rawBody, LEMONSQUEEZY_WEBHOOK_SECRET)
        │           vs X-Signature (timingSafeEqual)
        │           ✗ mismatch → 401  (no DB)
        │
        ├─ Stage 2  Fast acknowledge
        │           200 OK  { "received: true" }   (~ms, before Postgres)
        │
        └─ Stage 3  setImmediate background fulfillment
                    resolve user → CREDIT_PURCHASE ledger write
```

| Stage | Behavior |
|-------|----------|
| **1 — Synchronous gate** | Verify `X-Signature` over the raw body. Invalid/missing signature → **401** immediately. **No database I/O.** |
| **2 — Fast acknowledge** | Respond **`200 { "received": true }`** before any Postgres work so Lemon leaves “Pending” quickly (insulates against Neon cold starts). |
| **3 — Async fulfillment** | `setImmediate` runs user resolution + idempotent `CREDIT_PURCHASE`. Failures are logged (`[Webhook] FAILED…`) and must be **replayed manually** from the Lemon dashboard (Lemon will not retry after a 200). |

### User resolution fallback

1. **Primary:** `meta.custom_data.user_id` when it is a valid UUID that exists in `users`.
2. **Fallback:** `data.attributes.user_email` → lookup by email if `custom_data` is missing, malformed, or points at an unknown user.

Package resolution prefers the Lemon **variant id** map, then falls back to `custom_data.package_id` (e.g. `"starter"`). Historical ledger rows may still carry legacy `provider` strings; the column is a plain `VARCHAR(32)`.

## Project Structure

```
├── src/
│   ├── app/                    # Next.js routes (explore, ai-lab, dashboard, pricing, …)
│   ├── app/api/                # BFF gateway handlers (not Lemon webhooks)
│   ├── components/             # UI, layout, billing, periodic-table, atom-models
│   ├── context/                # Auth, theme, language providers
│   └── lib/                    # i18n, theme tokens, billing, gateway, periodic-table data
├── services/
│   └── auth-billing-service/   # Auth + billing microservice (checkout + webhooks on :4000)
├── database/
│   └── init/                   # NNN_*.sql migrations (001–007 legacy, 008+ wrapped by the runner)
├── docker-compose.yml          # Local Postgres 18 (matches production)
└── .env.example
```

## Scripts

| Command | Location | Description |
|---------|----------|-------------|
| `npm run docker:up` | root | Start local Postgres (`postgres:18-alpine`) |
| `npm run docker:down` | root | Stop local Postgres (keeps volume) |
| `npm run docker:reset` | root | Wipe volume + recreate container |
| `npm run db:setup` | root or service | Create the DB if missing, then apply pending migrations (`001`→latest) via the tracked runner |
| `npm run db:migrate` | service | Apply pending migrations (`--dry-run` to preview) |
| `npm run db:migrate:status` | service | List applied / baselined / pending migrations |
| `npm run db:migrate:baseline` | service | Adopt a pre-runner database without re-running existing migrations |
| `npm run db:reconcile` | service | Read-only report: balances that differ from the ledger (exit 2 if any) |
| `npm run db:reset` | service | DROP/CREATE local DB + migrate (local hosts only: localhost / 127.0.0.1 / ::1 / docker) |
| `npm run dev` | root | Start Next.js only (`:3000`) |
| `npm run dev:all` | root | Ensure Docker (best-effort) + Next.js + auth-billing together |
| `npm run dev:all:nodocker` | root | Same pair without attempting Docker |
| `npm run build` | root | Production build |
| `npm run dev` | `services/auth-billing-service` | Start Express on port 4000 |

## Testing

Plan, findings and remediation status: [`docs/testing/TEST_PLAN.md`](docs/testing/TEST_PLAN.md) ·
[`docs/testing/FINDINGS.md`](docs/testing/FINDINGS.md) · [`docs/testing/TEST_CHANGES.md`](docs/testing/TEST_CHANGES.md).

Tests only ever touch a **local** Postgres whose database name contains `test`
(`scripts/test/db-guard.mjs`) and never call Lemon Squeezy, Google, Gemini or Resend
(`scripts/test/network-guard.mjs`).

```bash
cp .env.test.example .env.test   # once (only TEST_DATABASE_URL / E2E ports are read from it)
npm run test:db:up               # throwaway Postgres on 127.0.0.1:55432 (Docker, tmpfs)
npm test                         # frontend unit + BFF suites, then all service suites
npm run test:unit                # frontend (jsdom)
npm run test:api                 # BFF gateway + /api/chat against the real Express service
npm run test:db                  # service: migrations, ledger, concurrency
npm run test:e2e                 # Playwright (first time: npx playwright install chromium)
npm run test:coverage            # coverage for root and service
```

> `src/middleware.ts` uses the file convention Next.js 16 deprecated in favour of `proxy.ts`;
> it still works and is intentionally left as-is for now.

## Themes

Toggle **Night Lab** (dark) and **White Lab** (light) from the navbar. Theme tokens live in `src/lib/theme/config.ts`; components use `useTheme()` or Tailwind `dark:` variants (the `dark` class is synced to `night-lab`).

## License

Private — all rights reserved.
