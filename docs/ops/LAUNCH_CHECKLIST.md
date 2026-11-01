# Launch checklist — first deployment

**Who runs this:** the project owner, by hand, top to bottom. Tick each box (`- [ ]` → `- [x]`) as you go and stop at
the first thing that does not match its "expected" line.

**What it covers:** the **first** production deployment of both services on a **fresh, empty** database: choosing
hosting, configuration, database, Lemon Squeezy live mode, first live verification, monitoring, secret rotation,
incident response, rollback, and what is knowingly not done.

**Related documents (read the one you need, do not duplicate it):**

| Document | Use it for |
| --- | --- |
| [`PRODUCTION_RUNBOOK.md`](PRODUCTION_RUNBOOK.md) | the full env-variable table, the exact checks and SQL, rollback SQL (§10), and the **upgrade** path for a database that already holds Phase 1 data (baseline etc.). **A first deployment does not baseline** — this checklist replaces §0–§4 of it for you. |
| [`LAUNCH_NOTES.md`](LAUNCH_NOTES.md) | constraints you accepted for launch (no discount codes, one Express instance, …) — summarised in §7 below |
| [`../security/DB_ROLES.md`](../security/DB_ROLES.md) | the optional least-privilege database role (SEC-12) |
| [`../security/SECURITY_FINDINGS.md`](../security/SECURITY_FINDINGS.md) | every finding, fix and decision behind the settings below |

> **Convention.** `<placeholders>` are yours to fill. Secret values are never printed by any command here;
> never paste one into chat, a ticket or a commit. Facts about third-party platforms were read from their official
> documentation on **2026-10-25** (sources at the end); prices and limits change — re-check the linked page before you
> pay. Anything I could not confirm in official documentation is marked **(not verified)**.

---

## A. Choose hosting (decide first; everything else uses the names below)

Two services, hosted separately:

* **Next.js** (`https://<site>`, the public origin = `FRONTEND_URL`) — the web app and the BFF (`/api/*`).
* **Express** (`https://<api>`, `auth-billing-service`) — must be **publicly reachable**: Lemon posts webhooks to it.
  Use its own hostname (for example `api.<your-domain>`) so the webhook URL never has to change.

### What each service needs

| | Express (`services/auth-billing-service`) | Next.js (repo root) |
| --- | --- | --- |
| Process | one **persistent** Node process. Build `npm ci && npm run build` (`tsc` → `dist/`), start `npm start` (`node dist/index.js`) — **verified**: the compiled service starts in production mode and answers `/health` | `npm ci && npm run build` (`next build`), start `npm start` (`next start`, honours `PORT`) — or a serverless platform that runs Next natively |
| Node | **24** (CI and every test here run Node 24); Next 16.4 itself requires ≥ 20.9 | same |
| Binding | `PORT` (default 4000) and **`HOST=0.0.0.0`** — see the pitfall in §1.4 | `PORT` |
| TLS | terminated by the platform; the services speak plain HTTP behind it | same |
| Instances | **exactly one**: rate limiters are in-memory per process, the expired-hold sweeper runs in-process (§7) | any number — but the per-user `/api/chat` limiter is in-memory per instance unless Upstash is configured (§7) |
| Health | `GET /health` → `200 {"status":"ok"}`, `503` while the database is unreachable | `GET /` |
| Shutdown | handles `SIGTERM`/`SIGINT` (closes the DB pool) | platform default |
| Outbound | HTTPS to Neon (TLS), Lemon, Resend, Google (certs) | Express, Gemini, PubChem are called from the **browser**, not the server (Wikipedia removed in SEO Part 2) |
| Disk | none | none |
| Env management | dashboard secrets; **never** a committed `.env` | same; `NEXT_PUBLIC_*` are baked in at **build** time |

The migration runner needs a **full checkout of this repository** (it reads `database/init/` relative to the repo
root); `db:reconcile` needs only the service folder with its dependencies installed (`npm ci` there); both need the
owner **direct** database URL (`MIGRATION_DATABASE_URL`). Run them from your machine or a scheduler (§5) — keep that URL
out of the Express host's runtime environment (the service itself uses `DATABASE_URL`).

### Express — options

| Option | Fit | Honest notes (from official docs) |
| --- | --- | --- |
| **Render web service** (paid instance) | **Recommended.** Always-on, managed TLS, git deploys, one instance by default | Must bind `0.0.0.0`; `PORT` defaults to `10000` (the service reads `PORT`). Zero-downtime deploys overlap the old and new instance for a short time (two sweepers / two limiter sets briefly — harmless, the sweeper is idempotent). Default Node is `24.22.1`; pin with `NODE_VERSION`. **Free instances sleep after 15 min and take ~1 min to wake, and Render says not to use them for production** — a sleeping Express makes Lemon's deliveries hit a cold service. Starter was listed at $7/month (Render article; confirm on the pricing page). Logs kept 7 days (Hobby workspace) / 14 (Pro) / 30 (Scale, Enterprise); log streaming for longer. Client-IP headers are **not** documented in Render's reference docs (see Next.js below). |
| Railway | works | Injects `PORT`; deploys are health-check gated. Hobby is $5/month with $5 of usage included; Free is $1/month of credit with 1 replica. Docs do not say which interface to bind — set `HOST=0.0.0.0` anyway. Client IP: `X-Real-IP`. |
| Fly.io | works, most hands-on | No free tier; smallest always-on machine $2.19/30 days; credit card required. Keep a machine running with `min_machines_running = 1` (or autostop off). **The repo has no `Dockerfile`/`fly.toml`** — you would add one. Client IP: `Fly-Client-IP`. |
| VPS / own container | works | Not evaluated here — you run TLS, restarts, patching yourself. |

### Next.js — options

| Option | Fit | Honest notes (from official docs) |
| --- | --- | --- |
| **Vercel Pro** | **Recommended** | `x-forwarded-for` is **overwritten** with the client's public IP (documented), so `CLIENT_IP_HEADER=x-forwarded-for` is correct and un-spoofable. Function duration defaults to 300 s (fluid compute), well above one AI turn (Gemini timeout 30 s + billing calls). **The Hobby plan is restricted to non-commercial personal use — anything that processes payment from visitors needs Pro** (Vercel's fair-use guidelines). Pro: $20/month including one seat and $20 usage credit (Vercel pricing, via search; confirm). Every page is rendered per request since the nonce CSP (SEC-18): function usage, not static files. Runtime logs are kept **1 hour (Hobby), 1 day (Pro), 30 days with Observability Plus** — short: see §5. Instant Rollback exists (env vars are **not** rolled back). **Many instances → set Upstash** (below). *Not verified:* Vercel's docs on running Next 16's `proxy.ts` — confirm on the first preview deployment that responses carry the nonce CSP (§4.0). |
| Render web service (paid) | works | One vendor with Express, one long-running process (the in-memory chat limiter is then valid, no Upstash). **Client IP is the catch:** Render's reference docs say only that its load balancer terminates TLS. A Render article says traffic passes through Cloudflare and Render's load balancers and recommends `CF-Connecting-IP`; a community thread reports `X-Forwarded-For` is appended to, not overwritten (so its leftmost entry is client-forgeable and its rightmost is a proxy). Our BFF trusts the right-most address of `CLIENT_IP_HEADER`: pick the header only after a test (see below), or every user shares one rate-limit bucket. **(not verified in reference docs)** |
| Railway / Fly.io | works | As for Express; long-running container, set `CLIENT_IP_HEADER` from their headers after testing. |

**Recommendation:** **Express on Render (paid instance)** and **Next.js on Vercel Pro**. The deciding factor is the
client IP: the BFF forwards the end user's IP to Express for every login/registration rate limit, and only Vercel
documents a header that cannot be forged. If you prefer one vendor, run both on Render **and** prove the client-IP
header first (test below). Either way: one Express instance, a paid always-on plan, `NODE_ENV=production`,
`HOST=0.0.0.0`.

**Upstash (Next.js):** on a platform that runs several Next instances (Vercel always does) set
`UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (both optional env vars in the root `.env.example`) so the
per-user `/api/chat` limit (10/min) is shared; without them each instance counts separately. The **daily AI caps
are database-backed** and hold either way. (Upstash pricing not evaluated.)

**Client-IP test (any platform, after the first deploy — runbook §7.1):** sign up two test accounts from two
different networks (home and phone data) and look in the database:

```sql
SELECT email, signup_ip FROM users ORDER BY created_at DESC LIMIT 5;   -- the two differ, and are public IPs of YOUR networks
```

If both show the same address (or a platform address), `CLIENT_IP_HEADER` is wrong — fix it before launch.

- [ ] Express host chosen: `<host>`, region `<region>` (same region as the Neon project)
- [ ] Next.js host chosen: `<host>`
- [ ] Paid, always-on plans on both (no sleeping instances, no Vercel Hobby)
- [ ] DNS: `<site>` → Next.js host, `<api>` → Express host (TLS certificates issued)

---

## 1. Pre-flight — configuration

### 1.1 Repository and CI

- [ ] `main` contains everything you intend to ship; the CI jobs `service`, `web`, `e2e` and `e2e production build`
      are green on that commit (`lint` is non-blocking by decision — §7).
- [ ] Note the commit SHA you deploy: `<sha>` (both services deploy **the same commit**).

### 1.2 Accounts

- [ ] **Neon** project (paid plan — §2.5)
- [ ] **Lemon Squeezy** store, **activated** (new stores start in test mode and must be activated before they can sell)
- [ ] **Resend** account and a domain you control (§4.3)
- [ ] **Google Cloud** project with an OAuth client of type *Web application* (§4.2)
- [ ] **Gemini API key** (Google AI Studio / Cloud) with a **budget alert** on its project (check on your Google
      billing page whether a budget can also cap spending — I did not verify that). The ceiling this repository enforces
      itself is `AI_DAILY_TURNS_GLOBAL` (§1.4)
- [ ] Hosting accounts (§A), DNS access, optionally **Upstash**

### 1.3 Generate the secrets

Three random secrets, **different from each other**, generated on your machine, stored in a password manager. Commands
(both verified to pass the services' strength checks):

| Secret | Command | Length | Notes |
| --- | --- | --- | --- |
| `INTERNAL_SERVICE_SECRET` | `openssl rand -base64 48` | 64 | **identical** on both services |
| `JWT_SECRET` | `openssl rand -base64 48` | 64 | **identical** on both services; ≥ 32 characters, not a placeholder, not low-variety |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | `openssl rand -hex 20` | 40 | **Lemon allows 6–40 characters, our service requires ≥ 32** — so *not* the 64-character command above. Same value in Lemon's webhook form and on Express |

No `openssl`? Node does the same: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"` (use
`randomBytes(20).toString('hex')` for the webhook secret).

### 1.4 Environment variables

Authoritative table with every default: [`PRODUCTION_RUNBOOK.md` §5](PRODUCTION_RUNBOOK.md#5-environment-variables-both-services-old-code-ignores-them).
For a first deployment you need at least:

**Express** (`<api>`)

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `HOST` | **`0.0.0.0`** |
| `PORT` | the platform sets it |
| `DATABASE_URL` | the Neon **direct** URL of the app role (owner role until you switch — §2.4), `?sslmode=require` |
| `JWT_SECRET`, `INTERNAL_SERVICE_SECRET` | §1.3 |
| `FRONTEND_URL` | `https://<site>` — exact origin, no path |
| `GOOGLE_CLIENT_ID` | the Web client id (§4.2) |
| `LEMONSQUEEZY_API_KEY` | the **live-mode** key (§3.3) |
| `LEMONSQUEEZY_STORE_ID` | numeric store id |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | §1.3 |
| `LEMONSQUEEZY_VARIANT_STARTER` / `_PRO` / `_ENTERPRISE` | the three **live** variant ids (numeric, distinct — §3.2) |
| `RESEND_API_KEY` | production key |
| `SENDER_EMAIL` | `Name <noreply@<your-mail-domain>>` on the **verified** Resend domain (`@resend.dev` is refused in production) |
| `AI_DAILY_TURNS_GLOBAL` | size it from your Gemini budget (default `3000`; per user default `200` via `AI_DAILY_TURNS_PER_USER`) |

Leave **unset**: `LEMONSQUEEZY_ALLOW_TEST_MODE`, `MOLECULESTUDIO_SKIP_DOTENV`, the discrete `DB_*` variables, and
`MIGRATION_DATABASE_URL` (that one lives only in *your* shell for the runner — §2). `TRUST_PROXY_HOPS`: keep the
default `0` unless you have verified exactly one proxy that appends the client IP; with `0` the BFF's `X-Client-IP`
(authenticated by the internal key) still gives per-user rate limits.

`UV_THREADPOOL_SIZE` (read by Node.js itself at startup, not by our code): password hashing (bcrypt, cost 10) for
login and registration runs on libuv's thread pool, 4 threads by default, so a 5th concurrent login waits. **First
check the instance's core count** (in a shell on the Express instance:
`node -e "console.log(require('node:os').availableParallelism())"`). More than one core → set `UV_THREADPOOL_SIZE` to
that count, never below `4`; one core or less → leave it unset (more threads than cores do not help). Measured
locally: 16 concurrent logins 78 → 151 per second with 8 threads (performance finding R6).

**Next.js** (`<site>`)

| Variable | Value |
| --- | --- |
| `JWT_SECRET`, `INTERNAL_SERVICE_SECRET` | the **same** values as Express |
| `FRONTEND_URL` | `https://<site>` — the same origin |
| `SITE_URL` | `https://<site>` — the same origin, **https, no path**. Server-only, read on every request (never `NEXT_PUBLIC_*`). **Without it the site is deliberately invisible to search engines** (SEO-20): `noindex` on every page, `Disallow: /` in robots.txt, an empty sitemap. Also `noindex` while `VERCEL_ENV` is anything but `production` (preview deployments, a custom domain on a non-production branch) |
| `AUTH_SERVICE_URL` | `https://<api>/api/auth` |
| `BILLING_SERVICE_URL` | `https://<api>/api/billing` |
| `USERS_SERVICE_URL` | `https://<api>/api/users` |
| `GEMINI_API_KEY` | production key (server-side only) |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | the same client id as Express's `GOOGLE_CLIENT_ID` — **baked in at build time**: changing it needs a rebuild/redeploy |
| `CLIENT_IP_HEADER` | per platform: Vercel `x-forwarded-for` (runbook §5 table); anything else only after the client-IP test (§A) |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | if the platform runs more than one instance |

`NODE_ENV` for `next start` is set by Next itself (the production-mode E2E asserts the `Secure` cookie flag without
setting it). `NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_*`, `GEMINI_MODEL`, `GEMINI_TIMEOUT_MS`, `GEMINI_MAX_OUTPUT_TOKENS`,
`BILLING_*`, `CSP_MODE` are optional; leave `CSP_MODE` unset (enforcing).

**HOST pitfall.** With production rules and no `HOST`, Express binds **`127.0.0.1`** — it starts, logs
`bound to 127.0.0.1:<port>`, and is unreachable from the platform's proxy (502/503 at the edge, nothing wrong in its
own logs). Verified locally: `HOST=0.0.0.0` → `bound to 0.0.0.0:<port>`; unset → `bound to 127.0.0.1:<port>`. The
first log line after a deploy must say `0.0.0.0`.

**FRONTEND_URL exactness.** Browsers send `Origin: https://<site>`; every POST/PUT/PATCH/DELETE is compared with
`FRONTEND_URL` and refused with `403 CSRF_REJECTED` on a mismatch. `www.` vs apex, `http` vs `https`, a path, a port or
upper case are all different origins — table in [runbook §7.0](PRODUCTION_RUNBOOK.md#70-first-a-real-sign-in-on-the-public-origin-do-this-before-anything-else).
If users can reach the site on several hostnames, redirect all of them to `<site>` at the platform/DNS level.

### 1.5 `npm run check:config`

Put each host's variables in a local file **whose name git ignores** (the runbook's old `express.env` example is *not*
ignored — do not use it):

```bash
# repo root; both names match .gitignore (.env.*.local)
#   .env.launch-express.local   <- the Express variables above, one NAME=value per line
#   .env.launch-next.local      <- the Next.js variables above
git check-ignore -v .env.launch-express.local .env.launch-next.local     # must print both lines
npm run check:config -- --service ./.env.launch-express.local --web ./.env.launch-next.local
```

- [ ] Output ends with `[check:config] OK — no problems found.` and exit code `0` (`1` = problems, `64` = usage error).
      It prints variable **names** only, never values.
- [ ] It catches: every boot-time check of both services, `.env.example` placeholders, `INTERNAL_SERVICE_SECRET` /
      `JWT_SECRET` / `FRONTEND_URL` / Google client id differing between the two, a missing, non-https, path-carrying or
      `FRONTEND_URL`-different `SITE_URL` (a `PROBLEM`: the production site would be hidden from search engines), `AI_HOLD_TTL_SECONDS` below 2 ×
      the longest turn (defaults: 600 s against 117.25 s — R20), and `LEMONSQUEEZY_ALLOW_TEST_MODE` set to a truthy value
      (`true`, `1`, `yes`, `y`, `on`) in the Express file — a `PROBLEM` naming the variable, exit `1`. Unset, empty and
      `false` / `0` / `no` / `off` pass; any other value only warns (the service honours exactly `true`, so it is inert).

### 1.6 `npm run check:launch-content` (trust pages, SEO Part 2)

```
npm run check:launch-content
```

- [ ] Exit code `0`: no `TODO(owner):` placeholder left in `src/lib/legal/site-owner.ts` (legal name, country, postal address,
      contact email, governing law, refund policy, hosting providers, log retention, Gemini data use, account deletion,
      **signup-address purge job (§5.1 — mandatory)**, effective date). Exit `1` lists each remaining field. While any remains, `/about`, `/contact`, `/privacy`, `/terms` show
      a "Draft" notice, are `noindex` and out of the sitemap, and no Organization JSON-LD is emitted.
- [ ] A lawyer has reviewed `/privacy` and `/terms` (no script can check this). Sources of every privacy statement and the
      open points: `docs/seo/TRUST_PAGES.md`.
- [ ] The check reads only the file or env you hand it. It cannot see what the **host's dashboard** really holds, so
      the file must be a faithful export of it (§3.5 re-confirms on the live host).
- [ ] Delete both files afterwards (`rm .env.launch-*.local`).
- [ ] The same values are now entered in the two hosts' secret stores (not the files).

---

## 2. Database (Neon, PostgreSQL 18)

### 2.1 Project

- [ ] Create the Neon project on **PostgreSQL 18** (production is rehearsed and run on the same major version CI uses),
      in the region of the Express host. `SELECT version();` must start with `PostgreSQL 18`.
- [ ] Plan: **paid**. The Free plan keeps a **6-hour** history window; Launch allows up to **7 days**, Scale up to
      **30 days** (Neon plans page) — see §2.5.
- [ ] Copy two connection strings into your password manager: the **direct** URL (host **without** `-pooler`) and note
      the pooled one exists. **The runner refuses pooled URLs** (`-pooler` hosts, port `6543`, `pgbouncer=true`) because it
      holds a session-level advisory lock, which Neon's pooler (transaction mode) does not support.
- [ ] The app uses the **direct** URL too (`DATABASE_URL`): one long-lived process with a 20-connection pool. The
      service's SQL contains nothing the pooler forbids (no session advisory locks, `SET`, `PREPARE`, `LISTEN`,
      temp tables) so a pooled URL would work by code review, but that is **untested** — keep direct.
- [ ] Optional: disable scale-to-zero (paid plans only). Reactivation takes "a few hundred milliseconds" (Neon docs),
      inside the service's 2 s connect timeout; the webhook stores each delivery with one bounded insert (3 s) and
      answers `503` if it cannot, so Lemon retries it (R19) — so this is about steady latency, not correctness.

### 2.2 Rehearsal on a branch (do this before touching production)

A Neon branch is a copy-on-write clone; branch from the production branch (empty today) so the rehearsal has the
same settings:

```bash
cd services/auth-billing-service
export MIGRATION_DATABASE_URL='postgresql://…<rehearsal branch, direct, no -pooler>…?sslmode=require'
npm run db:migrate:status      # every file "pending", 15 files (001 … 015)
npm run db:migrate             # expected last line: [migrate] <host>: mode=fresh baselined=0 applied=16
npm run db:migrate             # again → mode=tracked baselined=0 applied=0   (the runner is idempotent)
npm run db:migrate:status      # all 16 "applied"
npm run db:reconcile           # exit 0: two "OK" lines
```

(Expected outputs above are what the same commands print against a fresh local PostgreSQL 18 — checked for this
checklist.) Then in the Neon SQL editor (or `psql "$MIGRATION_DATABASE_URL"`):

```sql
SELECT count(*) AS applied FROM schema_migrations;                         -- 14
SELECT prosecdef, proconfig, has_function_privilege('public', oid, 'EXECUTE') AS public_exec
  FROM pg_proc WHERE proname = 'post_credit_transaction';                  -- t | {"search_path=public, pg_temp"} | f
SELECT proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = 'public' AND proconfig::text LIKE '%search_path=public, pg_temp%' ORDER BY 1;
  -- expire_stale_checkout_orders, guard_user_balance_write, ledger_reconciliation,
  -- post_credit_transaction, refunded_orders_to_review, release_expired_ai_holds
SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1;
  -- ai_credit_holds, credit_ledger_transactions, lemon_order_refunds, oauth_accounts, password_reset_tokens,
  -- pending_checkout_orders, revoked_tokens, schema_migrations, user_balances, users, verification_tokens
```

- [ ] All of the above match, including `mode=fresh … applied=16` and `SELECT version()` = PostgreSQL 18.
- [ ] You did **not** run `db:setup` (it is for local databases: it connects to the `postgres` maintenance database to
      `CREATE DATABASE`) and did **not** run `--baseline` (that is only for a database created before the runner
      existed; on an empty database the runner picks `mode=fresh` by itself).
- [ ] The test suites cannot run against Neon (the database guard refuses every non-local host, by design) — the
      rehearsal is the real runner plus the SQL above. Optional, for a full-stack rehearsal: boot **staging** copies
      of both services against this branch with Lemon **test mode** and `LEMONSQUEEZY_ALLOW_TEST_MODE=true` on the
      staging Express only, and walk §4.
- [ ] Never **re-run an applied migration file by hand** (runbook §4 explains why: re-running `003` undoes `012`).
- [ ] Delete the rehearsal branch when done.

### 2.3 First-time migration of production

- [ ] Create a Neon branch of production named `pre-launch-<date>` (instant, costs nothing — a restore point).
- [ ] Same commands as §2.2 with the **production** direct URL in `MIGRATION_DATABASE_URL` (`--dry-run` is available
      if you want the plan first). Expected: `mode=fresh baselined=0 applied=16`, then the SQL checks, then
      `npm run db:reconcile` → exit 0.
- [ ] `unset MIGRATION_DATABASE_URL` in that shell afterwards.

### 2.4 Optional: least-privilege application role (SEC-12)

The service may run as the schema owner at launch (accepted — LAUNCH_NOTES). To switch, **rehearse it on a branch
first**, following [`DB_ROLES.md`](../security/DB_ROLES.md):

- [ ] On the rehearsal branch: create the login role `moleculestudio_app`, run `database/roles/app-role.sql` as the
      owner (the script refuses to run before migration 012), point a staging Express `DATABASE_URL` at the role.
- [ ] Walk §4 completely against staging — registration, verification, login, profile, password reset, Google
      sign-in, checkout → webhook, AI turn, refund recording. All of these are covered by
      `services/auth-billing-service/tests/api/app-role.test.ts` locally; the rehearsal proves the role on Neon.
- [ ] Prove the boundary: as the app role `UPDATE user_balances SET balance = 999` must fail with
      `permission denied`.
- [ ] Production switch: migrations, `db:reconcile` and the cron SQL keep the **owner** URL
      (`MIGRATION_DATABASE_URL`); only the Express `DATABASE_URL` changes. Rollback = point it back at the owner.
- [ ] Re-run `app-role.sql` after any future migration that adds a table the service uses (015 added
      `lemon_webhook_events`: the role needs `SELECT, INSERT, UPDATE` on it, which the current script grants).

### 2.5 Backups and point-in-time restore

- [ ] History window set to the maximum your plan allows (Launch: up to 7 days; the default is 1 day).
- [ ] Understand the restore: Neon's instant restore reverts a **root** branch to an earlier timestamp or LSN and is
      "a complete overwrite of the database timeline"; Neon first saves the pre-restore state as a backup branch named
      `{branch_name}_old_{head_timestamp}`. You can also create a branch from a past point in time.
- [ ] **Practise once before launch:** create a branch from a point a few minutes in the past and check it
      (`SELECT count(*) FROM users;`), then delete it.
- [ ] Optional logical backup (direct URL, from your machine): `pg_dump --format=custom --no-owner "$MIGRATION_DATABASE_URL" > molecule-<date>.dump`, verify with `pg_restore --list molecule-<date>.dump | head`.
- [ ] After any restore: Lemon orders created after the restore point are re-delivered from Lemon's webhook log
      (§6.3), and `npm run db:reconcile` must be exit 0 before reopening.

---

## 3. Lemon Squeezy: test → live

Lemon keeps **test mode and live mode separate**. Work in **live mode** for every step below.

- [ ] **Store activated** (live mode available).
- [ ] **3.1 Packs (live).** Products created in test mode **do not transfer automatically** (a "Copy to Live Mode"
      option exists per product). Check each live variant against the service's catalogue — **USD only**, and the
      webhook refuses an order whose amount differs:

      | Pack (`id`) | Price | Credits |
      | --- | --- | --- |
      | Starter (`starter`) | $5.00 (500 cents) | 50 |
      | Pro (`pro`) | $20.00 (2000 cents) | 250 |
      | Studio (`enterprise`) | $50.00 (5000 cents) | 700 |

- [ ] **3.2 Variant ids.** Read the three numeric variant ids **from the live dashboard** — Lemon's documentation does
      not say whether copying keeps test-mode variant ids, so never assume they equal the test ones. Set
      `LEMONSQUEEZY_VARIANT_STARTER`, `_PRO`, `_ENTERPRISE` on Express (numeric, distinct; Express refuses to start
      otherwise). Optionally the same three as `NEXT_PUBLIC_LEMONSQUEEZY_VARIANT_*` on Next.js (build time).
- [ ] **3.3 API key and store id.** Create an API key **in live mode** ("API keys created in test mode will interact
      with test mode store data only") → `LEMONSQUEEZY_API_KEY`; `LEMONSQUEEZY_STORE_ID` = the numeric store id (an order
      from a different store id is ignored by the webhook).
- [ ] **3.4 Webhook (live mode)** — Settings → Webhooks → add:
      - URL `https://<api>/api/billing/webhooks/lemonsqueezy` — the **Express** host, not the Next.js site (the BFF drops
        `X-Signature`);
      - signing secret = `LEMONSQUEEZY_WEBHOOK_SECRET` (§1.3, ≤ 40 characters);
      - events: **`order_created`** and **`order_refunded`** (anything else is acknowledged and ignored; Lemon documents
        no dispute/chargeback event — §6.2, §7);
      - Lemon's docs do not state whether webhooks are shared between modes — confirm in the dashboard that this
        webhook is listed under **live** mode.
- [ ] **3.5 Test mode is off in production.** `LEMONSQUEEZY_ALLOW_TEST_MODE` is **not set** on Express (§1.5; `check:config` fails on a truthy value). In
      production a test-mode order is logged `[Webhook] Ignoring test-mode order` and never credited (SEC-13).
- [ ] **3.6 No discount codes.** Create none, and do **not** copy any from test mode ("Copy to Live Mode" also exists
      for discounts). The live Discounts list must be empty. Reason: the webhook accepts an order when `total`,
      `subtotal` **or** the line price equals the pack price, and `subtotal` is before discounts — a 100 % code would
      credit the full pack. Lifting this needs a code change first (validate the paid amount, `total − tax`, with a
      test) — [`LAUNCH_NOTES.md`](LAUNCH_NOTES.md).
- [ ] **3.7 Checkout only through the app.** Never share raw Lemon store/product links: they carry no `custom_data`
      (user id, pack, pending order), so attribution falls back to the buyer's email (README).
- [ ] **3.8 Webhook reachability.** Use the dashboard's test/simulate option if offered, or just look at §4.4: Express
      must log `[Webhook] Acknowledged 200 OK`. Delivery history, payloads and **resend** are on the webhooks settings
      page. Lemon's documented behaviour ([webhook requests](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests),
      [sync with webhooks](https://docs.lemonsqueezy.com/guides/developer-guide/webhooks)): only a `200` counts as
      received; any other answer is retried up to three more times with exponential backoff ("e.g. 5 secs, 25 secs,
      125 secs"), then the delivery is failed and only a manual resend remains. **No response timeout is
      documented**; Express answers every delivery within ≈ 3 s (`WEBHOOK_STORE_TIMEOUT_MS`). Express stores each
      delivery before its `200` (R19): a `503` (`[Webhook] NOT STORED`) means the database was unavailable and Lemon
      will retry — only a delivery Lemon shows as failed after its last retry (≈ 2.5 min of database outage) needs a
      resend.

### 3.9 The first real live purchase (minimal pack) and the refund review

Do this with **your own card**, the **Starter** pack ($5, 50 credits), after §4.1–4.2 gave you a verified account:

1. On `https://<site>/pricing` sign in and buy Starter; complete the live Lemon checkout.
2. Expected within seconds, Express logs: `[Webhook] Acknowledged 200 OK` → `[Webhook] Processing user:` →
   `[Webhook] Credited user <uuid> +50`; you receive Lemon's receipt and ours; the dashboard shows 50 more credits.
3. Database:

   ```sql
   SELECT amount, transaction_type, reference_id, provider FROM credit_ledger_transactions
    WHERE user_id = '<uuid>' ORDER BY id DESC LIMIT 1;     -- 50 | CREDIT_PURCHASE | ls_order_<id> | lemonsqueezy
   SELECT status FROM pending_checkout_orders WHERE user_id = '<uuid>' ORDER BY created_at DESC LIMIT 1;   -- completed
   SELECT status, outcome FROM lemon_webhook_events WHERE provider_order_id = '<order id>';               -- processed | credited
   ```
4. **Refund it** in the Lemon dashboard (refunding your own test purchase also rehearses the procedure). Expected:
   Express logs `[Webhook] Recorded refund — credits NOT changed; review with db:reconcile`; the balance is **still 50**.
5. `npm run db:reconcile` (§5) → **exit 2** and a `refunded_order_credited` table naming the order, user, credits and
   refunded amount.
6. Decide (credits are **never clawed back automatically**): keep as goodwill, or take them back — for a refund of the
   whole order, post a correction through the ledger (it refuses to take a balance below zero, error `P0001`):

   ```sql
   SELECT post_credit_transaction('<uuid>', -50, 'ADMIN_ADJUSTMENT', 'refund-review-<order id>');
   ```
7. Mark it reviewed (the job stays at exit 2 until every listed order is):

   ```sql
   UPDATE lemon_order_refunds SET reviewed_at = NOW(), review_note = '<decision, your initials>'
    WHERE provider_order_id = '<order id>' AND reviewed_at IS NULL;
   ```
8. `npm run db:reconcile` → exit 0.

- [ ] Steps 1–8 done and the numbers matched. (An order partly refunded, then refunded further, appears again as a new
      row — review it again.)

---

## 4. First live verification (in this order, in a normal browser window)

> An empty database has no accounts, so the order below creates the first one by registering (which also proves email).
> Do not use a private window for 4.2: you want the real cookie jar.

### 4.0 Service checks and headers (no browser)

```bash
curl -s https://<api>/health                                                              # {"success":true,…,"status":"ok","database":"connected"}
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<api>/api/billing/consume        # 404 (no internal key)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<site>/api/billing/refund        # 404 (blocked by the BFF)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<site>/api/billing/webhooks/lemonsqueezy   # 404
curl -sI https://<site>/ | grep -iE '^(content-security-policy|strict-transport-security|x-frame-options|x-content-type-options|referrer-policy|permissions-policy|cross-origin-opener-policy|x-powered-by)'
```

- [ ] `/health` is `200 … "database":"connected"`; the Express log's first lines say `bound to 0.0.0.0:<port>`.
- [ ] The header check shows a `content-security-policy` with `script-src 'self' 'nonce-…' 'strict-dynamic'` (a different
      nonce on each request), `strict-transport-security: max-age=63072000; includeSubDomains`, `x-frame-options: DENY`,
      `x-content-type-options: nosniff`, `referrer-policy: strict-origin-when-cross-origin`,
      `cross-origin-opener-policy: same-origin-allow-popups`, and **no** `x-powered-by`.
- [ ] No `FATAL:` line in either service's startup log.
- [ ] **Search signals (SEO-20)** — on the live origin, with no `VERCEL_ENV` surprises:
      `curl -s https://<site>/robots.txt` shows `Allow: /`, `Disallow: /api/` and `Sitemap: https://<site>/sitemap.xml`
      (**not** `Disallow: /`); `curl -s https://<site>/sitemap.xml` lists the five public pages; `curl -sI https://<site>/`
      has **no** `x-robots-tag`; `curl -s https://<site>/ | grep -o '<meta name="robots"[^>]*>'` prints nothing and
      `grep -o '<link rel="canonical"[^>]*>'` prints `https://<site>`. A `noindex` here means `SITE_URL` is wrong or
      the deployment is not Vercel's production one. (Rehearse the opposite on a preview URL: robots.txt must say
      `Disallow: /`.) More in `docs/seo/SEO_FINDINGS.md`; Search Console / Bing setup is Part 3.

### 4.1 Register and verify the email (also proves Resend)

- [ ] Resend → Domains: your **sending domain (a subdomain such as `mail.<your-domain>` is recommended)** shows
      **Verified**. Resend lists DNS records on the domain's page — copy them exactly: a **DKIM** TXT record
      (`resend._domainkey`) and **SPF** (a TXT record plus an MX record on a `send` subdomain); a CNAME proxied by your
      DNS provider (for example Cloudflare's orange cloud) prevents verification. Verification usually completes within
      15 minutes, up to 72 hours. **DMARC is optional** in Resend's docs; add one for deliverability if you can.
- [ ] `SENDER_EMAIL` uses an address on that domain.
- [ ] Register on `https://<site>/signup` with a real mailbox (Gmail is a good test). The verification email arrives
      (spam folder counts as a fail), its link starts with `https://<site>/verify-email?token=`, and in Gmail → *Show
      original* **SPF: PASS** and **DKIM: PASS** (and DMARC: PASS if configured).
- [ ] Click the link: you land signed in. Also try *forgot password* (`/forgot-password`): the reset mail arrives with a
      `https://<site>/reset-password?token=` link.
- [ ] No Express log line contains the link or the token (production never logs mail bodies).

### 4.2 Sign-in on the public origin (proves `FRONTEND_URL`)

Runbook §7.0 in short: open the site exactly as users reach it, sign in.

- [ ] The dialog closes, the navbar shows the account and the credit balance (you start with the sign-up bonus).
- [ ] DevTools → Network: `POST /api/auth/login` is `200` with `Set-Cookie: session_token=…; HttpOnly; Secure;
      SameSite=Strict`, and **no** token in the response body.
- [ ] Failure looks like "Cross-site request refused." / `403 CSRF_REJECTED`: fix `FRONTEND_URL` (both services),
      redeploy, repeat. Repeat on every hostname users can land on (they should all redirect to `<site>`).
- [ ] Sign out (`POST /api/auth/clear-cookie` → `200`) and in again.

### 4.3 Google sign-in under the enforced CSP (cannot be tested offline — first live check)

- [ ] Google Cloud → the OAuth client (type *Web application*): **Authorized JavaScript origins** contains
      `https://<site>` exactly (Google's docs: "Add the URI of your website to Authorized JavaScript origins"). No
      redirect URI is needed for the callback mode this app uses. Same client id in Express `GOOGLE_CLIENT_ID` and Next.js
      `NEXT_PUBLIC_GOOGLE_CLIENT_ID` (`check:config` compares them; the web one needs a rebuild to change).
- [ ] Consent screen: check its publishing status. Per Google's docs an app that only uses *Sign in with Google*
      (name, email, profile) is not limited to the 100 test users, but **"In production"** is the state that is "available
      to any user with a Google Account" — set it for launch.
- [ ] Open `/login`: the Google button renders. DevTools → Console shows **no** "Refused to load/connect/frame …
      Content Security Policy" line. Sign in with a Google account that has **not** registered by password: you are
      signed in, a balance row exists.
- [ ] If the button is missing or sign-in fails: set `CSP_MODE=report-only` on Next.js and redeploy **only to confirm the
      CSP is the cause**; copy the violation lines (`violated-directive`, `blocked-uri`) and fix `src/lib/security/csp.ts`
      (Google's documented values are `script-src https://accounts.google.com/gsi/client`, `frame-src
      https://accounts.google.com/gsi/`, `connect-src https://accounts.google.com/gsi/`, `style-src
      https://accounts.google.com/gsi/style` — the policy already uses them under `'strict-dynamic'`). Then unset
      `CSP_MODE` again.
- [ ] Also confirm the page still loads a 3D scene (`/explore`) with no CSP violations in the console.

### 4.4 Checkout → webhook → credits

- [ ] This is the §3.9 live purchase (steps 1–3). Expected: the Express log lines listed there, the balance +50,
      `completed` pending order, both receipts.

### 4.5 AI turn → capture

- [ ] In the AI Lab (`/ai-lab`) ask one question. An answer arrives and the balance drops by 1.

  ```sql
  SELECT status, amount, ledger_id FROM ai_credit_holds WHERE user_id = '<uuid>' ORDER BY created_at DESC LIMIT 1;  -- captured | 1 | <id>
  SELECT amount, transaction_type FROM credit_ledger_transactions WHERE id = <ledger_id>;                          -- -1 | CREDIT_CONSUMPTION
  ```
- [ ] No `CAPTURE_FAILED`, `INTERNAL_AUTH_REJECTED` or `BILLING_NOT_CONFIGURED` in the Next.js logs for an hour.
- [ ] Answers with maths show garbled plain text where formulas are — a **known limitation** (§7), not a bug of this
      deployment.

### 4.6 Logout and the closing checks

- [ ] Sign out; `/dashboard` redirects to `/login`.
- [ ] `npm run db:migrate:status` (all 16 applied) and `npm run db:reconcile` (exit 0 — or the refund rows you have
      not reviewed yet).
- [ ] The client-IP test from §A passed (two networks → two different `signup_ip` values).

### 4.7 Latency baseline on the real hosts (after the first deploy)

The local performance measurements (`docs/performance/PERFORMANCE_FINDINGS.md`, recommendation R8) cannot see the two
network legs that decide production capacity. One AI turn makes **21 sequential database round trips** and **2
Next.js → Express calls**; a balance read makes 3 and 1. Measure both legs once, on the real instances:

- [ ] **Express → Neon round trip.** In a shell on the Express instance, from the service directory:
      `node -e "const pg=require('pg');(async()=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();const t=[];for(let i=0;i<50;i++){const s=performance.now();await c.query('SELECT 1');t.push(performance.now()-s)}t.sort((a,b)=>a-b);console.log('median ms',t[25].toFixed(2));await c.end()})()"`
      Expect about 1–2 ms in the same region; above ~5 ms, check that Neon and Render are in the same region (§A).
- [ ] **Vercel → Render.** Confirm in the Vercel project settings that the function region is the region closest to
      the Express instance (§A). From the Express instance shell,
      `curl -o /dev/null -s -w "%{time_connect}
" https://<site>/` gives the TCP connect time ≈ one round trip to
      Vercel's nearest edge (an approximation of the function's leg — not verified against Vercel's own figures).
- [ ] **Write the numbers down** and estimate a chat turn's overhead (Gemini excluded) as ≈ 17 ms + 21 × DB round trip
      + 2 × Vercel → Render round trip. Local reference: a 2.7 ms DB round trip gave 64 ms at one user and about 146
      turns/s of billing throughput for one Express instance (findings § Part 1). Re-check after any region change.

---

## 5. Monitoring and alerting

Nothing in this repository pages you; wire these up before announcing the launch.

### 5.1 Scheduled jobs

| Job | Command | Cadence | Alert on |
| --- | --- | --- | --- |
| Reconciliation | `npm run db:reconcile` (service folder, `MIGRATION_DATABASE_URL` = owner direct URL) | daily | any non-zero exit: **2** = findings (`balance_mismatch`, `missing_balance_row`, `capture_failed`, `hold_expired_unsettled`, `refunded_order_credited`, `webhook_unprocessed`), **1** = the job itself failed — never treat as green |
| Stale checkouts | `psql "$MIGRATION_DATABASE_URL" -v ON_ERROR_STOP=1 -c "SELECT expire_stale_checkout_orders();"` | hourly | job failure (bookkeeping only: never touches credits) |
| **MANDATORY** — Signup address retention (privacy, migration 016) | `npm run db:purge-signup-ips` (service folder, owner URL; `-- --days N` to change the 90), with `PURGE_HEARTBEAT_URL` set to a heartbeat monitor's ping URL | daily | **two alerts, both required:** (1) any non-zero exit of the job (`1` = it failed or migration 016 is missing, `2` = it purged but the heartbeat ping failed, `64` = bad argument); (2) **no ping from the heartbeat monitor within 26 hours** (e.g. healthchecks.io-style "period 1 day, grace 2 h", email/SMS) — this is what catches a job that **never ran** (a scheduler that is disabled, deleted or out of credit sends no exit code at all). The job prints a count, never an address, and sends the ping only after a successful purge; the ping URL is a secret (only its host is ever printed). Clears `users.signup_ip` only; touches no ledger, balance or billing row. **The privacy policy states "cleared automatically once the account is 90 days old" only after you fill `SITE_OWNER.signupIpPurgeJob` (`src/lib/legal/site-owner.ts`); until then it says the clearing is planned. Fill it only when both alerts exist and a test run showed the ping arriving** |

Where to run them: `db:reconcile` needs the service folder with `npm ci` done, Node, and the owner URL; the cron SQL needs
`psql` and that URL. Keep the owner URL out of the Express host's runtime environment. Options: **(a)** a scheduled GitHub Actions workflow (`schedule:`)
with the URL as a repository secret — a failed run (exit ≠ 0) emails you; note this puts a production database credential
in GitHub and that this repo's workflows deliberately use no secrets today (create a read-only database role for it if
you can; untested here); **(b)** a cron job on your hosting platform that builds from the repo; **(c)** cron on a machine
you control. The expired-hold sweeper needs no job (Express runs it every 5 minutes). I have not added a workflow —
tell me if you want one written.

### 5.2 Log lines to alert on (exact strings, case-sensitive substring search)

| Where | Substring | Means / action |
| --- | --- | --- |
| Express | `[Webhook] Rejected:` | webhook with a bad signature (wrong secret, wrong URL, or an attacker). A burst after a deploy = secret mismatch (§6.1) |
| Express | `[Webhook] FAILED background credit allocation` | a stored delivery still failed after the service's 10 automatic attempts (≈ 10 min) — its credits are missing. Fix the cause (`last_error` in `db:reconcile`), then run **`npm run webhooks:replay`** on the Express host (idempotent per order). **Page on it** |
| Express | `[Webhook] NOT STORED — answered 503 so Lemon retries the delivery` | the database could not take the delivery within 3 s; Lemon retries after 5 s, 25 s, 125 s. Alert when it repeats for more than ~2 min: after Lemon's last retry the delivery shows as failed in Lemon's webhook log → **resend** it there |
| Express | `[Webhook] Processing failed — the event is stored and will be retried` | transient (database slow or down); retried every minute. No action unless it ends in the `FAILED` line above |
| Express | `Unable to resolve package`, `Amount mismatch`, `Unexpected currency`, `Missing user identity`, `Order from another store`, `Ignoring test-mode order` | a signed order was **not** credited by design — usually mis-set variant ids, prices, store id or a test-mode order; compare with the Lemon order, fix, then resend |
| Express | `[Webhook] Recorded refund` | a refund arrived — expect `refunded_order_credited` in the next reconcile |
| Express | `[credits] AI_CAPACITY_REACHED` | the **global** daily AI cap was hit (users get `503 AI_CAPACITY_REACHED`) — raise `AI_DAILY_TURNS_GLOBAL` or investigate |
| Express | `[credits] CAPTURE_FAILED` | a debit could not be posted (not charged) |
| Express | `[auth] Failed to send` / `[email] Resend API error` | verification/reset/receipt mail failing — check Resend |
| Express | `/health` → `503`, `DATABASE_UNAVAILABLE` | database unreachable |
| Express | `[db] Request failed: database unavailable` (often with `timeout exceeded when trying to connect`) | the database could not serve requests — usually the pool's 20 connections all busy (slow or saturated database): requests wait 2 s and answer **503 `DATABASE_UNAVAILABLE`** with `Retry-After` (R18); webhooks answer 503 and Lemon retries (R19). Check Neon latency and load (performance Part 3) |
| Next.js | `[billing] CAPTURE_FAILED`, `[billing] RELEASE_FAILED` | a turn went uncharged / a hold will expire uncharged (revenue loss, not customer harm) |
| Next.js | `[billing] INTERNAL_AUTH_REJECTED` | `INTERNAL_SERVICE_SECRET` differs between the services — AI Lab is down |
| Next.js | `[billing] BILLING_NOT_CONFIGURED` | `BILLING_SERVICE_URL` / `INTERNAL_SERVICE_SECRET` missing |
| both | `FATAL:` | refused to start (configuration) |

Per-user daily-cap hits (`429 AI_DAILY_LIMIT`) are returned to the user but not logged; watch usage in SQL:

```sql
SELECT count(*) AS turns_24h FROM ai_credit_holds WHERE created_at > NOW() - interval '24 hours';        -- compare with AI_DAILY_TURNS_GLOBAL; alert at 80 %
SELECT user_id, count(*) AS turns_24h FROM ai_credit_holds WHERE created_at > NOW() - interval '24 hours'
 GROUP BY user_id ORDER BY 2 DESC LIMIT 10;                                                              -- AI_DAILY_TURNS_PER_USER is the ceiling per row
SELECT status, count(*) FROM ai_credit_holds WHERE status IN ('capture_failed','expired')
   AND settled_at > NOW() - interval '24 hours' GROUP BY status;                                         -- abnormal settlements
SELECT count(*) FROM pending_checkout_orders WHERE status = 'pending' AND created_at < NOW() - interval '1 hour';  -- checkouts that started and never paid (informational)
```

### 5.3 Log retention (this decides how long you can investigate)

- Vercel runtime logs: **1 hour (Hobby), 1 day (Pro), 30 days with Observability Plus** (Vercel docs). With Pro, a
  `CAPTURE_FAILED` correlation (`hold_expired_unsettled` → BFF logs) is only possible **the same day** — keep the
  reconcile job early in the day and act on it, or buy Observability Plus / export logs (Vercel documents Drains; plan
  availability not verified here).
- Render logs: **7 days (Hobby workspace), 14 (Pro), 30 (Scale/Enterprise)**; stream to a third-party provider for longer.
- Databases keep what matters: the immutable ledger and `ai_credit_holds` (with `settle_reason`) answer most questions
  without logs.

### 5.4 Outside the services

- [ ] An external uptime monitor on `https://<api>/health` (503 when the database is down) and `https://<site>/`.
- [ ] Lemon dashboard: webhook delivery failures visible on the webhooks page; **weekly**: disputes/chargebacks (Lemon
      handles them and documents no webhook for them — §7).
- [ ] Google Cloud **budget alert** on the Gemini project; Resend bounce/complaint dashboard; Neon usage.
- [ ] Weekly: `npm run db:reconcile` findings reviewed, the refund list at zero, `SELECT created_at, user_id, amount,
      reference_id FROM credit_ledger_transactions WHERE transaction_type = 'ADMIN_ADJUSTMENT' ORDER BY id DESC LIMIT 50;`
      shows only adjustments **you** made.

---

## 6. Secrets, incidents, rollback

### 6.1 Rotation (no secret has a grace period: each service accepts exactly one value)

| Secret | Impact while rotating | Steps | Verify |
| --- | --- | --- | --- |
| `JWT_SECRET` | **every user is signed out** | generate (§1.3) → set on **both** → deploy **Express first**, then Next.js immediately | sign in on the public origin (§4.2) |
| `INTERNAL_SERVICE_SECRET` | AI Lab fails (`INTERNAL_AUTH_REJECTED`, 503) between the two deploys; open holds expire uncharged | generate → set on both → deploy Express, then Next.js — do it in a quiet minute | one AI turn is captured (§4.5) |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | deliveries between the two changes are rejected (`Rejected:`, 401) and retried by Lemon, then dropped | generate (`openssl rand -hex 20`) → change it in Lemon's webhook **and** on Express and redeploy, back to back → afterwards **resend** failed deliveries from Lemon's webhook log (idempotent per order) | a real or test order logs `Acknowledged 200 OK` |
| `LEMONSQUEEZY_API_KEY` | none (only checkout creation uses it) | create a new **live-mode** key → set on Express → deploy → revoke the old key | start a checkout |
| `RESEND_API_KEY` | none | new key → set on Express → deploy → delete the old key | send a verification mail |
| `GEMINI_API_KEY` | none | new key → set on Next.js → redeploy → delete the old key | one AI turn |
| Database password (Neon role) | connections drop until the services restart | reset the role's password in Neon → update `DATABASE_URL` (and your `MIGRATION_DATABASE_URL`) → restart Express | `/health` shows `connected` |
| Upstash token | per-user chat limit falls back to per-instance | rotate → set on Next.js → redeploy | — |

Google/Lemon **client** identifiers (`GOOGLE_CLIENT_ID`, store id, variant ids) are not secrets.

### 6.2 Incident response (one page)

**First, always:** note the time, don't delete evidence (the ledger is append-only; keep the logs you have), and take a
Neon branch of production (instant) before changing data.

**A secret leaked**

| Leaked | Danger | Do |
| --- | --- | --- |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | **highest**: forged `order_created` events can credit any account (still bounded by pack price, store id, live mode — but unlimited order ids) | rotate **now** (§6.1); then list `CREDIT_PURCHASE` rows since the leak (`SELECT created_at, user_id, amount, reference_id FROM credit_ledger_transactions WHERE transaction_type = 'CREDIT_PURCHASE' ORDER BY id DESC LIMIT 200;`) and compare each `ls_order_<id>` with Lemon's orders; claw back forged ones with `ADMIN_ADJUSTMENT` rows (never delete ledger rows) |
| `JWT_SECRET` | an attacker can mint sessions | rotate **now** (signs everyone out); review recent activity |
| `INTERNAL_SERVICE_SECRET` | metering calls and a trusted client-IP header (still needs a valid user session) | rotate |
| database URL / password | full data access; the owner role can bypass the ledger triggers | reset the role password (§6.1), review `db:reconcile` and `ADMIN_ADJUSTMENT` rows, restore from Neon if tampered (§2.5) |
| `GEMINI_API_KEY` | cost | revoke at Google, issue a new key (§6.1), check usage |
| `RESEND_API_KEY` | mail sent as your domain | rotate, check Resend's sent log |
| `LEMONSQUEEZY_API_KEY` | orders readable / checkouts creatable | revoke and recreate |

**Suspicious credits or balances.** `npm run db:reconcile`; then
`SELECT user_id, balance FROM user_balances ORDER BY balance DESC LIMIT 10;`,
`SELECT … FROM credit_ledger_transactions WHERE transaction_type IN ('ADMIN_ADJUSTMENT','CREDIT_PURCHASE') ORDER BY id DESC LIMIT 200;`,
sign-ups per day (`SELECT date_trunc('day', created_at), count(*) FROM users GROUP BY 1 ORDER BY 1 DESC LIMIT 7;`).
Remove credits only with a compensating `post_credit_transaction(<user>, -n, 'ADMIN_ADJUSTMENT', '<reason>')`.
**There is no account-disable flag** (§7). The levers that exist: end an account's sessions
(`UPDATE users SET token_version = token_version + 1 WHERE id = '<uuid>';`), or make it unverified so reservations are
refused (`UPDATE users SET is_verified = false WHERE id = '<uuid>';` — the owner of the mailbox can re-verify). Neither
blocks a determined user.

**Webhook failures.** Symptoms: orders paid but no credits; `Rejected:`, `NOT STORED` or `FAILED background credit
allocation` logs; `webhook_unprocessed` in `db:reconcile`. Check in order: the URL in Lemon is the Express host;
`/health` is `ok`; the secret matches (`Rejected:` after a deploy = mismatch); the log lines in §5.2; the order in Lemon
matches pack price, store id, USD. Then: deliveries Express **stored** (in `lemon_webhook_events`, listed by
`db:reconcile`) are finished with **`npm run webhooks:replay`** on the Express host; deliveries Lemon shows as **failed**
(never stored: Express answered 401 or 503 to every attempt) are **resent** from Lemon's webhook log. Both are
idempotent per order (`ls_order_<id>`).

**AI cost spike.** Levers, fastest first: **(1)** blank `GEMINI_API_KEY` on Next.js and redeploy — every turn is
released uncharged and answers 503 (tested path); revoke the key at Google if it leaked. **(2)** lower
`AI_DAILY_TURNS_GLOBAL` on Express (needs a restart; turns past it answer `503 AI_CAPACITY_REACHED`). **(3)** find the
heavy accounts with the SQL in §5.2 and use the account levers above. **(4)** raise the Google-side quota/budget
handling. Afterwards check `hold_expired_unsettled` / `capture_failed` in `db:reconcile`.

**Pause crediting** (e.g. while investigating forged webhooks): set a different `LEMONSQUEEZY_WEBHOOK_SECRET` on Express
only — every delivery is rejected (401) and queued by Lemon's retries, then resend after the fix.

### 6.3 Rollback plan

- **Code** — redeploy the previous good commit of **both** services together (runbook §10.3). Express first or together
  with Next.js, never Next.js alone. Migrations 001–015 are additive: the previous commit works with the current schema
  (a rollback to a commit *before* migration 013 simply never writes `lemon_order_refunds`; one before 015 acknowledges
  webhooks before storing them again — run `npm run webhooks:replay` first so nothing stored is left unprocessed). Vercel's Instant Rollback
  restores a previous production deployment but does **not** change environment variables; after a rollback it turns off
  auto-assignment of new pushes until you undo it. Render's rollback behaviour: **(not verified)** — redeploy the previous
  commit from the dashboard.
- **Migrations** — only if a migration itself is the problem: runbook §10.1 (SQL tested in
  `services/auth-billing-service/tests/db/runbook-sql.test.ts`). They are additive; rolling them back is rarely needed.
- **Data** — Neon restore (§2.5). It discards everything written after the restore point (sign-ups, purchases, AI usage):
  re-deliver Lemon orders from the dashboard, then `npm run db:reconcile` → 0.
- **Stop the bleeding** — suspend the Next.js service (the site goes down; Express keeps receiving webhooks) or, to stop
  crediting, the webhook-secret lever above. There is no maintenance-mode switch in the app.
- [ ] You know where each of the above is (bookmarks), before launch day.

---

## 7. Known limitations and scale-out requirements (accepted for launch)

None of these is a hidden defect; each is a decision with a trigger. Details live in the linked finding.

| Area | Limitation | Trigger to revisit / what changes |
| --- | --- | --- |
| **One Express instance** | Rate limiters (`express-rate-limit`, memory store) are per process; the expired-hold sweeper runs in-process (SEC-06, LAUNCH_NOTES) | Before a 2nd instance: shared-store limiters (Redis/Upstash), the per-account cross-IP login limit, `AI_HOLD_SWEEP_INTERVAL_MS=0` plus a scheduled `SELECT release_expired_ai_holds();` |
| **Next.js instances** | The per-user `/api/chat` limit (10/min) is in-memory per instance unless Upstash is configured | Configure `UPSTASH_REDIS_REST_URL` / `_TOKEN` on any multi-instance platform (Vercel); daily caps are DB-backed regardless |
| **Maths as source text** | Formulas in AI answers are shown as their TeX source in monospace (`$E_n$` → `E_n`), not typeset. KaTeX was removed (owner decision, performance phase R15): the sanitizer had been stripping its output anyway (SEC-15), and its dependency carried the only low advisory | Rendering maths again needs a renderer whose output passes the sanitiser — a security review of the schema first |
| **Content filter** | `validateAiOutput` is four regexes over the output — trivially bypassed, can misfire. It is a weak quality filter, **not a security control**; real controls are inert rendering, caps and the CSP | Gemini safety settings / a moderation API |
| **Refunds** | Credits are never clawed back automatically; every refund is reviewed by hand (§3.9). Lemon documents **no dispute/chargeback event** — whether a Lemon-handled chargeback also sends `order_refunded` is undocumented | weekly dashboard check (§5.4); an automatic policy needs a product decision |
| **Discount codes** | None allowed (§3.6) | the webhook must validate the paid amount first (a code change + test) |
| **i18n** | **924 machine-translated strings** (84 keys × 11 locales) await native review; **22 keys carry legal/pricing/billing meaning — review those first** (`docs/testing/I18N_REVIEW.md`). Ledger type labels on the dashboard are not localised at all | native review per locale |
| **Lint** | **27** `react-hooks` (React Compiler) errors and 21 warnings remain; the CI `lint` job is non-blocking by decision (DEPENDENCY_TRIAGE) | a separate cleanup; make the job blocking afterwards |
| **Accounts** | No admin UI and **no account-disable flag**; the levers are SQL (§6.2) | a code change if abuse appears |
| **Database role** | The service runs as the schema owner unless you switch (§2.4); a residual: the app role could insert a balance row for a user without one (reconcile would flag it) | the SEC-12 rehearsal and switch; `DB_ROLES.md` |
| **Rendering** | Every page is server-rendered per request (nonce CSP, SEC-18): no CDN-cached HTML | size the Next host / function budget |
| **Content-Security-Policy** | `style-src 'unsafe-inline'` (React/framer-motion/R3F inline styles; not script execution); live Google sign-in is only verified at §4.3 | n/a |
| **HSTS** | `includeSubDomains`, no `preload` | every subdomain must serve https before launch; preload is a later, hard-to-undo choice |
| **Scanning** | A passive ZAP baseline against the local production build (0 failures) and the code-level review; no authenticated active scan, no external penetration test | an external test if the product grows |
| **Dependencies** | A KaTeX advisory chain (4 low) is accepted and tracked (DEPENDENCY_TRIAGE) | re-check on a new `rehype-katex` / `micromark-extension-math` release |

---

## Go / no-go

Launch only when all of these are true:

- [ ] §1.5 `check:config` passes (including `SITE_URL`); the hosts hold the same values.
- [ ] §2.2 rehearsal and §2.3 production migration: `mode=fresh … applied=16`, SQL checks match, reconcile exit 0.
- [ ] §3 Lemon live: webhook subscribed to both events, `LEMONSQUEEZY_ALLOW_TEST_MODE` unset, no discounts, one real
      purchase credited **and** its refund reviewed.
- [ ] §4 all green, including the search-signals check (robots.txt / sitemap / no `noindex`), Google sign-in under the enforced CSP and SPF/DKIM `PASS`.
- [ ] §5 the daily reconcile job exists and alerts on a non-zero exit; an uptime monitor is watching `/health`.
- [ ] §5.1 **the daily `db:purge-signup-ips` job is scheduled, has run at least once on production (its log shows "cleared N signup address(es)" and "heartbeat sent"), and BOTH alerts exist (non-zero exit; no heartbeat within 26 h).** Only then fill `SITE_OWNER.signupIpPurgeJob` so the privacy policy may say the address is cleared after 90 days.
- [ ] §6 you have the rotation steps, the incident page and the rollback bookmarks at hand.
- [ ] §7 you have read the limitations and accept them.

---

## Sources (official documentation, read 2026-10-25)

* Vercel — [fair use guidelines](https://vercel.com/docs/limits/fair-use-guidelines), [function duration](https://vercel.com/docs/functions/configuring-functions/duration), [request headers](https://vercel.com/docs/headers/request-headers), [runtime logs](https://vercel.com/docs/logs/runtime), [Instant Rollback](https://vercel.com/docs/instant-rollback), [Pro plan](https://vercel.com/docs/plans/pro-plan)
* Render — [web services](https://render.com/docs/web-services), [deploys](https://render.com/docs/deploys), [free instances](https://render.com/docs/free), [Node version](https://render.com/docs/node-version), [logging](https://render.com/docs/logging), [compute plans](https://render.com/docs/compute-plans), [pricing](https://render.com/pricing); client-IP guidance only from Render's articles/community, not the reference docs
* Railway — [public networking limits](https://docs.railway.com/networking/public-networking/specs-and-limits), [health checks](https://docs.railway.com/deployments/healthchecks), [plans](https://docs.railway.com/pricing/plans)
* Fly.io — [autostop/autostart](https://docs.fly.io/launch/autostop-autostart), [request headers](https://docs.fly.io/networking/request-headers), [pricing](https://docs.fly.io/about/pricing)
* Neon — [branching](https://neon.com/docs/introduction/branching), [instant restore](https://neon.com/docs/introduction/branch-restore), [plans](https://neon.com/docs/introduction/plans), [scale to zero](https://neon.com/docs/introduction/scale-to-zero), [connection pooling](https://neon.com/docs/connect/connection-pooling)
* Lemon Squeezy — [test mode](https://docs.lemonsqueezy.com/help/getting-started/test-mode), [webhooks](https://docs.lemonsqueezy.com/help/webhooks), [signing requests](https://docs.lemonsqueezy.com/help/webhooks/signing-requests), [webhook requests](https://docs.lemonsqueezy.com/help/webhooks/webhook-requests), [event types](https://docs.lemonsqueezy.com/help/webhooks/event-types), [order object](https://docs.lemonsqueezy.com/api/orders/the-order-object), [refunds and chargebacks](https://docs.lemonsqueezy.com/help/payments/refunds-chargebacks)
* Resend — [domains](https://resend.com/docs/dashboard/domains/introduction), [add and verify a domain](https://resend.com/docs/add-a-domain)
* Google — [Sign in with Google: client id and CSP](https://developers.google.com/identity/gsi/web/guides/get-google-api-clientid), [OAuth app audience / publishing status](https://support.google.com/cloud/answer/15549945)
* Next.js 16 CLI (`next start`, `PORT`) — `node_modules/next/dist/docs/01-app/03-api-reference/06-cli/next.md`
