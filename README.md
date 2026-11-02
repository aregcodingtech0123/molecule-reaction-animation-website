# Molecule Architecture Studio

An interactive chemistry web app: explore molecules in 3D, run AI-assisted lab sessions with Gemini, learn how the model of the atom changed, and browse the periodic table. Accounts are credit-based; credits are bought through Lemon Squeezy and spent on AI Lab turns. The UI has two themes (Night Lab and White Lab) and 12 languages.

Status: the code, tests and operating documents are in this repository. Nothing here records a production deployment as done; what remains for an owner is listed in [`docs/ops/LAUNCH_CHECKLIST.md`](docs/ops/LAUNCH_CHECKLIST.md).

## Features

| Area | What it does | Route |
| --- | --- | --- |
| Explore | 3D molecule canvas with a structure sidebar, quick facts and reaction animations | `/explore` |
| Molecule pages | One server-rendered page per molecule (formula, molar mass, bonding, uses, sources, link into the 3D view) | `/molecules`, `/molecules/[id]` |
| AI Lab | Gemini chat for chemistry questions; signed-in users only; 1 credit per turn, charged only when the turn succeeds | `/ai-lab` |
| Atom Models | Timeline of five historical atomic models (Dalton, Thomson, Rutherford, Bohr, quantum) with 3D scenes | `/atom-models` |
| Periodic Table | 118 elements with a detail panel and an orbit animation | `/periodic-table` |
| Dashboard | Credit balance, ledger history, credit packs and checkout | `/dashboard`, `/pricing` |
| Auth | E-mail and password with e-mail verification and password reset, Google sign-in, httpOnly cookie session that can be revoked server-side | `/login`, `/signup`, `/verify-email`, `/forgot-password`, `/reset-password` |
| Account | Profile editing, "Download my data" export, "Delete my account" (anonymisation after a 14-day grace period) | `/profile` |
| Billing | Three credit packs sold in USD through Lemon Squeezy (merchant of record) | `/pricing` |

`/dashboard`, `/ai-lab` and `/profile` redirect signed-out visitors to `/login`. `/learn` and `/showcase` are "coming soon" placeholders. `/about`, `/contact`, `/privacy` and `/terms` are English-only drafts that need legal review. They show the operator's details from `SITE_OWNER_*` environment variables and stay `noindex` until the 14 required ones are set (see [Owner details](#owner-details-for-the-trust-pages)).

Credit packs (from `services/auth-billing-service/src/config/packages.ts`):

| Pack id | Price (USD) | Credits |
| --- | --- | --- |
| `starter` | 5 | 50 |
| `pro` | 20 | 250 |
| `enterprise` (shown as "Studio Pack") | 50 | 700 |

A new account receives 10 credits once (`SIGNUP_BONUS`).

## Architecture

```
Browser
   |  https, session_token cookie (httpOnly)
   v
Next.js app + BFF  (port 3000)
   |   /api/auth/*, /api/billing/*, /api/users/*   proxied with the Bearer token taken from the cookie
   |   /api/chat                                   reserve -> Gemini -> capture/release
   |   X-Internal-Service-Key + X-Client-IP on server-to-server calls
   v
Express auth-billing-service  (port 4000)  <----- Lemon Squeezy webhooks (POST /api/billing/webhooks/lemonsqueezy)
   |                                              go straight to Express, never through Next.js
   v
PostgreSQL 18  (users, ledger, balances, AI reservations, webhook inbox)
```

* The browser only talks to the Next.js origin. The route handlers under `src/app/api/` are a gateway (BFF) to Express; `/api/chat` calls Gemini from the Next.js server.
* The Next.js app never connects to PostgreSQL. Only Express does.
* Lemon Squeezy posts webhooks to Express directly because the HMAC check needs the raw body.
* In tests, Lemon Squeezy, Gemini, Google and Resend are never called: a network guard rejects non-loopback requests and each suite stubs what it needs. See [Testing](#testing).

## Tech stack

Versions are the ranges declared in the two `package.json` files.

| Layer | Technology |
| --- | --- |
| Web app | Next.js 16.4.3 (App Router, `src/proxy.ts`), React 19.2.4, TypeScript 5 |
| 3D and motion | three 0.184, @react-three/fiber 9, @react-three/drei 10, @react-three/postprocessing 3, framer-motion 12 |
| Styling and UI | Tailwind CSS 4, @base-ui/react, shadcn, lucide-react, sonner |
| AI | @google/genai 2.5 (default model `gemini-3.5-flash`, overridable with `GEMINI_MODEL`) |
| AI answers | react-markdown 10 with rehype-sanitize |
| Rate limiting (optional) | @upstash/ratelimit, @upstash/redis |
| API service | Express 5.1, `pg`, jsonwebtoken, bcrypt, helmet, express-rate-limit, google-auth-library, resend; TypeScript (`tsx` in development, `tsc` for the build) |
| Database | PostgreSQL 18 (`postgres:18-alpine` locally and in CI) |
| Payments | Lemon Squeezy (USD, merchant of record) |
| Tests | Vitest ~4.1, Testing Library, Supertest, Playwright 1.64 |
| Tooling | Lighthouse 13.5.0 and autocannon 8.0.0 (performance harness), concurrently, ESLint 9 |

## Prerequisites

* **Node.js 24.** Both `package.json` files declare `"node": ">=24 <25"`, and CI uses Node 24. Node 25 and later define their own global `localStorage`, which shadows jsdom's and fails every jsdom unit test (`docs/seo/SEO_FINDINGS.md`, SEO-24).
* **Docker** for the local PostgreSQL container (`docker-compose.yml`) and the throwaway test container (`docker-compose.test.yml`).
* **PostgreSQL 18** if you do not use Docker (production runs 18; the major version matters for the tests, see `docs/testing/TEST_PLAN.md`).
* `openssl` (or any other way to generate random 32+ character secrets).
* Accounts for the things you want to try for real: a [Gemini API key](https://ai.google.dev) for the AI Lab, a Google OAuth Web client id for Google sign-in, Lemon Squeezy and Resend for purchases and mail. None of them is needed to run the tests.

## Quick start (local development)

The root and `services/auth-billing-service` are two separate npm packages with separate lockfiles.

```bash
# 1. Install both packages
npm install
npm install --prefix services/auth-billing-service

# 2. Create the env files (both are gitignored)
cp .env.example .env
cp services/auth-billing-service/.env.example services/auth-billing-service/.env
```

Edit both files before the first start:

* Replace `JWT_SECRET` and `INTERNAL_SERVICE_SECRET` with random values (`openssl rand -base64 48`). **Each must be identical in both files.** The service refuses to start on the placeholder values from `.env.example` or on weak ones.
* Leave `DATABASE_URL` in the service file pointing at the local Docker database.
* Optional: the `SITE_OWNER_*` lines in the root file are commented out. Locally you can leave them; the four trust pages then show only what is set, and they are `noindex` anyway while `SITE_URL` is unset. They matter for a deployment ([Owner details](#owner-details-for-the-trust-pages)).
* Add `GEMINI_API_KEY` (root file) to use the AI Lab, `GOOGLE_CLIENT_ID` / `NEXT_PUBLIC_GOOGLE_CLIENT_ID` for Google sign-in, and the `LEMONSQUEEZY_*` values to create real checkouts.

```bash
# 3. Start PostgreSQL 18 in Docker and apply every migration in database/init/
npm run docker:up
npm run db:setup

# 4. Run Next.js (http://localhost:3000) and Express (http://localhost:4000) together
npm run dev:all
```

`dev:all` first tries `docker compose up -d` (it only warns if Docker is not running). `npm run dev:all:nodocker` skips that step; `npm run dev:web` and `npm run dev:api` start one side only. Restart after changing any `.env` file.

Database commands:

| Command | Where | Purpose |
| --- | --- | --- |
| `npm run db:setup` | root or service folder | Wait for Postgres, create the database if missing, apply pending migrations through the tracked runner (`schema_migrations`) |
| `npm run db:migrate` | service folder | Apply pending migrations (`-- --dry-run` previews) |
| `npm run db:migrate:status` | service folder | List applied, baselined and pending migrations |
| `npm run db:migrate:baseline` | service folder | Adopt a database that existed before the runner, once; see the runbook before using it on production |
| `npm run db:reset` | root or service folder | Drop and recreate the database and migrate; refuses non-local hosts |
| `npm run docker:down` / `npm run docker:reset` | root | Stop the container / wipe its volume and recreate it |

The runner needs a direct (non-pooled) connection; set `MIGRATION_DATABASE_URL` when `DATABASE_URL` points at a pooler.

Migrations in `database/init/` (all idempotent; the runner applies them in order):

| # | Adds |
| --- | --- |
| 001 | Users, balances, the immutable credit ledger and `post_credit_transaction()` |
| 002 | Profile and role fields |
| 003 | Lemon Squeezy as payment provider, pending checkout orders |
| 004 | E-mail verification and password reset tokens |
| 005 | OAuth accounts and the JWT revocation list |
| 006, 007 | AI metering ledger types and idempotency |
| 008 | Ledger hardening (TRUNCATE blocked, balance writes guarded) |
| 009 | AI credit reservations (`ai_credit_holds`) |
| 010 | Session `token_version` |
| 011 | Expiry of stale checkout orders |
| 012 | Pinned `search_path` and restricted `EXECUTE` on ledger functions |
| 013 | Lemon refunds recorded for manual review |
| 014 | Indexes for the AI daily caps |
| 015 | Durable webhook inbox (`lemon_webhook_events`) |
| 016 | Retention of `users.signup_ip` |
| 017 | Account deletion by anonymisation and the e-mail tombstone guard |
| 018 | Review flag for purchases that matched no account |

## Environment variables

Names only. Never commit values. The complete table with defaults and the reasoning is [`docs/ops/PRODUCTION_RUNBOOK.md` §5](docs/ops/PRODUCTION_RUNBOOK.md#5-environment-variables-both-services-old-code-ignores-them); the templates are [`.env.example`](.env.example), [`services/auth-billing-service/.env.example`](services/auth-billing-service/.env.example) and [`.env.test.example`](.env.test.example).

| Where | Variables |
| --- | --- |
| Next.js (root `.env`) | `AUTH_SERVICE_URL`, `BILLING_SERVICE_URL`, `USERS_SERVICE_URL`, `FRONTEND_URL`, `SITE_URL`, `JWT_SECRET`, `INTERNAL_SERVICE_SECRET`, `GEMINI_API_KEY`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `CLIENT_IP_HEADER`, `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`; optional `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS`, `GEMINI_MAX_OUTPUT_TOKENS`, `BILLING_RETRY_DELAYS_MS`, `BILLING_CALL_TIMEOUT_MS`, `CSP_MODE`, `NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_STARTER` / `_PRO` / `_ENTERPRISE` |
| Next.js, trust pages (root `.env`) | 14 required and 6 optional `SITE_OWNER_*` variables, listed under [Owner details](#owner-details-for-the-trust-pages) |
| Express (`services/auth-billing-service/.env`) | `PORT`, `HOST`, `NODE_ENV`, `DATABASE_URL`, `MIGRATION_DATABASE_URL`, `JWT_SECRET`, `INTERNAL_SERVICE_SECRET`, `EMAIL_TOMBSTONE_SECRET`, `EMAIL_TOMBSTONE_GUARD`, `FRONTEND_URL`, `GOOGLE_CLIENT_ID`, `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `LEMONSQUEEZY_VARIANT_STARTER` / `_PRO` / `_ENTERPRISE`, `RESEND_API_KEY`, `SENDER_EMAIL`, `TRUST_PROXY_HOPS`, `AI_HOLD_TTL_SECONDS`, `AI_DAILY_TURNS_PER_USER`, `AI_DAILY_TURNS_GLOBAL`, `PURGE_HEARTBEAT_URL`, `DELETION_HEARTBEAT_URL` |

Points worth knowing:

* `SITE_URL` (Next.js, server-only, read per request) is the public https origin that search engines may index. Unset, not https, or a non-production Vercel deployment means `noindex` everywhere and `Disallow: /` in `robots.txt`. In production it must equal `FRONTEND_URL`.
* `FRONTEND_URL` must be the exact public origin; the BFF rejects every state-changing request whose `Origin` differs (403 `CSRF_REJECTED`).
* `INTERNAL_SERVICE_SECRET` authenticates the BFF to Express's `/consume`, `/capture` and `/refund`. It must be identical on both services.
* `EMAIL_TOMBSTONE_SECRET` is the key for the 12-month hash of deleted accounts' e-mail addresses. It must be its own random value (not `JWT_SECRET`, not `INTERNAL_SERVICE_SECRET`). Production start-up requires it while `EMAIL_TOMBSTONE_GUARD` is on (the default), and so does `db:process-deletions`.
* The operator's legal details are `SITE_OWNER_*` variables of the **Next.js** host (not Express), read on every request: a change takes effect without a rebuild. See below.
* **`npm run check:config`** validates the configuration of both hosts before a deploy without printing any value: `npm run check:config -- --service ./.env.launch-express.local --web ./.env.launch-next.local` (exit `0` ready, `1` problems, `64` usage error). Details: [`docs/ops/LAUNCH_CHECKLIST.md` §1.5](docs/ops/LAUNCH_CHECKLIST.md).

### Owner details for the trust pages

Only the owner can supply who runs the site, where to write, which providers host it and what the refund terms are, so none of it is in the code. Every value is plain text from a server-side variable (never `NEXT_PUBLIC_*`), rendered escaped, never as HTML; `\n` or a real line break is a line break and a blank line starts a new paragraph. A variable that is empty or malformed is treated as not set: it is not shown, nor is any sentence or section that depends on it, and no placeholder text is ever printed. Source of truth: `OWNER_FIELDS` in [`src/lib/legal/site-owner.ts`](src/lib/legal/site-owner.ts); the commented template is [`.env.example`](.env.example); formats and limits are in the runbook's [environment variable table](docs/ops/PRODUCTION_RUNBOOK.md#5-environment-variables-both-services-old-code-ignores-them).

| Group | Variables |
| --- | --- |
| **Required (14)**: who and where | `SITE_OWNER_LEGAL_NAME`, `SITE_OWNER_COUNTRY`, `SITE_OWNER_POSTAL_ADDRESS`, `SITE_OWNER_CONTACT_EMAIL` |
| **Required**: terms and privacy text | `SITE_OWNER_GOVERNING_LAW`, `SITE_OWNER_REFUND_POLICY` (text or one https URL), `SITE_OWNER_HOSTING_PROVIDERS`, `SITE_OWNER_LOG_RETENTION`, `SITE_OWNER_GEMINI_DATA_USE`, `SITE_OWNER_ACCOUNT_DELETION`, `SITE_OWNER_EFFECTIVE_DATE` (`YYYY-MM-DD`) |
| **Required**: declarations, never displayed | `SITE_OWNER_SIGNUP_IP_PURGE_JOB`, `SITE_OWNER_ACCOUNT_DELETION_JOB` (set each only once its daily job runs and is monitored), `SITE_OWNER_EMAIL_TOMBSTONE_GUARD` (`enabled ...` or `disabled ...`; must agree with `EMAIL_TOMBSTONE_GUARD` on Express, `npm run check:config` compares them) |
| **Optional (6)** | `SITE_OWNER_REGISTRATION_NUMBER`, `SITE_OWNER_SUPPORT_EMAIL`, `SITE_OWNER_PRIVACY_EMAIL`, `SITE_OWNER_PHONE`, `SITE_OWNER_LAST_UPDATED` (`YYYY-MM-DD`), `SITE_OWNER_LEGAL_REVIEWED` |

* **Gate.** While any required variable is empty or malformed, the four pages are `noindex`, out of the sitemap (20 sitemap URLs instead of 24) and the `Organization` JSON-LD is not emitted. `npm run check:launch-content` lists each open variable by name and exits `1`; `0` means all 14 are set and valid, `64` is a usage error. `-- --web <file>` checks a dotenv export of the web host instead of the shell environment. It prints names and rules, never values.
* **Draft notice.** The pages carry "Draft — needs legal review" until `SITE_OWNER_LEGAL_REVIEWED=true`. Set it only after a lawyer has reviewed `/privacy` and `/terms`; it changes nothing else. The drafts claim no legal compliance. The open questions for counsel: [`docs/seo/LEGAL_REVIEW_QUESTIONS.md`](docs/seo/LEGAL_REVIEW_QUESTIONS.md); where each privacy statement comes from: [`docs/seo/TRUST_PAGES.md`](docs/seo/TRUST_PAGES.md).
* **English only.** The pages say so and nothing for them is in the 12 locale bundles. The retention periods they state (90 days, 30 days, 12 months, 14 days) are what the code does, not variables; a test fails if page and code drift apart.

## Money flow

Credits are the only thing the app sells, and every change to a balance is a row in an append-only ledger.

**Buying credits**

1. The dashboard calls `POST /api/billing/checkout` with a pack id. Express creates a Lemon Squeezy checkout carrying `custom_data` (user, pack, pending order) and returns its URL. Always create checkouts through the API; a raw store link carries no `custom_data`.
2. Lemon Squeezy sends `order_created` (and `order_refunded`) to `POST /api/billing/webhooks/lemonsqueezy` on Express.
3. Express verifies the HMAC-SHA256 `X-Signature` over the raw body. A bad signature is a 401 and touches no database.
4. A verified delivery is **stored first** in `lemon_webhook_events` (migration 015) and only then answered `200`. If it cannot be stored the answer is `503` and Lemon retries the delivery.
5. The stored event is processed in the background: the order must belong to the configured store, be in USD, match a pack and not be a test-mode order (unless explicitly allowed). The credit is posted as `CREDIT_PURCHASE` through `post_credit_transaction()`, idempotent per order (`ls_order_<id>`), so processing twice cannot credit twice.
6. A stored event that failed is retried by Express every minute (up to 10 attempts) and can be replayed by hand with `npm run webhooks:replay`. Events still unprocessed are listed by `db:reconcile`.
7. Refunds are recorded for manual review and never clawed back automatically.

**Spending credits (an AI Lab turn)**

1. `/api/chat` checks the session, the CSRF origin guard, the per-user limit (10 per minute) and the body size.
2. **Reserve:** the BFF calls Express `POST /api/billing/consume` (internal key). Express checks the balance and the daily caps and records a reservation in `ai_credit_holds`; nothing is charged yet.
3. The BFF calls Gemini (30 s timeout by default).
4. **Capture** on success (`/capture`: the debit is posted to the ledger) or **release** on failure or timeout (`/refund`: nothing is charged). Both calls are retried with backoff.
5. A reservation that is neither captured nor released expires after `AI_HOLD_TTL_SECONDS` (600 by default) and is never charged; Express settles expired reservations every 5 minutes.

**Ledger rules (enforced in PostgreSQL)**: ledger rows cannot be updated, deleted or truncated; balances change only through `post_credit_transaction()`; `npm run db:reconcile` compares every cached balance with the sum of its ledger. See [`docs/security/THREAT_MODEL.md`](docs/security/THREAT_MODEL.md) and [`docs/security/DB_ROLES.md`](docs/security/DB_ROLES.md).

## Testing

All suites use Vitest, except the browser suites (Playwright). The database suites need a real PostgreSQL 18; start the project's throwaway container first (data lives in tmpfs, port `127.0.0.1:55432`):

```bash
npm run test:db:up          # docker-compose.test.yml, waits until healthy
npm test                    # root: unit + BFF api, then every service suite
npm run test:db:down        # remove the container
```

`cp .env.test.example .env.test` is optional; it only lets you change `TEST_DATABASE_URL` and the E2E ports.

| Command | What it runs |
| --- | --- |
| `npm test` | Root `vitest run` (unit and api projects), then `npm test` in the service |
| `npm run test:unit` | Frontend and library tests in jsdom (`tests/unit`): i18n, theme, auth, billing UI, periodic table, molecules and 3D helpers, SEO helpers, legal text |
| `npm run test:api` | BFF tests (`tests/api`): the gateway, `/api/chat`, CSRF, rate limits, cookies, CSP, the config checker, the perf harness, the live-SEO checker and the docs-consistency tests. They boot the real Express service in-process against the test database; Gemini is mocked |
| `npm run test:db` | Service database suites: migrations, the ledger and its triggers, concurrency, the CLI jobs. Also `test:unit` and `test:api` inside `services/auth-billing-service` (service unit tests, Supertest API tests) |
| `npm run test:e2e` | Playwright on dedicated ports (Next.js 3100, Express 4100, database `moleculestudio_e2e_test`): paid journey with a signed webhook, guest journeys, page gating, security headers, scene assets. Chromium, plus a Pixel 7 profile for `@mobile` tests. First run: `npx playwright install chromium`. `E2E_NEXT_MODE=production` runs it against `next build` + `next start` (needed for the nonce CSP, HSTS and Secure-cookie checks) |
| `npm run test:seo` | Playwright SEO suite (`playwright.seo.config.mts`) against a production build |
| `npm run test:coverage` | Coverage for the root and the service |
| `npm run typecheck:tests` | Type-check the root including test files; `npm run typecheck` in the service folder does the same there |
| `npm run perf:bundle-budget` | Per-route JavaScript ceilings (needs a prior `next build`) |
| `npm run lint` | ESLint (non-blocking in CI, see known limitations) |

**Coverage floors.** Vitest has no `thresholds` configured; the floors are the last recorded figures, which a later change must not go below. Latest recorded (`docs/seo/SEO_FINDINGS.md`, Part 3 table): service **92.10 %** lines and **81.81 %** branches; the BFF set (`src/lib/gateway`, `src/app/api/**`, `src/lib/billing/server-billing.ts`) **94.83 %** lines. Strategy and targets per layer: [`docs/testing/TEST_PLAN.md`](docs/testing/TEST_PLAN.md).

**Safety guards.** `scripts/test/db-guard.mjs` refuses any database that is not local with `test` in its name; `scripts/test/network-guard.mjs` makes any non-loopback request fail unless a test stubbed it; Vitest replaces `dotenv` with a stub so no real `.env` is read, and `tests/setup/owner-env.ts` clears every `SITE_OWNER_*` variable so a developer's own owner details cannot change a result (`scripts/test/e2e-env.mjs` sets them blank for the E2E servers).

**CI** (`.github/workflows/test.yml`, Node 24, `postgres:18-alpine` service container, pinned actions, no secrets): `service` (typecheck, coverage), `web` (`typecheck:tests`, coverage, `next build`, bundle budget), `lint` (non-blocking), `e2e` and `e2e-production`.

Records: [`docs/testing/FINDINGS.md`](docs/testing/FINDINGS.md), [`docs/testing/TEST_CHANGES.md`](docs/testing/TEST_CHANGES.md), [`docs/testing/REMEDIATION_SUMMARY.md`](docs/testing/REMEDIATION_SUMMARY.md).

## Scheduled jobs

Run from `services/auth-billing-service` with `MIGRATION_DATABASE_URL` set to the owner's direct database URL (keep that URL out of the Express host's runtime environment). Where to run them, what to alert on and the exit codes: [`docs/ops/LAUNCH_CHECKLIST.md` §5.1](docs/ops/LAUNCH_CHECKLIST.md) and [`docs/ops/PRODUCTION_RUNBOOK.md` §9](docs/ops/PRODUCTION_RUNBOOK.md).

| Job | Cadence | Purpose |
| --- | --- | --- |
| `npm run db:reconcile` | daily | Read-only report. Exit `0` clean, `2` findings, `1` the job failed. Lists balances that differ from the ledger, missing balance rows, failed captures, expired unsettled reservations, refunded orders still credited, stored webhook events not processed, and purchases that credited nobody because no account matched |
| `npm run db:purge-signup-ips` | daily | Clears `users.signup_ip` once an account is older than 90 days (`-- --days N` changes it); touches no ledger, balance or billing row; pings `PURGE_HEARTBEAT_URL` after success |
| `npm run db:process-deletions` | daily | Anonymises accounts whose deletion request is at least 14 days old (`-- --dry-run` lists them), stores the keyed e-mail hash while the guard is on, removes hashes older than 12 months; pings `DELETION_HEARTBEAT_URL` after success |
| `npm run webhooks:replay` | on demand | Processes every stored Lemon webhook event that is not done; idempotent. Needs `npm run build` in the service folder first (it runs `dist/scripts/replayWebhooks.js`) |

The checklist also schedules `SELECT expire_stale_checkout_orders();` hourly. Expired AI reservations need no job while a single Express instance runs its in-process sweeper.

## Security

Summary of the controls; the evidence and every decision are in the documents.

* **Sessions**: a JWT in an httpOnly, `SameSite=Strict` (and `Secure` in production) `session_token` cookie; it never appears in a response body or page script. Sessions are revocable through `token_version`.
* **CSRF**: state-changing BFF requests, including `/api/chat`, are rejected when `Origin` does not match `FRONTEND_URL`.
* **Headers**: a strict per-request nonce CSP, HSTS and no `X-Powered-By`, set in `src/proxy.ts`.
* **Service-to-service**: the metering endpoints require `X-Internal-Service-Key`; the BFF forwards the end user's IP so rate limits are per user.
* **Abuse limits**: login, registration and mail endpoints are rate limited; `/api/chat` allows 10 turns per minute per user; daily AI turn caps per user and for the whole service are database-backed.
* **Payments**: HMAC over the raw body, store, currency and test-mode checks, durable inbox, idempotent credits, refunds reviewed by hand.
* **Ledger**: append-only and guarded by triggers; an optional least-privilege application role is prepared (`database/roles/app-role.sql`).
* **Start-up checks**: weak or placeholder secrets and bad production configuration stop the service; `npm run check:config` runs the same checks before deploying.
* **AI output** is rendered through a sanitiser with no remote images; the output filter is a weak quality check, not a security control.
* **Not done**: no external penetration test and no authenticated active scan (see known limitations).

Documents: [`docs/security/THREAT_MODEL.md`](docs/security/THREAT_MODEL.md), [`docs/security/SECURITY_FINDINGS.md`](docs/security/SECURITY_FINDINGS.md), [`docs/security/DEPENDENCY_TRIAGE.md`](docs/security/DEPENDENCY_TRIAGE.md), [`docs/security/DB_ROLES.md`](docs/security/DB_ROLES.md).

## Performance

A local measurement harness lives in `scripts/perf/`. It builds both servers, seeds a deterministic dataset into a guarded `*test*` database, mocks Gemini, Lemon Squeezy and Resend, and runs a scenario against the production builds on ports 3200 (Next.js), 4200 (Express) and 4290 (mock Gemini). It needs the test container and writes to the gitignored `perf-results/`.

```bash
npm run test:db:up
node scripts/perf/run.mjs smoke --runs 1 --build    # first run builds Express and Next.js
node scripts/perf/run.mjs chat --concurrency 1,10,50
```

Scenarios include `balance`, `history`, `chat`, `metering`, `caps`, `dbfaults`, `login`, `ramp`, `soakmix`, `faults`, `webvitals`, `lighthouse` and `runtime`. CI runs the deterministic part, `npm run perf:bundle-budget` (budgets in `scripts/perf/bundle-budget.json`). All published figures are local measurements and must be re-measured on the real hosts (LAUNCH_CHECKLIST §4.7).

Documents: [`docs/performance/README.md`](docs/performance/README.md) (how numbers are produced), [`docs/performance/PERFORMANCE_FINDINGS.md`](docs/performance/PERFORMANCE_FINDINGS.md), [`docs/performance/PERFORMANCE_SUMMARY.md`](docs/performance/PERFORMANCE_SUMMARY.md).

## SEO, AEO, GEO

* **Hidden by default.** The site is indexable only when `SITE_URL` is a public https origin on a production deployment; otherwise every page is `noindex` and `robots.txt` disallows everything.
* **Route registry.** `src/lib/seo/routes.ts` classifies every page; a unit test fails when a page is added without being classified. `sitemap.xml` and `robots.txt` come from it.
* **Per page**: unique title, description and self-canonical, Open Graph and Twitter cards, a generated share image, one `<h1>`, a real 404. Sign-in, signed-in and placeholder pages are `noindex`.
* **Structured data**: `WebSite`, `WebApplication`, `BreadcrumbList` on molecule pages, and `Organization` only once the 14 required `SITE_OWNER_*` variables are set.
* **Content**: molecule and element facts are checked against NIST and PubChem and credited on the pages. Molecule and element text lives in `src/lib/molecules/*` and in the 12 locale bundles in `src/lib/i18n/content/`; a test fails when they drift. Only English is indexed.
* **Trust pages** (`/about`, `/contact`, `/privacy`, `/terms`) are drafts that need legal review and are `noindex` until all 14 required `SITE_OWNER_*` variables are set, which `npm run check:launch-content` verifies.

Commands:

```bash
npm run check:launch-content                      # exit 1 while a required SITE_OWNER_* variable is empty
npm run check:live-seo -- https://<site> --trust no    # read-only check of a live origin
npm run test:seo                                  # Playwright SEO suite
```

`check:live-seo` fetches robots.txt, the sitemap, every sitemap page's search signals and JSON-LD, the pages that must stay out of the index, a 404, and (with `--variant <url>`) that other hostnames redirect permanently. It exits `0` when nothing fails, `1` on a failure, `64` on a bad argument.

Documents: [`docs/seo/SEO_SUMMARY.md`](docs/seo/SEO_SUMMARY.md) (start here), [`docs/seo/SEO_LAUNCH_CHECKLIST.md`](docs/seo/SEO_LAUNCH_CHECKLIST.md), [`docs/seo/SEO_FINDINGS.md`](docs/seo/SEO_FINDINGS.md), [`docs/seo/DATA_REVIEW.md`](docs/seo/DATA_REVIEW.md).

## Deployment

The documented plan, not a record of a finished deployment:

| Part | Host | Notes |
| --- | --- | --- |
| Next.js app and BFF | Vercel (Pro; the Hobby plan is for non-commercial use) | `npm run build`, `npm start`; `NEXT_PUBLIC_*` values are baked in at build time; set Upstash when more than one instance runs |
| Express `auth-billing-service` | Render (paid, always-on web service) | `npm ci && npm run build`, `npm start`; needs `HOST=0.0.0.0`; **exactly one instance** |
| Database | Neon PostgreSQL 18 | direct (non-pooled) URL for migrations |

The repository has no `Dockerfile`, `render.yaml` or `vercel.json`; hosts are configured in their dashboards. Express must be publicly reachable for the Lemon Squeezy webhook. Follow [`docs/ops/LAUNCH_CHECKLIST.md`](docs/ops/LAUNCH_CHECKLIST.md) for a first deployment on an empty database and [`docs/ops/PRODUCTION_RUNBOOK.md`](docs/ops/PRODUCTION_RUNBOOK.md) to upgrade a database that already holds data (backup, baseline, migrations, rollback SQL, scheduled jobs, handling a deletion request by hand).

## Project structure

```
.
|-- src/
|   |-- app/                    # routes; app/api/ holds the BFF gateway and /api/chat
|   |-- components/             # ai, atom-models, auth, billing, canvas, explore, home, layout,
|   |                           # legal, onboarding, periodic-table, profile, reactions, seo, ui
|   |-- context/  hooks/        # auth, theme and language providers; hooks
|   |-- lib/                    # ai, auth, billing, gateway, i18n (12 locales), molecules, periodic-table,
|   |                           # atom-models, reactions, security (CSP, CSRF), seo, legal (SITE_OWNER_* reader), rateLimit, theme
|   |-- proxy.ts                # page gating, per-request CSP nonce, noindex rules
|   `-- instrumentation.ts
|-- services/auth-billing-service/
|   |-- src/                    # Express app: routes, controllers, services, middlewares, config, db
|   |-- scripts/                # migrate, setup-db, reset-db, reconcile, purge-signup-ips, process-deletions
|   `-- tests/                  # unit, api, db suites
|-- database/
|   |-- init/                   # migrations 001-018
|   `-- roles/app-role.sql      # optional least-privilege role
|-- scripts/
|   |-- perf/                   # performance harness
|   |-- seo/                    # verify-live.mjs, lighthouse-public.mjs
|   |-- test/                   # db and network guards, E2E environment
|   |-- check-config.mts  check-launch-content.mts  ensure-docker.mjs
|   `-- i18n/  molecules/       # content generation helpers
|-- tests/                      # unit (jsdom), api (BFF), e2e (Playwright), fixtures, support
|-- docs/                       # ops, security, performance, seo, testing
|-- .github/workflows/test.yml
|-- docker-compose.yml          # local PostgreSQL 18
`-- docker-compose.test.yml     # throwaway PostgreSQL 18 for tests
```

## Documentation

| Folder | Document | Read it for |
| --- | --- | --- |
| `docs/ops/` | [`LAUNCH_CHECKLIST.md`](docs/ops/LAUNCH_CHECKLIST.md) | First deployment, step by step, monitoring, incidents, known limitations (§7), go / no-go |
| | [`PRODUCTION_RUNBOOK.md`](docs/ops/PRODUCTION_RUNBOOK.md) | Environment variable table, upgrading an existing database, scheduled jobs, rollback, manual deletion and data requests |
| | [`LAUNCH_NOTES.md`](docs/ops/LAUNCH_NOTES.md) | Constraints accepted for launch (no discount codes, one Express instance, ...) |
| | [`BEHAVIOUR_CHANGES.md`](docs/ops/BEHAVIOUR_CHANGES.md) | Breaking and behaviour changes of the remediation phase |
| `docs/security/` | [`THREAT_MODEL.md`](docs/security/THREAT_MODEL.md), [`SECURITY_FINDINGS.md`](docs/security/SECURITY_FINDINGS.md), [`DEPENDENCY_TRIAGE.md`](docs/security/DEPENDENCY_TRIAGE.md), [`DB_ROLES.md`](docs/security/DB_ROLES.md) | Assets and trust boundaries, every finding with its fix, dependency advisories, the database role split |
| `docs/performance/` | [`README.md`](docs/performance/README.md), [`PERFORMANCE_FINDINGS.md`](docs/performance/PERFORMANCE_FINDINGS.md), [`PERFORMANCE_SUMMARY.md`](docs/performance/PERFORMANCE_SUMMARY.md) | The harness, raw findings, the summary |
| `docs/seo/` | [`SEO_SUMMARY.md`](docs/seo/SEO_SUMMARY.md), [`SEO_LAUNCH_CHECKLIST.md`](docs/seo/SEO_LAUNCH_CHECKLIST.md), [`SEO_FINDINGS.md`](docs/seo/SEO_FINDINGS.md), [`CWV_RESULTS.md`](docs/seo/CWV_RESULTS.md), [`DATA_REVIEW.md`](docs/seo/DATA_REVIEW.md), [`PART2_DESIGN.md`](docs/seo/PART2_DESIGN.md), [`TRUST_PAGES.md`](docs/seo/TRUST_PAGES.md), [`LEGAL_REVIEW_QUESTIONS.md`](docs/seo/LEGAL_REVIEW_QUESTIONS.md) | Summary and owner to-do list, canonical host and Search Console, findings, Core Web Vitals, data sources, molecule pages and structured data, trust-page sources and the `SITE_OWNER_*` table, questions for counsel |
| | [`PRIVACY_FOLLOWUPS.md`](docs/seo/PRIVACY_FOLLOWUPS.md), [`GOOGLE_PROFILE_DESIGN.md`](docs/seo/GOOGLE_PROFILE_DESIGN.md), [`ACCOUNT_DELETION_DESIGN.md`](docs/seo/ACCOUNT_DELETION_DESIGN.md), [`ACCOUNT_DELETION_IMPLEMENTATION.md`](docs/seo/ACCOUNT_DELETION_IMPLEMENTATION.md) | Privacy design notes: IP retention, Google sign-up data, account deletion and export |
| `docs/testing/` | [`TEST_PLAN.md`](docs/testing/TEST_PLAN.md), [`FINDINGS.md`](docs/testing/FINDINGS.md), [`TEST_CHANGES.md`](docs/testing/TEST_CHANGES.md), [`REMEDIATION_SUMMARY.md`](docs/testing/REMEDIATION_SUMMARY.md), [`I18N_REVIEW.md`](docs/testing/I18N_REVIEW.md) | Test strategy and guards, functional findings, every test change with its reason, remediation status, machine-translation review |

## Known limitations

The accepted limitations and what would trigger revisiting each are in [`docs/ops/LAUNCH_CHECKLIST.md` §7](docs/ops/LAUNCH_CHECKLIST.md#7-known-limitations-and-scale-out-requirements-accepted-for-launch). The ones that affect day-to-day work:

* One Express instance only: its rate limiters and expired-reservation sweeper are in-process.
* Lemon Squeezy discount codes must not be created until the webhook validates the amount paid ([`LAUNCH_NOTES.md`](docs/ops/LAUNCH_NOTES.md)).
* Refunds are reviewed by hand; credits are never clawed back automatically.
* The non-English UI text is machine-translated and awaits native review.
* The trust pages are English-only drafts: the 14 required `SITE_OWNER_*` variables must be set and a lawyer must review them (`SITE_OWNER_LEGAL_REVIEWED`). The drafts have no liability clause and no age statement; see `LEGAL_REVIEW_QUESTIONS.md`.
* No admin UI and no account-disable flag; the levers are SQL.
* The CI `lint` job is non-blocking because of existing `react-hooks` findings.
* Local performance figures are not production figures.

## License

Private — all rights reserved.
