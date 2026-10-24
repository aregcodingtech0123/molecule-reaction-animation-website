# Production runbook — Phase 1.5 remediation (Batches 0–2)

**Who runs this:** the project owner, by hand. Nothing in this repository connects to a hosted
database automatically. Every command below runs from `services/auth-billing-service` unless noted.

**What it deploys:** tracked migrations (adopting the existing production database), ledger
hardening (`008`), AI credit reservations (`009`), the internal service key, and the new
reserve → capture/release AI charging.

> ⚠️ **Old and new code are mutually incompatible on the AI metering path.** An old BFF calling a
> new Express gets `404` (no internal key) → every AI Lab turn fails with `503 BILLING_UNAVAILABLE`.
> A new BFF calling an old Express has no `/capture`. Deploy **Express and Next together** inside a
> short **AI Lab maintenance window** (step 6). Everything else (auth, checkout, webhooks, dashboard)
> keeps working throughout.

Order: **1 backup → 2 read-only checks → 3 FINDING-03 abuse report → 4 migrations → 5 env vars →
6 deploy both services together → 7 verify → 8 Lemon webhook check → 9 schedule jobs.**
Rollback steps follow each step and are collected in §10.

---

## 0. Before you start

- [ ] `fix/phase1-findings` merged; CI green (service, web, e2e).
- [ ] **Rehearse on a copy first.** Restore the step-1 backup into a staging database (Neon: branch it),
      run steps 2–7 against staging with staging copies of both services.
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
| `baseline: 7 … 001…007` and `would apply 008, 009` | expected if 006/007 were applied by hand earlier | continue |
| `baseline: 5 … 001…005` and `would apply 006, 007, 008, 009` | the production DB never got 006/007 (FINDING-01): **AI usage has been failing in production** (every `/api/chat` turn → 503) | continue — step 4 fixes it |
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

`008` and `009` are backward compatible with the currently deployed code:
`008` re-creates `post_credit_transaction()` with the same signature and behaviour (plus the flag the
balance guard checks) and only blocks direct `UPDATE`/`TRUNCATE` of `user_balances` — the old code
never does either. `009` only adds a table and two functions.

```bash
node scripts/migrate.mjs --baseline --dry-run     # re-check right before applying
node scripts/migrate.mjs --baseline               # records existing files, applies the rest (006?, 007?, 008, 009)
node scripts/migrate.mjs --status                 # every file: applied or baselined
```

Each pending file runs in its own transaction; a failure stops the run with nothing half-applied
for that file. Re-running is safe (applied files are skipped).

**Rollback 4:** see §10.1 (the migrations are additive; old code keeps working with them applied,
so rolling them back is normally unnecessary).

## 5. Environment variables (both services; old code ignores them)

Generate **one** key and set the **same value** on both services:

```bash
openssl rand -base64 48
```

| Variable | Next.js (BFF) | Express (`auth-billing-service`) | Notes |
| --- | --- | --- | --- |
| `INTERNAL_SERVICE_SECRET` | **required** | **required** | identical on both; ≥ 32 chars, random. Both services refuse to start without it |
| `GEMINI_TIMEOUT_MS` | optional (30000) | — | a timed-out turn is released (not charged) |
| `BILLING_RETRY_DELAYS_MS` | optional (`250,1000,3000`) | — | backoff for capture/release retries |
| `AI_HOLD_TTL_SECONDS` | — | optional (600) | an unsettled reservation expires uncharged after this |
| `AI_HOLD_SWEEP_INTERVAL_MS` | — | optional (300000) | in-process settling of expired reservations; `0` disables |
| `MIGRATION_DATABASE_URL` | — | optional | only for migration/reconcile jobs (direct URL) |

Also check: `JWT_SECRET` must still pass the (changed) strength check — ≥ 32 chars, not a documented
placeholder, and **not low-variety** (e.g. `aaaa…` or a short repeated pattern is now refused). A
randomly generated key passes. Test locally: `node -e "import('./dist/config/secretStrength.js').then(m=>console.log(m.weakSecretReason('JWT_SECRET', process.env.JWT_SECRET)))"` after `npm run build` (prints `null` when fine).

**Rollback 5:** remove the variables (old code ignores them).

## 6. Deploy both services together (AI Lab maintenance window)

1. Announce a ~10-minute AI Lab maintenance window (other pages stay up).
2. Deploy **Express** (`auth-billing-service`). It exits at boot if `INTERNAL_SERVICE_SECRET` or
   `JWT_SECRET` is weak/missing — check the logs for `FATAL:`.
3. Immediately deploy **Next.js**. It refuses to start (instrumentation) without a strong
   `INTERNAL_SERVICE_SECRET`; `next build` does not need it.
4. Between 2 and 3, AI Lab turns fail with 503 (old BFF has no key) — that is the window.

**Rollback 6:** redeploy the previous Express **and** Next together (§10.3).

## 7. Verify

```bash
curl -s https://<express-host>/health                                   # {"status":"ok",…}
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<express-host>/api/billing/consume   # 404 (no internal key)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<public-site>/api/billing/refund      # 404 (blocked by the BFF)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://<public-site>/api/billing/deduct      # 404 (retired)
node scripts/migrate.mjs --status
node scripts/reconcile.mjs                                               # exit 0, or the same rows as in step 2
```

Then, with a staff account that has credits: one AI Lab question.

```sql
SELECT status, amount, ledger_id FROM ai_credit_holds WHERE user_id = '<staff-uuid>' ORDER BY created_at DESC LIMIT 1;  -- captured, 1, <id>
SELECT amount, transaction_type FROM credit_ledger_transactions WHERE id = <ledger_id>;                                -- -1, CREDIT_CONSUMPTION
```

Watch the BFF logs for an hour for `INTERNAL_AUTH_REJECTED` (the two services have different keys),
`CAPTURE_FAILED`, `RELEASE_FAILED`, `BILLING_NOT_CONFIGURED`.

## 8. Lemon Squeezy webhook check (FINDING-23 — URL must point at Express)

In the Lemon dashboard → Settings → Webhooks:

- URL is `https://<express-host>/api/billing/webhooks/lemonsqueezy` — the **Express** host, **not** the
  Next.js site. (The BFF drops `X-Signature`; deliveries to the Next host are always rejected.)
- Event `order_created` is subscribed; signing secret equals `LEMONSQUEEZY_WEBHOOK_SECRET`.
- Use "Send test" → expect `200 {"received":true}` and an Express log `[Webhook] Acknowledged 200 OK`.
- If the URL pointed at the Next host until now, every purchase since then was rejected (401) and **not
  credited**: re-deliver those orders from Lemon's "Recent deliveries" after fixing the URL (fulfilment is
  idempotent per order).

## 9. Scheduled jobs

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
  Issues: `balance_mismatch`, `missing_balance_row`, `capture_failed` (a debit reached the service but
  could not be posted — not charged), `hold_expired_unsettled` (neither capture nor release arrived —
  not charged; correlate `reference_id` with BFF `CAPTURE_FAILED` / `RELEASE_FAILED` logs). The last
  two are revenue loss, not customer harm.
- **Expired reservations** are settled by Express every 5 minutes. If you run several Express
  instances or disable the timer, schedule `SELECT release_expired_ai_holds();` instead (idempotent).

## 10. Rollback reference

### 10.1 Migrations 008/009 (only if they cause a problem)

```sql
BEGIN;
-- 009
DROP FUNCTION IF EXISTS release_expired_ai_holds();
DROP TABLE IF EXISTS ai_credit_holds;            -- export it first if you need the history
-- 008 (restores pre-008 behaviour; post_credit_transaction keeps working without the guard)
DROP TRIGGER IF EXISTS trg_user_balances_write_guard ON user_balances;
DROP TRIGGER IF EXISTS trg_user_balances_no_truncate ON user_balances;
DROP TRIGGER IF EXISTS trg_credit_ledger_no_truncate ON credit_ledger_transactions;
DROP FUNCTION IF EXISTS guard_user_balance_write();
DROP FUNCTION IF EXISTS ledger_reconciliation();
DELETE FROM schema_migrations WHERE filename IN ('008_ledger_hardening.sql', '009_ai_credit_holds.sql');
COMMIT;
```

The new `post_credit_transaction()` body (sets a transaction-local flag) is harmless without the guard;
no need to revert it. Rolling back 009 requires the old code (§10.3) — the new code needs the table.

### 10.2 Baseline only

`DROP TABLE schema_migrations;` returns the database to the pre-runner state (bookkeeping only).

### 10.3 Code

Redeploy the previous Express **and** Next.js builds together. Reservations still `held` at that moment
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

## Optional hardening (recommended, not required for this release)

The `user_balances` guard is a safety net against application bugs, not a privilege boundary. For a
real boundary, run the app with a role that cannot `UPDATE`/`TRUNCATE` the money tables and let a
`SECURITY DEFINER` `post_credit_transaction()` owned by a separate role do the writes. On Neon/Supabase
this means creating a second role and changing the app's `DATABASE_URL`; plan it with Phase 2 (Security).
