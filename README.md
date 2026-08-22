# Molecule Architecture Studio

A premium interactive chemistry platform for exploring molecules in 3D, running AI-assisted lab sessions, and learning atomic structure — with accounts, credit-based billing, and a dual-theme design system (**Night Lab** / **White Lab**).

## Features

| Area | Description |
|------|-------------|
| **Explore** | Interactive 3D molecule canvas with structure panels and comparisons |
| **AI Lab** | Gemini-powered molecule generation gated by auth and credit balance |
| **Atom Models** | Timeline of historical atomic models with animated 3D scenes |
| **Periodic Table** | Full interactive table with element detail panel, orbit animation, and real-world views |
| **Dashboard** | Account overview, credit balance, transaction ledger, and dual-gateway checkout |
| **Auth** | Email/password registration & login, Google OAuth, JWT sessions |
| **Billing** | Credit packs via Shopier (TRY) + Lemon Squeezy MoR (USD); immutable PostgreSQL ledger |

## Architecture

```
Browser (Next.js 16, port 3000)
    │
    ├── /api/auth/*     ──BFF──► auth-billing-service :4000
    ├── /api/billing/*  ──BFF──► auth-billing-service :4000
    └── /api/chat       ──► Gemini (server-side, cookie session)

auth-billing-service (Express + TypeScript, internal :4000)
    ├── PostgreSQL (molecule_studio_db)
    ├── Shopier (TR / TRY checkout + notify webhook)
    └── Lemon Squeezy (Global / USD MoR + order_created webhook)
```

The Next.js app acts as a **BFF gateway** — the browser calls `/api/auth/*` and `/api/billing/*` on the same origin; route handlers proxy to the Express microservice. Sessions use an **httpOnly `session_token` cookie** (JWT is never stored in `localStorage`). The legacy `/api/ai/*` proxy has been **removed**; all AI traffic goes through secured `/api/chat`.

## Tech Stack

**Frontend**
- Next.js 16 (App Router), React 19, TypeScript
- Three.js / React Three Fiber, Framer Motion
- Tailwind CSS 4, shadcn/ui primitives
- 12-locale i18n (EN, TR, DE, ES, FR, …)

**Backend**
- `services/auth-billing-service` — Express 5, `pg`, JWT, bcrypt, Shopier, Lemon Squeezy, Google OAuth
- PostgreSQL 14+ with `post_credit_transaction()` ledger function

## Prerequisites

- Node.js 20+
- PostgreSQL 14+
- [Shopier](https://www.shopier.com) API key/secret (Turkey / TRY)
- [Lemon Squeezy](https://www.lemonsqueezy.com) store + API key + variants (Global / USD MoR)
- [Google Cloud](https://console.cloud.google.com) OAuth Web client ID (optional, for Google sign-in)
- [Gemini API key](https://ai.google.dev) (for AI Lab)

## Quick Start

### 1. Clone and install the web app

```bash
npm install
cp .env.example .env
# Edit .env — see Environment Variables below
```

### 2. Set up the database and auth-billing service

```bash
cd services/auth-billing-service
npm install
cp .env.example .env
# Edit .env — DATABASE_URL, JWT_SECRET (32+ chars), Shopier + Lemon Squeezy keys, etc.

npm run db:setup    # creates molecule_studio_db + applies schema
npm run dev         # http://localhost:4000
```

### 3. Run the Next.js dev server

From the repository root:

```bash
npm run dev         # http://localhost:3000
```

Restart both processes after changing any `.env` file.

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
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | At least 32 characters |
| `GOOGLE_CLIENT_ID` | Google OAuth Web client ID |
| `FRONTEND_URL` | e.g. `http://localhost:3000` (return URLs) |
| `SHOPIER_API_KEY` / `SHOPIER_API_SECRET` | Shopier classic API (TR / TRY) |
| `LEMONSQUEEZY_API_KEY` / `LEMONSQUEEZY_STORE_ID` | Lemon Squeezy MoR (USD) |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | HMAC secret for `X-Signature` |
| `LEMONSQUEEZY_VARIANT_STARTER` / `_PRO` | Variant IDs per credit pack |

See `.env.example` files in each location for full templates.

## Dual payment gateways (MVP)

1. Apply migrations: `npm run db:setup` (includes `003_dual_payment_providers.sql`).
2. Point **Shopier notify URL** at a **public** Express URL (not the Next.js BFF), e.g. via ngrok:
   `POST https://YOUR_HOST/api/billing/webhooks/shopier`
3. Point **Lemon Squeezy** webhook (event: `order_created`) at:
   `POST https://YOUR_HOST/api/billing/webhooks/lemonsqueezy`
4. Checkout from the UI with region toggle: **TR → Shopier form**, **GLOBAL → Lemon Squeezy redirect**.
5. Credits are granted only after signature-verified webhooks (`CREDIT_PURCHASE` + `provider` + `reference_id`).

**Important:** Webhook HMAC verification requires the **raw body**. Expose `auth-billing-service` publicly (or tunnel) for provider callbacks; do not route webhooks through a JSON-rewriting proxy.
## Project Structure

```
├── src/
│   ├── app/                    # Next.js routes (explore, ai-lab, dashboard, periodic-table, …)
│   ├── app/api/                # BFF gateway handlers
│   ├── components/             # UI, layout, billing, periodic-table, atom-models
│   ├── context/                # Auth, theme, language providers
│   └── lib/                    # i18n, theme tokens, billing, gateway, periodic-table data
├── services/
│   └── auth-billing-service/   # Auth + billing microservice (primary backend)
├── database/
│   └── init/                   # PostgreSQL schema & ledger functions
└── .env.example
```

## Scripts

| Command | Location | Description |
|---------|----------|-------------|
| `npm run dev` | root | Start Next.js on port 3000 |
| `npm run build` | root | Production build |
| `npm run dev` | `services/auth-billing-service` | Start Express on port 4000 |
| `npm run db:setup` | `services/auth-billing-service` | Create DB + apply migrations |

## Themes

Toggle **Night Lab** (dark) and **White Lab** (light) from the navbar. Theme tokens live in `src/lib/theme/config.ts`; components use `useTheme()` or Tailwind `dark:` variants (the `dark` class is synced to `night-lab`).

## License

Private — all rights reserved.
