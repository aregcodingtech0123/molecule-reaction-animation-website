# Phase 1.5 remediation — executive summary

Branch `fix/phase1-findings` (from `test/phase1-functional`), 2026-10-24.
Details: [FINDINGS.md](./FINDINGS.md) (status per finding) · [TEST_CHANGES.md](./TEST_CHANGES.md) (every changed
test, TC-01…TC-39) · [I18N_REVIEW.md](./I18N_REVIEW.md) · [PRODUCTION_RUNBOOK.md](../ops/PRODUCTION_RUNBOOK.md) ·
[BEHAVIOUR_CHANGES.md](../ops/BEHAVIOUR_CHANGES.md).

## Outcome

**35 of 35 findings fixed** (32 from Phase 1 plus FINDING-33, the High FINDING-34 and FINDING-35 found during the
work; FINDING-35 surfaced in CI on PostgreSQL 16).
Nothing is deferred and nothing is marked won't-fix. The only exclusion is by your instruction: `middleware.ts` was not
renamed to `proxy.ts`.

| Batch | Findings | Commits |
| --- | --- | --- |
| 0 Repo hygiene | 30 | `69e1034` |
| 1 Database | 01, 02, 05, 29 | `030a484` |
| 2 AI metering | 03, 07, 21, 22, 25 (+33) | `fba88e7`, `47fc4b8`, `c9b7b48` |
| 3 Auth & gateway | 34 (High, new), 04, 09, 18, 19, 20, 23, 24, 32, 33 | `ce43380`, `0b4a13c` |
| 4 Billing & webhook robustness | 10, 11, 14, 12, 08, 16, 15, 13, 17 | `b4d96da`, `fc403c2`, `3ae839d`, `f6273fc` |
| 5 Frontend | 06, 28, 26, 31, 27 | `05352ba`, `a249a8c`, `ba12e97`, `2f2d975`, `aa563d4` |
| Tests type-check | — | `d9d6251` |
| CI follow-ups (PG 16) | TC-40 (FK SQLSTATE), 35 | `59155c3`, `941bd3f` |

Money-path highlights: a user can no longer refund successful AI turns (03); AI turns are charged once, only after
success, via reserve → capture/release (07, 22); the ledger cannot be truncated or bypassed, and `db:reconcile`
alerts on drift (05). Security highlights: Google pre-account takeover closed (34); sessions revocable via
`token_version` (18); JWT never reaches page JavaScript (24); login/logout CSRF and gateway path escapes blocked;
per-user rate limits that cannot be spoofed (04).

## Test results (final run)

| Suite | Result | Coverage |
| --- | --- | --- |
| Service (unit · api · db, PostgreSQL 16.15 as in CI) | 490 pass · 0 expected-fail | lines 89.2 % (was 85.3), branches **75.9 %** (was 69.9) |
| Root (BFF api + frontend unit, PostgreSQL 16.15) | 403 pass · 0 expected-fail | BFF lines 93.7 % (was 87.3); `src/` 49.6 % (was 46) |
| E2E, Chromium + Pixel 7 | **29/29, twice in a row** | — |
| Type check (source + tests, both packages) | 0 errors; now enforced in CI | — |

No expected-fail marker remains; no test is skipped; no assertion was weakened. Every changed test is logged with
its reason in TEST_CHANGES.md.

## What you must do to ship

Follow PRODUCTION_RUNBOOK.md. Key points:
* Back up, then baseline the migration runner and apply `008`–`011`.
* Set `INTERNAL_SERVICE_SECRET` (identical on both services), `CLIENT_IP_HEADER`, and the exact `FRONTEND_URL`.
* Confirm all three `LEMONSQUEEZY_VARIANT_*` values; Express now refuses to start without them.
* Deploy Express before Next.js, inside a short AI Lab maintenance window.
* Every user is signed out once.
* Point the Lemon webhook at Express.
* Schedule `db:reconcile` and `expire_stale_checkout_orders()`.

## `npm audit` (reported only, nothing upgraded)

| Package | Total | Critical | High | Moderate | Low |
| --- | --- | --- | --- | --- | --- |
| root (Next.js app) | 28 | 4 | 14 | 5 | 5 |
| `services/auth-billing-service` | 3 | 1 | 1 | 1 | 0 |

Most relevant:
* **`next` 16.2.6 → 16.4.3 (critical, no major bump):** includes a *Middleware/Proxy bypass*. Page gating relies on
  `middleware.ts`, so treat this as the first Phase 2 item. The API itself stays protected by the BFF/Express token
  checks.
* **`proxy-addr` (critical) / `body-parser` (high) / `qs` (moderate)** under Express 5.2.1: fixed by a lockfile
  refresh. The `proxy-addr` advisory concerns subnet-based trust; this service now trusts a hop count
  (`TRUST_PROXY_HOPS`, default 0).
* **Dev-only tooling** (`concurrently` → `shell-quote`, `shadcn` → `zod`, MCP SDK, `hono`): not in the runtime bundle.
* **`katex` chain (low):** needs a semver-major bump of `rehype-katex` / `remark-math`.

## Decision needed: legacy services (not deleted)

> **Resolved.** Phase 1.5: option (b) — vendored artifacts untracked (`040ff8b`). Phase 2: the three services were
> removed (`chore: remove unused legacy services`); their last version is preserved in the git tag
> `legacy-services-final`.

`services/auth-service`, `services/billing-service` (Prisma/Stripe) and `services/ai-engine` (Python) are **referenced
nowhere** outside documentation:
* no compose file, workflow, script, `package.json`, Dockerfile, README section or import;
* the only mentions are `docs/testing/TEST_PLAN.md` (scope table) and `docs/testing/FINDINGS.md` (FINDING-30 note, gaps).

Tracked contents:

| Directory | Tracked files | Of which committed `node_modules` | Source etc. |
| --- | --- | --- | --- |
| `services/auth-service` | 6,553 | 6,472 | 21 |
| `services/billing-service` | 6,741 | 6,655 | 22 |
| `services/ai-engine` | 26 | 0 (but 11 `__pycache__/*.pyc`) | 15 |

Options: (a) delete all three; (b) keep the source and untrack `node_modules`, `dist` and `__pycache__`; (c) leave
as is.

## Handoff — Phase 2 (security / performance)

1. Upgrade `next` (middleware bypass), refresh the service lockfile, re-run `npm audit`.
2. Webhook replay window: there is no timestamp or event-id check beyond order-id idempotency.
3. Security headers / CSP through the BFF; helmet headers are not forwarded.
4. Multi-instance behaviour:
   * in-process JWT revocation cache;
   * in-memory chat limiter (Upstash path untested);
   * expired-hold sweeper per instance (idempotent, but schedule the SQL instead when running several instances).
5. `/api/chat` latency: still three sequential hops before the model. The hold TTL (600 s) must exceed the worst-case
   turn.
6. Output content policy is still a four-regex heuristic. The dev mailer logs raw links when `RESEND_API_KEY` is unset
   outside production.

## Handoff — Phase 3 (product quality)

* Native-speaker review of 924 machine-translated strings (I18N_REVIEW.md).
* 56–80 further keys per locale still show English (AI Lab, toasts, measurement/focus, studio cards).
* Theme: move context-driven Tailwind classes to CSS `dark:` variants to remove the last pre-hydration mismatch
  (FINDING-26 residual).
* Visual-regression snapshots for the 3D scenes (now deterministic: self-hosted maps).
* Dates of birth already shifted by FINDING-06 on east-of-UTC servers cannot be detected from the data. Offer users a
  prompt to confirm their date of birth if the production server ever ran east of UTC.
