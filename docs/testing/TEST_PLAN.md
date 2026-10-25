# Test Plan — Molecule Architecture Studio (Phase 1: Functional)

Scope: **functional correctness only**. Performance, penetration testing and SEO/AEO/GEO are later
phases; anything noticed in those areas is recorded under "Out-of-scope observations" in
[FINDINGS.md](./FINDINGS.md) and nowhere else.

## 1. System under test (as discovered, not as documented)

| Layer | Location | Notes |
| --- | --- | --- |
| Next.js 16 BFF + UI | `src/` | Catch-all proxies `/api/{auth,billing,users}/*`; `/api/chat` (Gemini); `/api/auth/{set,clear}-cookie`; `src/middleware.ts` gates `/dashboard`, `/ai-lab`, `/profile` |
| Express 5 service | `services/auth-billing-service/src` | Auth, JWT revocation, checkout, Lemon webhook, AI credit metering (`/consume`, `/refund`, `/deduct`) |
| PostgreSQL | `database/init/001…007` | **Seven** migrations (README says five). Ledger function `post_credit_transaction()`, append-only triggers |
| Legacy (not tested; removed in Phase 2) | `services/auth-service`, `services/billing-service`, `services/ai-engine` | Were not wired into the running stack; excluded from scope. Removed in Phase 2 — last version in the git tag `legacy-services-final` |

## 2. Risk-based prioritisation

Risk = likelihood × impact (money, account integrity, data loss).

| # | Area | Impact | Why it is risky | Priority |
| --- | --- | --- | --- | --- |
| A | Ledger / `post_credit_transaction()` / migrations | Money | Single source of truth for balances; concurrency; migration drift (006/007 not in `db:setup`) | **P0** |
| B | Lemon webhook | Money | Unauthenticated public endpoint; async fulfilment with no retry; idempotency | **P0** |
| E | `/api/chat` charge → Gemini → refund | Money | Charge before work, compensating refund, client-reachable refund endpoint | **P0** |
| C | Checkout + balance/history API | Money / privacy | Attribution via `custom_data`; per-user isolation | **P1** |
| D | Auth (password, Google, JWT, cookie, revocation) | Account takeover | Session integrity, enumeration, revocation | **P1** |
| E | BFF gateway | Availability / correctness | Header/cookie forwarding, error mapping, client-IP propagation | **P1** |
| F | Frontend logic (gating, pricing, i18n, theme) | UX | 12 locales, auth/credit gating states | **P2** |
| F | 3D canvas | UX | Smoke only — rendering internals are not unit-testable meaningfully | **P3** |

## 3. Test pyramid and coverage targets

| Layer | Tooling | Suite / script | Target (lines) |
| --- | --- | --- | --- |
| DB (SQL-level, real Postgres) | Vitest + `pg` | service `test:db` | Every function/trigger/constraint exercised; no % metric for SQL |
| Service unit (pure logic, mocked pool/fetch) | Vitest | service `test:unit` | ≥ 90 % of `lib/`, `utils/`, `config/` |
| Service API (Supertest + real test DB) | Vitest + Supertest | service `test:api` | ≥ 85 % of `services/`, `controllers/`, `middlewares/` |
| BFF / route handlers (in-process, real Express on ephemeral port, Gemini mocked) | Vitest (node) | root `test:api` | ≥ 85 % of `src/lib/gateway`, `src/app/api/**`, `src/lib/billing/server-billing.ts` |
| Frontend unit / component | Vitest + jsdom + RTL | root `test:unit` | ≥ 70 % of tested modules; no global gate on `src/components` (3D-heavy) |
| E2E | Playwright (Chromium + mobile viewport) | root `test:e2e` | 1 paid journey + guest journeys green |

## 4. Tooling choices

* **Vitest 4.1** for every JS/TS suite — native ESM + TypeScript, works with the service's
  NodeNext `.js` import specifiers and with Next's `@/` alias. Vitest 5 needs `@types/node ≥ 22`;
  4.1 keeps the project's `@types/node@20` untouched.
* **No `@vitejs/plugin-react`** — its current release pulls a Babel 8 peer that conflicts with
  `shadcn`'s Babel 7. Vite's built-in JSX transform (automatic runtime) is sufficient.
* **Supertest** against `createApp()` — no port binding needed for service API tests.
* **Real PostgreSQL**, not a mock and not PGlite, for anything touching SQL: the risks are advisory
  locks, partial unique indexes, enum transactions and triggers, which only a real server proves.
  * Local: any Postgres ≥ 14 reachable at `TEST_DATABASE_URL` (defaults to
    `postgresql://postgres@127.0.0.1:55432/moleculestudio_test`). `docker-compose.test.yml` provides one
    (`npm run test:db:up`), or point at a throwaway `initdb` cluster.
  * CI and `docker-compose.test.yml`: `postgres:18-alpine` (18.6 at the time of writing), the same major version
    as production (Neon, PostgreSQL 18.6). Moved from 16 in Phase 2; the only behavioural difference the suites
    observed is the SQLSTATE of a RESTRICT foreign-key violation (`23503` on 16, `23001` on 18 — TC-40).
  * Testcontainers was rejected: it requires a running Docker daemon on every developer machine and
    adds ~10 s per run; a disposable database per run gives the same isolation.
* **Playwright** for E2E, with both servers started by Playwright's `webServer` on dedicated ports
  (Next 3100, Express 4100) so a developer's own `dev:all` on 3000/4000 is never touched.

## 5. Safety guards (hard rules, enforced in code)

| Rule | Enforcement |
| --- | --- |
| Never touch a non-test DB | `scripts/test/db-guard.mjs` refuses unless host ∈ {localhost, 127.0.0.1, ::1, postgres} **and** database name contains `test`, and refuses any `neon.tech`, `supabase.co`, `sslmode=require` URL. Called by every global setup and by the E2E launcher. |
| Never read real secrets | Vitest aliases `dotenv` / `dotenv/config` to a no-op stub, so the service's `loadEnv.ts` cannot load `services/auth-billing-service/.env`. Every variable the code reads is set explicitly by `tests/setup/env.ts`. E2E servers receive explicit env (process env wins over `.env` files). |
| Never call Lemon / Google / Gemini / Resend | `scripts/test/network-guard.mjs` replaces `globalThis.fetch` and throws on any non-loopback host unless a test registered a stub for it. Loaded in every Vitest setup file and preloaded into E2E servers with `--import`. Google token verification is stubbed at `OAuth2Client.prototype.verifyIdToken`. |
| Deterministic | No wall-clock sleeps: async background work (webhook stage 3) is awaited by polling a spy/DB condition with a bounded timeout; time-dependent logic uses `vi.useFakeTimers` or signed tokens with explicit `exp`. Every test creates its own users (random UUID/email); nothing depends on order. |
| No production code changes for convenience | Only testability changes are allowed and must be listed in FINDINGS.md §"Source changes". Bugs get a failing test marked `it.fails(...)` with a `FINDING-xx` id. |

## 6. Test data / fixture strategy

* **Per-run database**: global setup drops and recreates `moleculestudio_test` (guarded) and applies
  migrations **001→007** in order — the real migration files, not a copy.
* **Per-test isolation by construction**: the ledger is append-only (UPDATE/DELETE/`ON DELETE RESTRICT`),
  so tables are never truncated between tests. Factories (`tests/support/factories.ts`) create a fresh
  user + balance with random UUID/email for each test; assertions are scoped to that user.
* **Migration tests** create their own scratch databases (`mst_mig_<random>_test`) and drop them.
* **Tokens**: JWTs are minted with the test `JWT_SECRET` through the service's own `signToken`, or
  hand-crafted with `jsonwebtoken` for negative cases (expired, wrong secret, wrong issuer/audience, `alg: none`).
* **Webhooks**: `tests/support/lemon.ts` builds `order_created` payloads and signs the exact raw bytes
  with the test secret.

## 7. Mocking strategy

| Boundary | How | Never |
| --- | --- | --- |
| Lemon Squeezy API (`fetch https://api.lemonsqueezy.com`) | network-guard stub returning canned JSON:API responses; request body captured and asserted | real HTTP |
| Gemini (`@google/genai`) | `vi.mock("@google/genai")` in BFF tests; network-guard stub for `generativelanguage.googleapis.com` in E2E | real HTTP |
| Google ID token | `vi.spyOn(OAuth2Client.prototype, "verifyIdToken")` | real JWKS fetch |
| Resend email | `RESEND_API_KEY` unset → service logs instead of sending; receipt path asserted through spies | real HTTP |
| PostgreSQL | **Real** in db/api suites; `vi.spyOn(pool, "query")` only to *count* calls (webhook stage 1 zero-I/O) or to inject latency/failure | in-memory fakes |
| Upstream Express from BFF | Real `createApp()` on an ephemeral port (true contract test); a throwaway `http.Server` for error-mapping cases (timeouts, 5xx, connection refused) | — |
| WebGL / R3F | `@react-three/fiber` `Canvas` and drei mocked to inert DOM in smoke tests | rendering assertions |

## 8. Directory layout

```
docs/testing/TEST_PLAN.md · FINDINGS.md
scripts/test/                  db-guard.mjs · prepare-test-db.mjs · network-guard.mjs · e2e-preload.mjs · e2e-env.mjs
docker-compose.test.yml        throwaway Postgres on :55432 (tmpfs)
.env.test.example              committed placeholders → copy to .env.test (gitignored)
vitest.config.mts              root projects: unit (jsdom) · api (node, BFF)
playwright.config.mts          ESM (.mts) because it shares the scripts/test/*.mjs helpers
tests/
  setup/                       env.ts · network.ts · dom.ts · global-db.ts
  support/                     shared helpers (express harness, jwt, lemon signer)
  unit/                        frontend lib + components + i18n + theme
  api/                         BFF gateway, set/clear-cookie, middleware, /api/chat
  e2e/                         Playwright specs + fixtures
services/auth-billing-service/
  vitest.config.ts             projects: unit · api · db
  tests/setup/ · tests/support/ · tests/unit/ · tests/api/ · tests/db/
.github/workflows/test.yml
```

## 9. npm scripts

Root: `test` (unit + api + all service suites), `test:unit`, `test:api`, `test:db` (delegates to the
service), `test:e2e`, `test:coverage`, `test:db:up` / `test:db:down` (docker-compose.test.yml).

Service: `test` (unit + api + db), `test:unit`, `test:api`, `test:db`, `test:coverage`.

## 10. CI proposal

`.github/workflows/test.yml`, on push/PR:

1. **service** job — `postgres:18-alpine` service container; `npm ci` in the service; `test:coverage`.
2. **web** job — `npm ci` at root + service (the BFF suite boots the real Express app); same Postgres
   service; `test:unit`, `test:api` with coverage.
3. **e2e** job — needs 1+2; Postgres service; `npx playwright install --with-deps chromium`;
   `test:e2e`; upload `playwright-report/` on failure.

Env changes require restarting Next.js and Express (README). In CI and E2E both servers are started
fresh per run by Playwright `webServer`, so there is no stale-env window; locally, `test:e2e` refuses
to reuse an already-running server on its ports (`reuseExistingServer: false`).

## 11. Scope by area (what each suite proves)

* **A — DB**: migrations on empty DB + full re-run idempotency + partial re-run (001 alone after 007);
  `post_credit_transaction` credit/debit/zero/overdraft/missing-balance; provider and AI idempotency
  indexes; immutability (UPDATE, DELETE, TRUNCATE); concurrency (N parallel debits, parallel duplicate
  purchase credits); constraints (email uniqueness incl. case/whitespace, UUID, `provider VARCHAR(32)`).
* **B — Webhook**: 3 stages exactly as specified, incl. zero DB calls on 401 and ack-before-DB under a
  stalled pool.
* **C — Billing API**: checkout auth/validation/Lemon request shape/error mapping; balance/history
  isolation, ordering, limit handling; consume/refund/deduct semantics.
* **D — Auth**: register/login/Google/verify/reset/logout/revocation; JWT negative matrix.
* **E — BFF**: method/headers/cookie→Bearer/status/body pass-through; upstream down/timeout; no
  internal URL leakage; `/api/ai/*` absent; `/api/chat` charge-once/refund-on-failure.
* **F — Frontend**: listed components and states; i18n parity across 12 locales (content JSON, UI
  extensions, atom-model bundles); theme persistence and `dark` sync; canvas smoke.
* **G — E2E**: paid journey (register → verify → dashboard → checkout redirect → signed webhook →
  credits → AI Lab → debit → logout) on desktop + mobile; guest journeys.
