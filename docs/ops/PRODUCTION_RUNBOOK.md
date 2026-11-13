# Production runbook — Phase 1.5 remediation (Batches 0–5)

> **Which document do I need?** This runbook is the **upgrade** path: it moves a deployment (and a database that
> already holds Phase 1 data) to the Phase 1.5 code, adopting that database with `--baseline`. A **first
> deployment on a fresh, empty database** follows [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md) instead (hosting, env,
> Neon rehearsal, Lemon live mode, first live verification, monitoring, incident response): the runner then
> chooses `mode=fresh` by itself, there is nothing to baseline, and §1–§3 below do not apply. The env table (§5),
> the checks (§7), the jobs (§9) and the rollback SQL (§10) are shared by both. Constraints you accepted for launch:
> [`LAUNCH_NOTES.md`](LAUNCH_NOTES.md).

**Who runs this:** the project owner, by hand. Nothing in this repository connects to a hosted
database automatically. Every command below runs from `services/auth-billing-service` unless noted.

**What it deploys:** tracked migrations (adopting the existing production database), ledger
hardening (`008`), AI credit reservations (`009`), session versioning (`010`), the internal service
key, the new reserve → capture/release AI charging, the BFF-owned session cookie, client-IP handling
for rate limits, the Google account-takeover fix, checkout-order expiry (`011`), env-only Lemon variant
mapping, and ledger-history pagination. Batch 5 (frontend only) adds no migration, env var or deploy step: the
self-hosted HDR files ship in `public/hdri/` with the Next.js build.

> ⚠️ **Old and new code are mutually incompatible on the AI metering path.** An old BFF calling a
> new Express gets `404` (no internal key) → every AI Lab turn fails with `503 BILLING_UNAVAILABLE`.
> A new BFF calling an old Express has no `/capture`. Deploy **Express and Next together** inside a
> short **AI Lab maintenance window** (step 6). Everything else (auth, checkout, webhooks, dashboard)
> keeps working throughout.
>
> ⚠️ **Every signed-in user is logged out once.** Sessions now carry a token-version claim (`tv`);
> tokens issued before this release have none and are refused (deliberately: it also ends any session
> a pre-account-takeover attacker or a pre-reset session may still hold — FINDING-18/34). Users sign in
> again; nothing else is lost. Users with a tab open during the deploy may see one failed sign-in
> (their old page still calls the removed `/api/auth/set-cookie`) until they reload.
>
> ⚠️ **Deploy Express before (or together with) Next.js**, never Next first: the new Next.js
> proxy (`src/proxy.ts`, formerly `middleware.ts`) refuses tokens without `tv`, and only the new Express issues them — a new Next in front
> of an old Express would send every user into a login loop.

Order: **1 backup → 2 read-only checks → 3 FINDING-03 abuse report → 4 migrations → 5 env vars →
6 deploy both services together → 7 verify (7.0 a real browser sign-in first) → 8 Lemon webhook check → 9 schedule jobs.**
Rollback steps follow each step and are collected in §10.

---

## 0. Before you start

- [ ] Everything you deploy is merged into `main` and CI is green (jobs `service`, `web`, `e2e` and
      `e2e production build`; `lint` is non-blocking).
- [ ] **Rehearse on a copy first.** Restore the step-1 backup into a staging database (Neon: branch it),
      run steps 2–7 against staging with staging copies of both services.
      **Production runs PostgreSQL 18.6** (Neon, `SELECT version();`), so rehearse the migrations on a Neon
      branch of that same version — not on a local or older server. CI and the local test stack use
      `postgres:18-alpine` to match.
- [ ] You have a **direct** (non-pooled) connection string for production. The migration runner
      refuses pooled URLs (`-pooler` hosts, port `6543`, `pgbouncer=true`) because it holds a
      session-level advisory lock.
      - Neon: the URL **without** `-pooler` in the host.
      - Supabase: `db.<ref>.supabase.co:5432` (not `*.pooler.supabase.com:6543`).
- [ ] Shell set up for the steps below (never commit this):
      ```bash
      export MIGRATION_DATABASE_URL='postgresql://…direct…?sslmode=require'
      ```
      `MIGRATION_DATABASE_URL` takes precedence over `DATABASE_URL` for `db:migrate`, `db:setup`,
      `db:reconcile`. Your local `.env` is still read for other variables; make sure it does not
      point `MIGRATION_DATABASE_URL`/`DATABASE_URL` somewhere else you did not intend.

---

## 1. Backup (mandatory)

- Neon: create a branch named `pre-phase15-<date>` from the production branch (instant, point-in-time).
- Supabase / other: `pg_dump --format=custom --no-owner "$MIGRATION_DATABASE_URL" > pre-phase15.dump`
  and verify it restores: `pg_restore --list pre-phase15.dump | head`.
- Record the time. **Rollback for any later step that damages data = restore this backup** (§10.6).

## 2. Read-only pre-flight

```bash
node scripts/migrate.mjs --status                 # expect: every file "pending" (no schema_migrations yet)
node scripts/migrate.mjs --baseline --dry-run     # prints which existing migrations would be recorded, and what would run
```

Interpret the dry run:

| Dry-run says | Meaning | Action |
| --- | --- | --- |
| `baseline: 7 … 001…007` and `would apply 008 … 014` | expected if 006/007 were applied by hand earlier | continue |
| `baseline: 5 … 001…005` and `would apply 006, 007, 008 … 014` | the production DB never got 006/007 (FINDING-01): **AI usage has been failing in production** (every `/api/chat` turn → 503) | continue — step 4 fixes it |
| `INCONSISTENT_SCHEMA` | a later migration appears present while an earlier one is not | **stop**; the schema was changed by hand. Send me the output of `\d+` for the tables named in the message |
| `POOLED_URL` | you passed a pooled URL | use the direct URL |

> Baselining records the **checksum of the current file in the repository**, not of whatever text
> originally ran in production (no record of that exists). From then on, any edit to an applied file
> is refused (`CHECKSUM_MISMATCH`); changes must be new migrations.

Also run the reconciliation SQL by hand (the function does not exist yet — this is the inline
equivalent, read-only):

```sql
-- users whose cached balance differs from SUM(ledger)
SELECT b.user_id, b.balance, COALESCE(s.total, 0) AS ledger_sum, b.balance - COALESCE(s.total, 0) AS diff
FROM user_balances b
LEFT JOIN (SELECT user_id, SUM(amount) AS total FROM credit_ledger_transactions GROUP BY user_id) s
  ON s.user_id = b.user_id
WHERE b.balance <> COALESCE(s.total, 0)
ORDER BY abs(b.balance - COALESCE(s.total, 0)) DESC;
```

Expected: empty, or only very old accounts (an early schema defaulted new balances to 10 without a
ledger row). Save the output; step 7 compares against it.

## 3. FINDING-03 — detect past self-refund abuse (read-only)

Until this release, any signed-in user could call `POST /api/billing/refund` from the browser with a
`reference_id` copied from `/api/billing/history` and get the credit of a **successful** AI turn back.
The ledger is immutable, so the evidence is complete.

Legitimate refunds were issued **by the server inside the same `/api/chat` request**, i.e. seconds
after the charge (bounded by Gemini latency). Self-refunds needed a separate history fetch and request,
so they typically arrive **later**, and an abusing account refunds a large share of its usage.

```sql
WITH pairs AS (
  SELECT r.user_id,
         r.created_at - c.created_at AS delay,
         r.amount
  FROM credit_ledger_transactions r
  JOIN credit_ledger_transactions c
    ON c.user_id = r.user_id
   AND c.reference_id = r.reference_id
   AND c.transaction_type = 'CREDIT_CONSUMPTION'
  WHERE r.transaction_type = 'CREDIT_REFUND'
),
usage AS (
  SELECT user_id, count(*) AS consumptions
  FROM credit_ledger_transactions
  WHERE transaction_type = 'CREDIT_CONSUMPTION'
  GROUP BY user_id
)
SELECT p.user_id,
       u.email,
       us.consumptions,
       count(*)                                              AS refunds,
       round(100.0 * count(*) / NULLIF(us.consumptions, 0)) AS refund_pct,
       count(*) FILTER (WHERE p.delay > interval '2 minutes') AS late_refunds,
       sum(p.amount) FILTER (WHERE p.delay > interval '2 minutes') AS late_credits,
       max(p.delay)                                          AS max_delay
FROM pairs p
JOIN users u ON u.id = p.user_id
JOIN usage us ON us.user_id = p.user_id
GROUP BY p.user_id, u.email, us.consumptions
HAVING count(*) FILTER (WHERE p.delay > interval '2 minutes') > 0
    OR (us.consumptions >= 5 AND round(100.0 * count(*) / NULLIF(us.consumptions, 0)) >= 50)
ORDER BY late_refunds DESC, refund_pct DESC;
```

How to read it:

- **`late_refunds > 0`** — a refund more than 2 minutes after its charge. The server never did that
  (there was no Gemini timeout, so a *hung* call could exceed 2 min, but that is rare and
  shows up as isolated rows). Several late refunds on one account ≈ deliberate self-refunds.
- **`refund_pct` near 100 %** with many consumptions (the query only flags ≥ 5) ≈ the account used the AI for free. Gemini
  outages also produce refunds, but for **all** users at the same time — compare timestamps across
  accounts before concluding.
- Cross-check suspicious `reference_id`s with BFF logs if you still have them: a legitimate refund has
  a matching `[api/chat] Gemini failed after credit charge — refunding` line; a self-refund has none.
- **Remediation is a business decision.** Never edit or delete ledger rows (they are immutable by
  design). If you decide to claw credits back, post a compensating row per account:
  `SELECT post_credit_transaction('<user-uuid>', -<credits>, 'ADMIN_ADJUSTMENT', 'finding-03-clawback-<date>');`
  (fails with `P0001` if the balance is lower — then decide case by case).

Save the output with the date; it is the audit record.

## 4. Migrations (old code may stay live during this step)

`008`–`014` are backward compatible with the currently deployed code:
`008` re-creates `post_credit_transaction()` with the same signature and behaviour (plus the flag the
balance guard checks) and only blocks direct `UPDATE`/`TRUNCATE` of `user_balances` — the old code
never does either. `009` only adds a table and two functions. `010` adds `users.token_version`
(default 0), which the old code ignores. `011` only adds `expire_stale_checkout_orders()` and a partial
index on `pending_checkout_orders`. `012` (SEC-12) pins `search_path` on the ledger functions, makes
`post_credit_transaction()` `SECURITY DEFINER` and revokes its `EXECUTE` from `PUBLIC` — the owner role
the services connect as keeps it, so nothing changes while one role owns the schema and runs the app.
`013` (SEC-14) only adds the `lemon_order_refunds` table and the read-only `refunded_orders_to_review()`.
`014` (SEC-16) only adds two indexes on `ai_credit_holds`.

> **Empty database (first deployment)?** Skip `--baseline`: run `node scripts/migrate.mjs` and expect
> `mode=fresh baselined=0 applied=20` (see `LAUNCH_CHECKLIST.md` §2). `--baseline` is only for a database that existed
> before the runner did.

```bash
node scripts/migrate.mjs --baseline --dry-run     # re-check right before applying
node scripts/migrate.mjs --baseline               # records existing files, applies the rest (006?, 007?, 008–016)
node scripts/migrate.mjs --status                 # every file: applied or baselined
```

Each pending file runs in its own transaction; a failure stops the run with nothing half-applied
for that file. Re-running **the runner** is safe (applied files are skipped).

> **Never re-run an already-applied migration file by hand** (`psql -f database/init/00x_….sql`, a SQL
> console paste, a "fix-up" script). Only `node scripts/migrate.mjs` applies migrations; it reads `database/init` by
> default. The migration library can be given another directory, but that is a verification method, not an operator
> procedure, and files under `database/staged/` (the Phase 2C V7 contract, not applied) are never applied by the command.
> The old files are
> frozen (checksummed) and recreate functions with `CREATE OR REPLACE`, which silently undoes later
> hardening: re-running `003_dual_payment_providers.sql` rebuilds `post_credit_transaction()` **without**
> 012's `SECURITY DEFINER` and pinned `search_path` (EXECUTE stays revoked from PUBLIC, so with the SEC-12
> app role the service could no longer post credits at all). If it has happened anyway, re-apply 012 by hand
> right away (`psql "$OWNER_DATABASE_URL" -1 -f database/init/012_function_search_path.sql`; it is idempotent)
> and check with:
>
> ```text
> SELECT prosecdef, proconfig FROM pg_proc WHERE proname = 'post_credit_transaction';
> -- expected: t | {"search_path=public, pg_temp"}
> ```

**Rollback 4:** see §10.1 (the migrations are additive; old code keeps working with them applied,
so rolling them back is normally unnecessary).

## 5. Environment variables (both services; old code ignores them)

Generate **one** key and set the **same value** on both services:

```bash
openssl rand -base64 48
```

(The same command makes `JWT_SECRET`; use a separate value for each. **`LEMONSQUEEZY_WEBHOOK_SECRET` is different:
Lemon accepts 6–40 characters and our service needs ≥ 32 — use `openssl rand -hex 20`, 40 characters, not the 64-character
base64 above.)

| Variable | Next.js (BFF) | Express (`auth-billing-service`) | Notes |
| --- | --- | --- | --- |
| `INTERNAL_SERVICE_SECRET` | **required** | **required** | identical on both; ≥ 32 chars, random. Both services refuse to start without it |
| `EMAIL_TOMBSTONE_SECRET` | — | **required while the guard is on** | key of the 12-month e-mail hash of deleted accounts (account deletion, migration 017). ≥ 32 chars, random, **its own value** (≠ `JWT_SECRET`, ≠ `INTERNAL_SERVICE_SECRET`); also needed by the machine running `db:process-deletions`. The service refuses to start in production without it (or with a weak/shared one); `check:config` checks it. Never printed |
| `EMAIL_TOMBSTONE_GUARD` | — | optional (`true`) | `false`/`0`/`no`/`off` switches the guard off completely (no hash computed, looked up or stored; the secret is then not required) — for the case legal review rejects it. Any other value is refused at start-up |
| `PURGE_HEARTBEAT_URL`, `DELETION_HEARTBEAT_URL` | — | optional | heartbeat-monitor ping URLs for the two daily jobs (read by the job processes, not the web service); the URL is a secret and only its host is ever printed |
| `GEMINI_TIMEOUT_MS` | optional (30000) | — | a timed-out turn is released (not charged) |
| `BILLING_RETRY_DELAYS_MS` | optional (`250,1000,3000,8000,15000`) | — | backoff for capture/release retries: ≈ 27 s, so a turn is still charged after a ~30 s billing or database outage (R20; was `250,1000,3000`, ≈ 4 s). The answer waits for the capture, so an outage delays it by up to this much |
| `AI_HOLD_TTL_SECONDS` | — | optional (600) | an unsettled reservation expires uncharged after this. Keep it well above `GEMINI_TIMEOUT_MS` + the `BILLING_RETRY_DELAYS_MS` total, or slow successful turns go uncharged |
| `AI_HOLD_SWEEP_INTERVAL_MS` | — | optional (300000) | in-process settling of expired reservations; `0` disables |
| `WEBHOOK_STORE_TIMEOUT_MS` | — | optional (3000) | longest the webhook waits to store a delivery before answering 503 so Lemon retries (R19) |
| `WEBHOOK_RETRY_INTERVAL_MS` | — | optional (60000) | in-process retry of stored webhook events that failed (up to 10 attempts); `0` disables (R19) |
| `MIGRATION_DATABASE_URL` | — | optional | only for migration/reconcile jobs (direct URL) |
| `FRONTEND_URL` | **must be exact** | (unchanged) | the public origin, scheme + host, no trailing slash (e.g. `https://moleculestudio.app`). Next.js now refuses **every** browser POST/PUT/PATCH/DELETE whose `Origin` differs (403 `CSRF_REJECTED`) — a wrong value blocks all sign-ins. `www.` and apex are different origins |
| `CLIENT_IP_HEADER` | **strongly recommended** | — | the header **your platform** sets with the end-user IP (see below). Unset → all users share one rate-limit bucket; Next logs a startup warning |
| `LEMONSQUEEZY_VARIANT_STARTER` / `_PRO` / `_ENTERPRISE` | — | **required** (existing vars, now enforced) | numeric and distinct. Express **refuses to start** in production otherwise (FINDING-13): the hard-coded fallback ids (`2154652` / `2154661` / `2154665`) were removed. Confirm the three values against the Lemon dashboard **before** deploying |
| `NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_STARTER` / `_PRO` / `_ENTERPRISE` | optional, **build-time** | — | same ids; only for `?variant_id=` deep links. Unset → those links are ignored |
| `TRUST_PROXY_HOPS` | — | optional (`0`) | proxies in front of Express whose `X-Forwarded-For` is trusted for **direct** traffic. Keep `0` unless exactly one load balancer that appends the client IP sits in front |
| `NODE_ENV` | `production` | **`production`** (Phase 2, SEC-08) | Express now applies production rules unless `NODE_ENV` is exactly `development` or `test`. Production rules without `HOST` bind `127.0.0.1`: hosted platforms need `HOST=0.0.0.0` |
| `FRONTEND_URL`, `LEMONSQUEEZY_WEBHOOK_SECRET`, `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`, `RESEND_API_KEY`, `SENDER_EMAIL` / `EMAIL_FROM`, `BCRYPT_ROUNDS` | — | **validated at boot** (SEC-08) | https origin; webhook secret ≥ 32 random chars, not a placeholder (Lemon allows up to 40 — rotate it in the dashboard and here together); store id numeric; sender on a verified domain, not `@resend.dev`; bcrypt cost 10–15 if set. Any problem → `FATAL:` line, exit 1 |
| `JWT_SECRET`, `FRONTEND_URL`, `AUTH_SERVICE_URL`, `BILLING_SERVICE_URL`, `USERS_SERVICE_URL` | **validated at start** (SEC-08) | — | `next start` refuses to start without them (not checked during `next build`) |
| `AI_DAILY_TURNS_PER_USER` / `AI_DAILY_TURNS_GLOBAL` | — | optional (`200` / `3000`) | SEC-16: AI turns per rolling 24 h per user (`429 AI_DAILY_LIMIT`) and for the whole service (`503 AI_CAPACITY_REACHED`, logged as an error — alert on it). Size the global cap from your model budget |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | optional | — | shared per-user `/api/chat` limit (10/min). Needed whenever the platform runs more than one Next.js instance (Vercel always does); unset → per-instance in-memory counting. The daily AI caps are database-backed either way |
| `GEMINI_MODEL`, `GEMINI_API_KEY` | key **required**, model optional | — | the key is server-side only (never `NEXT_PUBLIC_`); `check:config` reports a missing key |
| `CSP_MODE` | optional (enforce) | — | SEC-18: `report-only` sends the strict nonce CSP as `Content-Security-Policy-Report-Only` — only as a temporary escape hatch if a third party (e.g. Google sign-in) breaks; anything else enforces |
| `BILLING_CALL_TIMEOUT_MS` | optional (`10000`) | — | SEC-17: upper bound of one BFF → billing call; a timed-out reservation answers `503 BILLING_UNAVAILABLE`, a timed-out capture/release is retried |
| `BILLING_DELIVERY_TRACKING` | optional (unset = **off**) | — | Phase 2C 5.2.2: `true` or `1` (any case) makes new reservations *tracked*: the billing service issues a third, delivery-only capability (`delivery_ack`), and the BFF makes **one** call (≤ 2 s, never retried) just before it returns a settled answer, recording that it attempted to. Anything else, a typo included, is **off**. It never changes a charge or an answer, and an acknowledgement that fails only logs `[billing] DELIVERY_ATTEMPT_UNRECORDED`. Reservations made while it is off, or by an older BFF, are never tracked and never look like gaps. **Turn it on only after migrations 019/020 are applied and the new Express is deployed**: on a database without 019 every tracked reservation fails. Turning it off takes effect on the next turn. "Recorded" means the BFF attempted to return the answer, not that the browser received it |
| `GEMINI_MAX_OUTPUT_TOKENS` | optional (`2048`) | — | SEC-16: upper bound of one answer. The prompt is also capped at the newest 32 000 characters of the conversation |
| `LEMONSQUEEZY_ALLOW_TEST_MODE` | — | optional (unset) | SEC-13: production ignores Lemon **test-mode** orders unless `true`. Set only while testing purchases with test cards on a non-live deployment; `check:config` fails on a truthy value. Orders must also carry `store_id` = `LEMONSQUEEZY_STORE_ID` and currency USD |
| `DATABASE_URL` (app role) | — | optional (SEC-12) | may point at the least-privilege role from `database/roles/app-role.sql` (see `docs/security/DB_ROLES.md`); migrations keep the owner URL. After the staged Phase 2C R transition (S10, a point of no return, not applied and not production-approved) that role is defined by `database/staged/phase-2c-v7/S10-R-app-role-transition.sql`, the build in this repository no longer works against it, and `app-role.sql` must not be re-run |
| `SITE_OWNER_LEGAL_NAME` | **required for launch**, one line, ≤ 200 chars | — | trust pages (SEO Part 2, D6): who operates the site (About, Contact, Privacy, Terms; Organization JSON-LD). Server-side, read on every request, **never `NEXT_PUBLIC_*`**, web host only. Empty = not shown. See *Owner details* below |
| `SITE_OWNER_COUNTRY` | **required**, one line, ≤ 100 | — | country of the operator |
| `SITE_OWNER_POSTAL_ADDRESS` | **required**, text ≤ 500 (line breaks kept) | — | postal address for legal notices (Contact, Privacy, Terms, JSON-LD) |
| `SITE_OWNER_CONTACT_EMAIL` | **required**, e-mail ≤ 254 | — | general contact; also the privacy-request address unless `SITE_OWNER_PRIVACY_EMAIL` is set |
| `SITE_OWNER_GOVERNING_LAW` | **required**, text ≤ 1500 | — | governing law and courts (Terms "Governing law" section appears only when set) |
| `SITE_OWNER_REFUND_POLICY` | **required**, text ≤ 4000 or one https URL | — | refund policy (Terms "Refunds" section; a lone https URL becomes a link) |
| `SITE_OWNER_HOSTING_PROVIDERS` | **required**, text ≤ 1000 | — | hosting providers actually used (Privacy) |
| `SITE_OWNER_LOG_RETENTION` | **required**, text ≤ 1000 | — | how long hosting logs are kept (Privacy) |
| `SITE_OWNER_GEMINI_DATA_USE` | **required**, text ≤ 2000 | — | what Google may do with AI Lab prompts under the Gemini plan you use (Privacy) |
| `SITE_OWNER_ACCOUNT_DELETION` | **required**, text ≤ 2000 | — | how to ask for deletion by e-mail and what is kept (Privacy, Terms) |
| `SITE_OWNER_SIGNUP_IP_PURGE_JOB` | **required**, text ≤ 1000, **never displayed** | — | your statement that the daily `db:purge-signup-ips` job runs and is monitored (§9, `LAUNCH_CHECKLIST.md` §5.1). Set it **only when true**: it lets the policy say "cleared once the account is 90 days old" |
| `SITE_OWNER_ACCOUNT_DELETION_JOB` | **required**, text ≤ 1000, **never displayed** | — | same for the daily `db:process-deletions` job; lets the policy describe self-service deletion as active. Set only when true |
| `SITE_OWNER_EMAIL_TOMBSTONE_GUARD` | **required**, must start with `enabled` or `disabled`, ≤ 1000, **never displayed** | — | your decision on the 12-month e-mail hash of deleted accounts; the policy mentions the hash only when `enabled`. Must agree with `EMAIL_TOMBSTONE_GUARD` on the service (`check:config` fails if not) |
| `SITE_OWNER_EFFECTIVE_DATE` | **required**, `YYYY-MM-DD` (a real date) | — | effective date shown on all four pages |
| `SITE_OWNER_REGISTRATION_NUMBER` | optional, one line, ≤ 100 | — | company registration or tax number; shown only if given |
| `SITE_OWNER_SUPPORT_EMAIL` | optional, e-mail | — | separate support address (Contact) |
| `SITE_OWNER_PRIVACY_EMAIL` | optional, e-mail | — | address for privacy requests / data-protection contact (Contact, Privacy); falls back to `SITE_OWNER_CONTACT_EMAIL` |
| `SITE_OWNER_PHONE` | optional, `+`, digits, spaces and `( ) . - /` | — | telephone number (Contact; Organization JSON-LD) |
| `SITE_OWNER_LAST_UPDATED` | optional, `YYYY-MM-DD` | — | "Last updated" on the four pages |
| `SITE_OWNER_LEGAL_REVIEWED` | optional, exactly `true` | — | removes the "Draft — needs legal review" notice from the four pages. It changes nothing else (the required variables decide indexing). Set it only after counsel has reviewed `/privacy` and `/terms` |

**Owner details (`SITE_OWNER_*`, web host only).** These are the facts only you can supply for the four trust pages. They are read from the
environment of the Next.js host **on every request** (a change needs a restart or redeploy of that host, not a rebuild), they are published on the
pages, so nothing here is a secret. Rules:

* **Empty or unset = not shown.** A field, and any sentence or section that depends on it, is simply left out; no placeholder text ever appears.
* **A value that fails its format counts as not set** (e-mail shape, real `YYYY-MM-DD` date, telephone characters, `enabled`/`disabled`, maximum length), so a typo cannot show up on a page or open the gate. `npm run check:config` and `npm run check:launch-content` name the variable and the rule, never the value.
* **The 14 required variables gate the launch.** While any is empty or invalid, `/about`, `/contact`, `/privacy` and `/terms` are `noindex`, out of the sitemap (20 URLs instead of 24) and no `Organization` JSON-LD is emitted, and `npm run check:launch-content` exits 1 naming them.
* **Format of long values.** Plain text only, rendered as text (HTML in a value is shown as characters, never interpreted). A blank line starts a new paragraph; a single line break stays a line break; where a dashboard cannot hold a real line break, write `\n`. Example: `Refunds within 14 days if no credits were used.\n\nWrite to us with your order number.`
* **Never displayed:** the two job declarations and the e-mail-hash decision only switch sentences; their text is not printed.
* The pages are **English only** on purpose (legal text is not machine-translated; `LAUNCH_CHECKLIST.md` §1.7).

**Choosing `CLIENT_IP_HEADER` (Next.js):** it must be a header the platform **overwrites**, so a client
cannot forge it. The right-most valid address is used.

| Platform in front of Next.js | `CLIENT_IP_HEADER` |
| --- | --- |
| Vercel | `x-forwarded-for` (Vercel documents that it **overwrites** this header with the client IP) |
| nginx with `proxy_set_header X-Real-IP $remote_addr;` | `x-real-ip` |
| Cloudflare (proxied) | `cf-connecting-ip` |
| Render, Railway, Fly.io | **not decided here**: their reference docs do not promise an un-spoofable single header (Render: a Cloudflare-set `cf-connecting-ip` per a Render article, `X-Forwarded-For` appended to per a community thread; Railway: `X-Real-IP`; Fly: `Fly-Client-IP`). Choose one only after the client-IP test in `LAUNCH_CHECKLIST.md` §A |
| Next.js reachable directly (no proxy) | leave unset — there is no trustworthy header |

**Choosing `TRUST_PROXY_HOPS` (Express):** Express is publicly reachable for Lemon webhooks. With `0` it
ignores `X-Forwarded-For` (any client could forge it). BFF traffic is unaffected: the BFF sends the
end-user IP in `X-Client-IP` together with the internal key, and only then is it trusted. Set `1` only
if you have **verified** that exactly one load balancer that **appends** the client address sits in front of
Express (an AWS ALB does; a platform that chains a CDN and a load balancer — for example Render, per its own
article — may mean two hops, which this setting cannot express). Otherwise keep `0`: direct callers then share the
load balancer's IP bucket (harmless: legitimate users never call Express directly, and the BFF's authenticated
`X-Client-IP` still gives per-user buckets).

Also check: `JWT_SECRET` must still pass the (changed) strength check — ≥ 32 chars, not a documented
placeholder, and **not low-variety** (e.g. `aaaa…` or a short repeated pattern is now refused). A
randomly generated key passes. Test locally: `node -e "import('./dist/config/secretStrength.js').then(m=>console.log(m.weakSecretReason('JWT_SECRET', process.env.JWT_SECRET)))"` after `npm run build` (prints `null` when fine).

**Check both sides together before deploying** (Part 2B): export each host's environment to a local
file **whose name git ignores** and run

```bash
# repo root. `.env.launch-express.local` / `.env.launch-next.local` match .gitignore (.env.*.local);
# a name like `express.env` does NOT, and would let you commit production secrets.
git check-ignore -v .env.launch-express.local .env.launch-next.local
npm run check:config -- --service ./.env.launch-express.local --web ./.env.launch-next.local   # or `env` to read the current shell
```

It prints variable **names** only, never values, and exits `1` when anything would fail or misbehave in
production: every boot-time check of both services (SEC-08), `.env.example` placeholders still in place,
`INTERNAL_SERVICE_SECRET` / `JWT_SECRET` / `FRONTEND_URL` / the Google client id differing between the two,
`LEMONSQUEEZY_ALLOW_TEST_MODE` set to a truthy value on the service (`true`, `1`, `yes`, `y`, `on`; unset / `false` /
`0` / `no` / `off` pass), and `AI_HOLD_TTL_SECONDS` below **2 ×** the longest turn (`GEMINI_TIMEOUT_MS` + sum of `BILLING_RETRY_DELAYS_MS`
+ capture attempts × `BILLING_CALL_TIMEOUT_MS`) — with the defaults 600 s against 2 × 117.25 s (30 s + 27.25 s of retries + 6 attempts × 10 s; R20). Warnings (exit `0`): `HOST`, `CLIENT_IP_HEADER`, `GOOGLE_CLIENT_ID` unset.
Delete the exported files afterwards.

**Rollback 5:** remove the variables (old code ignores them).

## 6. Deploy both services together (AI Lab maintenance window)

1. Announce a ~10-minute AI Lab maintenance window (other pages stay up).
2. Deploy **Express** (`auth-billing-service`) **first**. It exits at boot if `INTERNAL_SERVICE_SECRET`
   or `JWT_SECRET` is weak/missing, or if any `LEMONSQUEEZY_VARIANT_*` is missing, non-numeric or shared
   (FINDING-13) — check the logs for `FATAL:`. From this moment existing sessions are
   refused (no `tv`) and users are asked to sign in again — expected.
3. Immediately deploy **Next.js**. It refuses to start (instrumentation) without a strong
   `INTERNAL_SERVICE_SECRET`; `next build` does not need it. Check its startup log for the
   `CLIENT_IP_HEADER is not set` warning.
4. Between 2 and 3, AI Lab turns fail with 503 (old BFF has no key) — that is the window. Sign-in keeps
   working in between: the old Next.js still has `/api/auth/set-cookie`, and the old middleware accepts
   the new tokens (extra claim).

**Rollback 6:** redeploy the previous Express **and** Next together (§10.3).

## 7. Verify

### 7.0 FIRST: a real sign-in on the public origin (do this before anything else)

The new cross-site guard compares the browser's `Origin` header with Next.js `FRONTEND_URL` on **every**
POST/PUT/PATCH/DELETE. `curl` sends no `Origin`, so the curl checks below pass even when `FRONTEND_URL` is wrong — only
a real browser proves it is right.

1. In a normal (not private) browser window, open the public site **exactly as users reach it** (e.g.
   `https://moleculestudio.app`) and sign in with a staff account.
2. **Success looks like:** the dialog closes, the navbar shows the account and credit balance, `/dashboard` loads its
   history; in DevTools → Network, `POST /api/auth/login` is `200` with a `Set-Cookie: session_token=…; HttpOnly;
   Secure; SameSite=Strict` response header. Then sign out (`POST /api/auth/clear-cookie` → `200`).
3. If the site is reachable under more than one host (www and apex, a platform `*.vercel.app` URL), repeat on each one
   users can land on — only the host equal to `FRONTEND_URL` can sign in. Redirect the others to it at the platform /
   DNS level.

**Failure looks like:** the sign-in dialog stays open with the message **"Cross-site request refused."**; Network shows
`POST /api/auth/login` → `403` with body `{"success":false,"error":"Cross-site request refused.","code":"CSRF_REJECTED"}`
and **no** `Set-Cookie`. Sign-up, sign-out, checkout ("Buy Now") and profile saves fail the same way (403). Nothing
reaches Express, so its logs stay quiet — the 403 comes from Next.js.

**`FRONTEND_URL` pitfalls** (set on **both** services; Express uses it for email links, the Lemon `redirect_url` and
CORS):

| Pitfall | Example (wrong → right) | Effect |
| --- | --- | --- |
| Not the exact public origin | `https://moleculestudio.vercel.app` while users use `https://moleculestudio.app` | every browser POST → 403 |
| `http` instead of `https` | `http://moleculestudio.app` → `https://moleculestudio.app` | 403; email links and the post-checkout redirect use the wrong scheme |
| www vs non-www | `https://moleculestudio.app` while users are on `https://www.moleculestudio.app` | 403 on the host that is not listed (they are different origins) |
| A trailing slash | `https://moleculestudio.app/` | harmless: both services strip trailing slashes — but write it without one |
| A path, port or upper case | `https://moleculestudio.app/en`, `https://moleculestudio.app:443`, `https://MoleculeStudio.app` | 403: browsers send the origin lower-case, without a default port and without a path |
| Left unset in production | — | defaults to `http://localhost:3000` → every browser POST → 403 |

**Fix:** correct `FRONTEND_URL` on Next.js (and Express), restart / redeploy, repeat 7.0. No database change is involved,
so there is nothing to roll back.

### 7.1 Service checks

```bash
curl -s https://<express-host>/health                                   # {"status":"ok",…}
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<express-host>/api/billing/consume   # 404 (no internal key)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<public-site>/api/billing/refund      # 404 (blocked by the BFF)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<public-site>/api/billing/deduct      # 404 (retired)
node scripts/migrate.mjs --status
node scripts/reconcile.mjs                                               # exit 0, or the same rows as in step 2
```

Security headers (SEC-18) — every page response carries a per-request nonce CSP, HSTS and friends:

```bash
curl -sI https://<public-site>/ | grep -iE '^(content-security-policy|strict-transport-security|x-frame-options|x-content-type-options|referrer-policy|permissions-policy|cross-origin-opener-policy|x-powered-by)'
# expect script-src 'self' 'nonce-…' 'strict-dynamic', max-age=63072000; includeSubDomains, DENY, nosniff, … and NO x-powered-by
```

Then, with a staff account that has credits: one AI Lab question.

```sql
SELECT status, amount, ledger_id FROM ai_credit_holds WHERE user_id = '<staff-uuid>' ORDER BY created_at DESC LIMIT 1;  -- captured, 1, <id>
SELECT amount, transaction_type FROM credit_ledger_transactions WHERE id = <ledger_id>;                                -- -1, CREDIT_CONSUMPTION
```

Sessions and cookies (Batch 3):

```bash
# Sign-in through the public site: Set-Cookie session_token (HttpOnly; SameSite=Strict; Secure), NO token in the body
curl -si -X POST https://<public-site>/api/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"<staff-email>","password":"<staff-password>"}' | grep -iE '^set-cookie|"token"'
# Cross-site sign-in attempt is refused
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<public-site>/api/auth/login \
  -H 'Origin: https://evil.example' -H 'Content-Type: application/json' -d '{}'      # 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<public-site>/api/auth/set-cookie   # 404 (removed)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<public-site>/api/billing/webhooks/lemonsqueezy   # 404
```

Checkout and history (Batch 4): buy nothing — open the dashboard as a staff user and confirm the history
loads (and shows **Load more** if the account has more than 100 rows). A webhook for one of the three
production variant ids must still credit (watch the next real order's `[Webhook] Credited user` line).

Rate limits per user: after deploy, check the Express logs for `signup_ip` values of new accounts — they
must be end-user addresses, not the Next.js server's.

Watch the BFF logs for an hour for `INTERNAL_AUTH_REJECTED` (the two services have different keys),
`CAPTURE_FAILED`, `RELEASE_FAILED`, `BILLING_NOT_CONFIGURED`.

## 8. Lemon Squeezy webhook check (FINDING-23 — URL must point at Express)

In the Lemon dashboard → Settings → Webhooks:

- URL is `https://<express-host>/api/billing/webhooks/lemonsqueezy` — the **Express** host, **not** the
  Next.js site. (The BFF drops `X-Signature`; deliveries to the Next host are always rejected.)
- You are in **live** mode (Lemon keeps test and live mode separate: live API key, live variant ids, and this
  webhook listed under live), and `LEMONSQUEEZY_ALLOW_TEST_MODE` is **not set** on Express. No discount codes exist
  (`LAUNCH_NOTES.md`). The full test → live switch is `LAUNCH_CHECKLIST.md` §3.
- Events `order_created` **and `order_refunded`** are subscribed (SEC-14); signing secret equals
  `LEMONSQUEEZY_WEBHOOK_SECRET`. Lemon documents no dispute/chargeback event: when Lemon refunds a
  disputed order on your behalf, whether that also sends `order_refunded` is not documented — check the
  Lemon dashboard for disputes during the weekly review.
- Use "Send test" (or the dashboard's simulate option, if offered) → expect `200 {"received":true}` and an Express log
  `[Webhook] Acknowledged 200 OK` with a `storedEventId`. Lemon counts only a `200` as received and retries anything
  else up to three more times with exponential backoff ("e.g. 5 secs, 25 secs, 125 secs"), then stops; its docs state
  no response timeout ([webhook requests](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests)). Express
  stores every verified delivery **before** answering `200` and answers `503` within ≈ 3 s when it cannot
  (`[Webhook] NOT STORED`), so Lemon retries it (R19). The webhooks settings page lists deliveries and lets you
  resend them.
- If the URL pointed at the Next host until now, every purchase since then was rejected (401) and **not
  credited**: re-deliver those orders from Lemon's "Recent deliveries" after fixing the URL (fulfilment is
  idempotent per order).

## 9. Scheduled jobs

Where to run them, which log lines to alert on and how long logs survive on each platform: `LAUNCH_CHECKLIST.md` §5.
`db:reconcile` needs the service folder with `npm ci` done and the owner direct URL in `MIGRATION_DATABASE_URL`
(not on the Express host's runtime environment).

- **Reconciliation** (daily): `node scripts/reconcile.mjs` (read-only session). **Alert on any
  non-zero exit code:**

  | Exit | Meaning | Action |
  | --- | --- | --- |
  | `0` | every cached balance equals `SUM(ledger)` and no AI reservation settled abnormally | none |
  | `2` | at least one issue row (printed as a table with counts per issue) | investigate the rows below |
  | `1` | the job itself failed (connection, permissions, missing function) | fix the job — never treat as green |

  Example cron (UTC, 06:00): `0 6 * * * cd /srv/auth-billing-service && MIGRATION_DATABASE_URL=… node scripts/reconcile.mjs >> /var/log/reconcile.log 2>&1 || notify-oncall "reconcile exit $?"`.
  On platforms with scheduled jobs (Render cron, GitHub Actions `schedule`, Neon + a worker) run the
  same command; the scheduler's "job failed" alert is the signal. Both behaviours are covered by
  `services/auth-billing-service/tests/db/cli.test.ts`.
  **Signup address retention** (daily, privacy): `node scripts/purge-signup-ips.mjs` (`--days N`, default 90) clears
  `users.signup_ip` for older accounts (migration 016) and prints how many; it never prints an address and touches no
  ledger, balance or billing row. Non-zero exit = alert (`1` the job failed or 016 is not applied, `2` it purged but the
  heartbeat ping failed, `64` bad argument). **Mandatory dead-man's switch:** set `PURGE_HEARTBEAT_URL` to a heartbeat
  monitor's ping URL (it is sent once, only after a successful purge, and never printed beyond its host) and alert when no
  ping arrives within 26 hours — a job that never runs sends no exit code. Same scheduler and owner URL as the
  reconciliation above; covered by `tests/db/purge-signup-ips.test.ts`.
  **Account deletion** (daily, mandatory, privacy): `node scripts/process-deletions.mjs` (`--dry-run` to list what is due) anonymises accounts whose
  deletion request is ≥ 14 days old (`anonymise_user()`, migration 017), postpones accounts with an open AI reservation or pending checkout (and counts
  them), stores the keyed e-mail hash when `EMAIL_TOMBSTONE_GUARD` is on, removes hashes older than 12 months, and prints counts only. It never touches
  the ledger or balances. Exit `1` = failure / migration 017 missing / `EMAIL_TOMBSTONE_SECRET` missing or short (it refuses rather than store an unkeyed
  hash), `2` = work done but the heartbeat ping failed (`DELETION_HEARTBEAT_URL`), `64` = bad argument. Alert on a non-zero exit **and** on a missing
  heartbeat (26 h). Covered by `tests/db/account-deletion.test.ts`. By hand for one account: §11.3.
  Issues: `balance_mismatch`, `missing_balance_row`, `capture_failed` (a debit reached the service but
  could not be posted — not charged), `hold_expired_unsettled` (neither capture nor release arrived —
  not charged; correlate `reference_id` with BFF `CAPTURE_FAILED` / `RELEASE_FAILED` logs). The last
  two are revenue loss, not customer harm.
- **Refunded orders still credited** (same job, SEC-14): `refunded_order_credited` lists every Lemon
  order refunded (fully or partly) whose purchase credits are in the ledger and that nobody has reviewed —
  user, credits granted, current balance, refunded amount. **Credits are never clawed back
  automatically.** Decide per order (keep as goodwill, or post a correction with an `ADMIN_ADJUSTMENT`
  through `post_credit_transaction()` — it refuses to take the balance below zero), then mark it reviewed:

  ```text
  UPDATE lemon_order_refunds SET reviewed_at = NOW(), review_note = '<decision, your initials>'
  WHERE provider_order_id = '<order id>' AND reviewed_at IS NULL;
  ```

  The job exits `2` until every listed order is reviewed. A later, larger partial refund of the same order
  is a new row and is listed again.
- **Stale checkouts** (hourly or daily — FINDING-15): `SELECT expire_stale_checkout_orders();` marks
  `pending_checkout_orders` rows older than 24 h as `expired` (pass an interval for another threshold;
  under 1 hour is refused). Bookkeeping only: it never touches credits, and a late payment for an
  expired order is still credited and the row marked `completed`. Example cron:
  `15 * * * * psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT expire_stale_checkout_orders();"`.
  Checkouts that fail at Lemon are now marked `failed` immediately.
- **Purchases that credited nobody** (same job, migration 018): `webhook_missing_user` lists signed `order_created` deliveries whose buyer
  matched **no account** — `custom_data.user_id` missing/unknown and no account with the buyer's e-mail, which includes an account that was
  deleted (anonymised) before the order arrived. Lemon got a 200 (it will not resend) and **nothing was credited, so the buyer paid and
  received nothing.** The list shows the Lemon order id and times only, never an e-mail. Procedure per order: (1) open the order in the Lemon
  dashboard (Orders → the order id) and **refund it** (`Issue a refund`; see the Orders API/dashboard), or — if the buyer should have
  credits and is a real customer — find their account and post the credits yourself with `post_credit_transaction()` (`ADMIN_ADJUSTMENT`,
  reference `ls_order_<id>` so a replay stays idempotent); (2) mark it reviewed so the next run is quiet:

  ```text
  UPDATE lemon_webhook_events SET reviewed_at = NOW()
   WHERE provider_order_id = '<order id>' AND outcome = 'missing_user' AND reviewed_at IS NULL;
  ```

  It never changes credits or any existing list. (Other uncredited outcomes — amount/currency mismatch, unknown pack, another store's order —
  are *not* in this list; they stay log alerts, checklist §5.2.)
- **Stored webhook events not processed** (same job, R19): `webhook_unprocessed` lists deliveries Express stored
  and acknowledged (Lemon will not resend them) that were still not processed 15 minutes later — their credits may be
  missing. Express retries them every minute (10 attempts) by itself; when they are listed, fix the cause shown in
  `last_error`, then on the Express host (service folder, built, the service's own environment):

  ```text
  npm run webhooks:replay     # processes every stored event not done; exit 0 = none left failing, 2 = some still fail
  ```

  It is idempotent per order (`ls_order_<id>`) and safe to repeat. To look at one event:
  `SELECT id, status, attempts, outcome, last_error FROM lemon_webhook_events WHERE provider_order_id = '<order id>';`.
  Payloads (they hold the buyer's e-mail) are cleared 30 days after processing.
- **Expired reservations** are settled by Express every 5 minutes. If you run several Express
  instances or disable the timer, schedule `SELECT release_expired_ai_holds();` instead (idempotent).

## 10. Rollback reference

> **Not covered here: the Phase 2C V7 R transition (staged, not applied).** Its step S10 is a point of no return. After it
> the old build is not a valid rollback target, and nothing below (or `database/roles/app-role.sql`) may be used to restore
> the privileges it removes; a problem after S10 is fixed forward or rolled back only to a release that already uses the
> narrow operations. See [`../security/DB_ROLES.md`](../security/DB_ROLES.md).

### 10.1 Migrations 008–020 (only if they cause a problem)

**Read this first.** Dropping a table or column deletes what is in it, and nothing here can be undone:

* **020** deletes every delivery-gap review record (`ai_delivery_gap_reviews`). Export it first if you need the decisions.
* **019** deletes every delivery-attempt timestamp and tracking marker. Afterwards a captured reservation can no longer be
  told apart from a delivered one. A goodwill credit already posted stays in the ledger, but the record of why disappears.
* **Order.** If any code that writes these columns is deployed, roll it back first (and switch its tracking flag off), or its
  reservations will fail the moment the columns are gone. Leaving 019 and 020 in place is harmless to older code and is the
  safer rollback; run the SQL only if the migrations themselves are the problem.
* **020 must go before 009.** The review table has a foreign key to `ai_credit_holds`, so dropping the holds first fails.
  The block below already orders this correctly.
* To roll back **only 019 and 020**, run everything down to the marked line, then `COMMIT;`. Reservations and the ledger are
  untouched, and a later `node scripts/migrate.mjs` applies 019 and 020 again.

```sql
BEGIN;
SET LOCAL lock_timeout = '3s';
-- 020 (delivery-gap review records; PERMANENTLY DELETES every review decision, export first)
DROP TABLE IF EXISTS ai_delivery_gap_reviews;
-- 019 (PERMANENTLY DELETES every delivery-attempt timestamp and tracking marker)
ALTER TABLE ai_credit_holds DROP CONSTRAINT IF EXISTS ai_credit_holds_delivery_attempt_consistent;
ALTER TABLE ai_credit_holds DROP COLUMN IF EXISTS answer_delivery_attempted_at;
ALTER TABLE ai_credit_holds DROP COLUMN IF EXISTS delivery_tracking_enabled;
DELETE FROM schema_migrations
WHERE filename IN ('019_ai_delivery_attempt_tracking.sql', '020_ai_delivery_gap_review.sql');
-- ===== To roll back ONLY 019 and 020: stop above this line and COMMIT. Everything below also rolls back 008-018. =====
-- 018 (the webhook_missing_user list of db:reconcile; the column only records that you reviewed an order)
DROP FUNCTION IF EXISTS webhook_missing_user_to_review();
DROP INDEX IF EXISTS idx_lemon_webhook_events_missing_user;
ALTER TABLE lemon_webhook_events DROP COLUMN IF EXISTS reviewed_at;
-- 017 (account deletion + re-registration guard; also stop the daily `db:process-deletions` job. Accounts already anonymised stay
-- anonymised — their e-mail is gone and cannot be restored; only the bookkeeping columns and the tombstone table are removed)
DROP FUNCTION IF EXISTS anonymise_user(UUID, TEXT, BYTEA, INTERVAL);
DROP FUNCTION IF EXISTS purge_email_tombstones(INTERVAL);
DROP TABLE IF EXISTS deleted_email_tombstones;
DROP INDEX IF EXISTS idx_users_deletion_due;
ALTER TABLE users DROP COLUMN IF EXISTS deletion_requested_at;
ALTER TABLE users DROP COLUMN IF EXISTS anonymised_at;
-- 016 (a function nothing in the application calls; also stop the daily `db:purge-signup-ips` job)
DROP FUNCTION IF EXISTS purge_signup_ips(INTERVAL);
-- 015 (first run `npm run webhooks:replay` and check `db:reconcile`: unprocessed stored deliveries would be
-- lost — Lemon got a 200 for them; export lemon_webhook_events if you need the history)
DROP FUNCTION IF EXISTS webhook_events_to_review(INTERVAL);
DROP TABLE IF EXISTS lemon_webhook_events;
-- 014 (indexes only; the caps are code — roll the code back too, or they just get slower)
DROP INDEX IF EXISTS idx_ai_credit_holds_user_created;
DROP INDEX IF EXISTS idx_ai_credit_holds_created;
-- 013 (export lemon_order_refunds first if you need the refund history)
DROP FUNCTION IF EXISTS refunded_orders_to_review();
DROP TABLE IF EXISTS lemon_order_refunds;
-- 012
ALTER FUNCTION post_credit_transaction(uuid, integer, credit_transaction_type, varchar, varchar)
  SECURITY INVOKER RESET search_path;
GRANT EXECUTE ON FUNCTION post_credit_transaction(uuid, integer, credit_transaction_type, varchar, varchar)
  TO PUBLIC;
-- 011
DROP FUNCTION IF EXISTS expire_stale_checkout_orders(INTERVAL);
DROP INDEX IF EXISTS idx_pending_checkout_pending_created;
-- 009
DROP FUNCTION IF EXISTS release_expired_ai_holds();
DROP TABLE IF EXISTS ai_credit_holds;            -- export it first if you need the history
-- 008 (restores pre-008 behaviour; post_credit_transaction keeps working without the guard)
DROP TRIGGER IF EXISTS trg_user_balances_write_guard ON user_balances;
DROP TRIGGER IF EXISTS trg_user_balances_no_truncate ON user_balances;
DROP TRIGGER IF EXISTS trg_credit_ledger_no_truncate ON credit_ledger_transactions;
DROP FUNCTION IF EXISTS guard_user_balance_write();
DROP FUNCTION IF EXISTS ledger_reconciliation();
-- 010: the token_version column is harmless for older code and is kept (re-applying 010 is
-- idempotent). Its tracking row must go too, otherwise a later roll-forward sees a gap.
DELETE FROM schema_migrations
WHERE filename IN ('008_ledger_hardening.sql', '009_ai_credit_holds.sql', '010_session_token_version.sql',
                   '011_checkout_order_expiry.sql', '012_function_search_path.sql',
                   '013_lemon_order_refunds.sql', '014_ai_daily_caps.sql', '015_lemon_webhook_inbox.sql',
                   '016_signup_ip_retention.sql', '017_account_deletion.sql',
                   '018_webhook_missing_user_review.sql');
COMMIT;
```

The new `post_credit_transaction()` body (sets a transaction-local flag) is harmless without the guard;
no need to revert it. Rolling back 009 or 015 requires the old code (§10.3) — the new code needs the tables.

### 10.2 Baseline only

`DROP TABLE schema_migrations;` returns the database to the pre-runner state (bookkeeping only).

### 10.3 Code

Redeploy the previous Express **and** Next.js builds together (rolling back only Express while the new
Next.js stays would send every user into a login loop: new Next requires `tv`, old Express does not
issue it). Users are logged out once more (tokens issued by the new Express are accepted by the old one,
but the old Next.js expects to set the cookie itself — one sign-in fixes it). Reservations still `held` at that moment
are never captured → those turns are free (not charged). Already captured turns are consistent with the
ledger. The old code works with 008/009 applied.

### 10.4 Env vars

Remove them; old code ignores them.

### 10.5 FINDING-03 claw-backs

Compensating `ADMIN_ADJUSTMENT` rows are reversed with an opposite `ADMIN_ADJUSTMENT` row — never by
deleting ledger rows.

### 10.6 Last resort

Restore the step-1 backup (Neon: reset the production branch to `pre-phase15-<date>`). Everything
written after the backup — sign-ups, purchases, AI usage — is lost and must be replayed (Lemon orders
can be re-delivered from the dashboard).

---

## 11. Handling a deletion or data request by hand

Use this when someone e-mails `SITE_OWNER_CONTACT_EMAIL` (or `SITE_OWNER_PRIVACY_EMAIL`) instead of using the profile page, or until the self-service path
(`Delete my account` / `Download my data`) has been proven end to end. Deadlines and legal grounds are for your lawyer; as I understand
them GDPR allows one month to answer (Art. 12(3)) and KVKK 30 days (Art. 13) **(unverified: not read in this project)**. Keep a private log:
date received, how identity was checked, what you did where, date answered.

### 11.1 Check who is asking

Answer only to the address on the account, and ask the person to **sign in and use the profile page** if they can: re-entering the password
(or a fresh Google sign-in) is exactly the identity check the service applies. If they cannot sign in, ask them to use "Forgot password"
first — the reset e-mail goes to the account's address, which proves control of it. Do not act on a request from a different address.

### 11.2 A copy of their data (access / portability)

Preferred: the person signs in and uses **Download my data** on the profile page (one JSON file, no secrets). By hand, with the owner URL
(never send query results through chat; they contain personal data):

```text
SELECT id, email, first_name, last_name, date_of_birth, is_verified, created_at, host(signup_ip) AS signup_ip, deletion_requested_at
  FROM users WHERE id = '<user id>';
SELECT provider, created_at FROM oauth_accounts WHERE user_id = '<user id>';           -- not the provider id
SELECT balance FROM user_balances WHERE user_id = '<user id>';
SELECT id, amount, transaction_type, reference_id, provider, created_at FROM credit_ledger_transactions WHERE user_id = '<user id>' ORDER BY id;
SELECT id, package_id, provider, currency, amount_minor, credits, status, created_at, completed_at FROM pending_checkout_orders WHERE user_id = '<user id>';
SELECT reference_id, operation_type, amount, status, created_at, settled_at FROM ai_credit_holds WHERE user_id = '<user id>';
```

Never include `password_hash`, any `*_tokens` table, or the stored Lemon message (`lemon_webhook_events.payload`).

### 11.3 Deletion in our own database

The account is **anonymised, never deleted** (the credit ledger is immutable and refers to the user id). Check first that the person is not an
administrator and understands the credits are lost. Then, with the owner URL, in the service folder:

```text
SELECT id, is_admin, deletion_requested_at, anonymised_at FROM users WHERE lower(email) = lower('<address>');
-- They asked in writing, so the 14-day cancellation window is treated as already served:
UPDATE users SET deletion_requested_at = NOW() - INTERVAL '15 days' WHERE id = '<id>' AND anonymised_at IS NULL AND NOT is_admin;
```
```bash
npm run db:process-deletions -- --dry-run   # shows how many accounts are due (this one, plus any other pending request that is 14 days old)
npm run db:process-deletions                # anonymises them, stores the keyed e-mail hash (if the guard is on) and prints counts only
```

An account with an open AI reservation or a recent pending checkout is postponed (the output says "postponed"); run it again the next day.
After it runs: the e-mail is `deleted-<id>@invalid`, name/date of birth/signup address are gone, the Google link and any one-time links are
deleted, every session is revoked, the ledger and balance are untouched. Tell the person what is **kept**: the purchase and credit records
(without their name or e-mail) as the accounting record.

### 11.4 Lemon Squeezy (payment provider, merchant of record) — what its official documents say (read 2026-11-01)

* **We cannot delete a customer there with an API call.** The API reference lists *Create, Retrieve, Update, List all* for customers and no
  delete (https://docs.lemonsqueezy.com/api/customers/the-customer-object); orders have *Retrieve, List, Generate invoice, Issue a refund* and
  no update/delete (https://docs.lemonsqueezy.com/api/orders). Subscriptions and license keys likewise list no delete endpoint.
* The only "archive" is a status on the customer: `PATCH /v1/customers/:id` accepts `name`, `email`, `city`, `region`, `country`, `status`, and
  `archived` means "This customer has been archived and will no longer receive marketing emails."
  (https://docs.lemonsqueezy.com/api/customers/update-customer). **The page does not say that archiving deletes or anonymises anything**, nor whether
  changing `name`/`email` reaches existing orders.
* Lemon Squeezy is the **merchant of record**: "The merchant of record is responsible for handling all payments and takes responsibility for
  everything relating to the purchase, including collecting sales tax, processing refunds and chargebacks"
  (https://docs.lemonsqueezy.com/help/payments/merchant-of-record). Its privacy policy (page dated 1 June 2021) says "You may have a right to request
  that we delete the personal information we hold about you at any time" and "we may retain your personal information for our compliance with a
  legal, accounting, or reporting obligation" (https://www.lemonsqueezy.com/privacy).
* Its DPA (https://www.lemonsqueezy.com/dpa) makes Lemon Squeezy the **processor** for data the merchant supplies: it will "promptly notify Company if it
  receives a request from a Data Subject" and "ensure that it does not respond to that request except on the documented instructions of Company";
  notices go to "Lemon Squeezy ATTN: Privacy Officer, 222 South Main Street Suite 500, Salt Lake City, UT 84101". (The privacy policy and the DPA
  describe its role differently — "Data Controller and/or Processor" versus "Data Processor" — so ask counsel which applies to buyers' data.)
* **Not answered by the documents I could read:** whether and how a buyer's name/e-mail on past orders can be erased or anonymised on request;
  the retention period for orders and invoices; a request channel for buyers (the contact address on the privacy page is obfuscated and I found no
  form); dashboard steps to archive or delete a customer; whether the DPA must be signed or applies automatically. `https://www.lemonsqueezy.com/gdpr` returns 404.

**What to do:** (1) tell the requester that the payment record at Lemon Squeezy is separate and is held under Lemon Squeezy's own terms; (2) write to
Lemon Squeezy's Privacy Officer (postal address above, or the contact address shown on the page when you open it in a browser) naming the customer's
order ids and e-mail, asking what they will erase or anonymise and what they must retain; keep the answer in your log and pass the relevant part on; (3) in the
dashboard, archive the customer if the option is there (this stops marketing e-mail only — do not describe it as erasure).

### 11.5 Resend (e-mail sending) — what its official documents say (read 2026-11-01)

* **Retention is automatic:** "While your account is active, email and log data is retained for 30 days on Free, Pro, and Scale plans. Enterprise plans
  include flexible data retention." Backups persist 7 days (https://resend.com/security/gdpr; same on https://resend.com/pricing). After you terminate the account,
  remaining data is deleted within 90 days (https://resend.com/legal/dpa).
* **No delete-an-email call is documented.** The email API pages list send, retrieve, list, update, cancel; the dashboard offers view, share link (valid 48 hours),
  logs and a CSV export (https://resend.com/docs/dashboard/emails/manage-emails). The only documented route to remove one message early is to ask:
  "If you need a specific message removed before the retention window ends, contact us" (https://resend.com/security/gdpr). The *Delete Contact* call
  (https://resend.com/docs/api-reference/contacts/delete-contact) is irrelevant here: this service only sends transactional mail through `POST /emails` and
  keeps no Resend contacts or audiences.
* **Roles:** for the mail content and addresses Resend is a **processor** and you are responsible for answering the person: "For Customer Data processed through the
  Service, you are responsible for responding to data subject requests" (https://resend.com/security/gdpr); the DPA says Resend "will advise the Data Subject to
  submit their request to Customer" and will assist you on request (https://resend.com/legal/dpa §7.1–7.2). Contacts: `privacy@resend.com` (DPA) and
  `support@resend.com` (their privacy policy, for erasure of their own processing).
* **Reduce what it stores:** Resend can turn off message-content storage for eligible teams (Pro/Scale for at least a month, a domain with an active website, over
  3,000 e-mails sent, under 5 % bounces; a paid add-on; via support) — https://resend.com/docs/knowledge-base/how-do-i-ensure-sensitive-data-isnt-stored-on-resend.md.
* **For counsel:** Resend stores customer data in the United States (https://resend.com/security/gdpr), and states "We don't sign third-party or country-specific data
  processing agreements or standard contracts, including … the Türkiye KVKK Standard Contract" (https://resend.com/security).
* **Not answered:** whether a single message can be deleted from logs and backups before 30 days; whether a suppression-list entry is removed on request.

**What to do:** nothing is needed for mail older than 30 days (it is gone). For a message younger than that which must go now, e-mail `privacy@resend.com` with the
recipient address and the approximate send time and ask for removal; log the answer. Remember our own e-mails contain a first name, links (not secrets that outlive
an hour/24 hours) and, for receipts, the order and amount.

### 11.6 After the request

Answer the person in writing: what you removed (our database: e-mail, name, date of birth, sign-in methods, signup address), what is kept and why (credit and
purchase records), what third parties hold (Lemon Squeezy per §11.4, Resend for at most 30 days per §11.5), and that the credits are gone. Add the request to your log.

## Optional hardening (recommended, not required for launch)

The `user_balances` guard is a safety net against application bugs, not a privilege boundary. The real
boundary — an application role that cannot `UPDATE`/`DELETE`/`TRUNCATE` the money tables and posts credits only
through the `SECURITY DEFINER` `post_credit_transaction()` — is implemented (SEC-12): migration `012`,
`database/roles/app-role.sql`, [`../security/DB_ROLES.md`](../security/DB_ROLES.md). It is **not** switched on by
default; rehearse it on a Neon branch first (`LAUNCH_CHECKLIST.md` §2.4), then change only the Express `DATABASE_URL`.

Phase 2C stages a replacement contract (V7) in `database/staged/phase-2c-v7/`. It is not applied, it is verified only as
role-substituted copies in a disposable database, and it is not production-approved. Its R transition (step S10) is a point
of no return: it removes the privileges the build in this repository relies on (`post_credit_transaction()`, direct writes
to holds and the webhook inbox), so capture, release, signup bonus, purchase crediting and webhook inbox handling would fail
with PostgreSQL `42501`. Do not apply it to a database that serves this build. See
[`../security/DB_ROLES.md`](../security/DB_ROLES.md).

---

See also: [`LAUNCH_CHECKLIST.md`](LAUNCH_CHECKLIST.md) (first deployment, monitoring, rotation, incident response,
rollback plan, known limitations) · [`LAUNCH_NOTES.md`](LAUNCH_NOTES.md) (accepted constraints).
