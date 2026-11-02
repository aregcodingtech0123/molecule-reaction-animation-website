# Implementation note — account deletion (Phase B) and the re-registration guard

Branch `seo/aeo-geo`, written 2026-11-01 **before the code**, then corrected where the implementation showed it wrong (marked **Correction**), from `ACCOUNT_DELETION_DESIGN.md` (approved: GO before launch). Nothing below
changes ledger or billing semantics: no ledger row is written, updated or deleted, no balance is touched, the existing triggers are not
modified. The one billing-adjacent behaviour that is new – **skipping the signup bonus for a tombstoned e-mail** – was approved with the guard.

## 1. Migration 017 (`database/init/017_account_deletion.sql`, idempotent, one transaction)

* `users.deletion_requested_at TIMESTAMPTZ NULL`, `users.anonymised_at TIMESTAMPTZ NULL` (timestamps only) and a partial index on due requests.
* `deleted_email_tombstones (email_hmac BYTEA PRIMARY KEY CHECK (octet_length = 32), created_at TIMESTAMPTZ DEFAULT NOW())` – a keyed hash,
  never the address. The application role gets `SELECT` only (registration looks it up); `database/roles/app-role.sql` is updated and
  `tests/api/app-role.test.ts` asserts it cannot write.
* `anonymise_user(p_user_id uuid, p_unusable_hash text, p_email_hmac bytea DEFAULT NULL, p_grace interval DEFAULT '14 days') RETURNS text` –
  `SECURITY INVOKER`, pinned `search_path`, `EXECUTE` revoked from PUBLIC and not granted to the app role (owner/job only), grace floor 1 day.
  In one transaction, after `SELECT … FOR UPDATE` of the user row, it returns **`not_found` / `already` / `not_due` / `admin_skipped` / `busy`**
  without changing anything, or sets `email = 'deleted-<id>@invalid'`, `password_hash` = the supplied bcrypt hash of a random value (valid format,
  nobody knows the password), `first_name`, `last_name`, `date_of_birth`, `signup_ip` = `NULL`, `is_verified = false`, `token_version + 1`,
  `anonymised_at = now()`; deletes the user's `oauth_accounts`, `verification_tokens`, `password_reset_tokens`; upserts the tombstone when an HMAC is
  supplied; returns `anonymised`. **`busy`** = an AI hold in status `held` that has not expired, or a `pending` checkout order younger than 24 h:
  the user is retried the next day, so no payment or AI turn is raced.
* `purge_email_tombstones(p_retention interval DEFAULT '12 months') RETURNS integer` – deletes older tombstones; floor 30 days; owner/job only.
  (The registration check also ignores tombstones older than 12 months, so a late purge job never extends the guard.)
* **Untouched, asserted by tests:** `credit_ledger_transactions` (update/delete/truncate triggers), `user_balances` write guard, `post_credit_transaction`,
  the `ON DELETE RESTRICT` keys. The function never names those tables. Rollback SQL (runbook §10.1) drops the two functions, the table and the two columns.

## 2. Endpoints (auth service, BFF passes `/api/users/*` through unchanged)

| Endpoint | Behaviour |
| --- | --- |
| `POST /api/users/deletion` | authenticated; body `{password}` or `{idToken}` (same re-authentication as the export, 403 on failure); admins refused (403 `ADMIN_CANNOT_SELF_DELETE`); sets `deletion_requested_at` (kept if already set), **bumps `token_version`** (every session, including this one, is revoked), sends a confirmation e-mail with the date (best effort, never blocks); answers `{ scheduledFor }`. Rate limit 5/hour/account |
| `DELETE /api/users/deletion` | authenticated (sign in again during the grace period); clears `deletion_requested_at`; no effect after anonymisation (the account no longer exists to sign in to) |
| `GET /api/users/profile`, auth responses | gain `deletionScheduledFor: string \| null` (request + 14 days) – additive |

## 3. Daily job `npm run db:process-deletions` (owner connection, same pattern and launch gate as `db:purge-signup-ips`)

Finds due users (request ≥ 14 days old, not anonymised, not admin), computes `HMAC-SHA256(EMAIL_TOMBSTONE_SECRET, lower(trim(email)))` when the guard is on,
creates a random bcrypt hash, calls `anonymise_user` per user (own transaction; one failure does not stop the others), then `purge_email_tombstones()`.
Prints counts only – never an address or hash. Exit 0 / 1 failure / 2 heartbeat failed / 64 bad argument; `DELETION_HEARTBEAT_URL` dead-man's-switch like the purge job.
**With the guard enabled and no secret it exits 1 before touching anyone** – it never falls back to an unkeyed hash.

## 4. Guards in existing code (reads only)

* `webhook.service`: `userExists()` and `findUserIdByEmail()` ignore `anonymised_at IS NOT NULL` → a late `order_created` for an anonymised user ends in the existing
  `missing_user` outcome (200 to Lemon, no ledger row; stored as `processed`/`missing_user` and logged as `Missing user identity`). **Correction:** the existing `db:reconcile` did not list it; after the owner's decision it has a new section `webhook_missing_user` (migration 018, runbook §9) in addition to the log line (launch checklist §5.2). A late `order_refunded` is unchanged (it never reads `users`).
* `loadReceiptRecipient()` ignores anonymised users → "Skipping purchase receipt — user not found", no e-mail to `deleted-…@invalid`.
* The bonus guard sits **inside `grantSignupBonus`**, which all four bonus routes use (verify e-mail, verified upgrade, Google takeover link, new Google user). **Correction:** the bonus is granted at e-mail verification, not at registration, so the guard is there. With an unexpired tombstone the account is created and verified normally but no bonus is posted; the registration answer is identical, and the verify-email message reads "Email verified." (without the credits sentence).

## 5. Re-registration guard configuration

* `EMAIL_TOMBSTONE_SECRET` – **its own secret**, ≥ 32 characters, must differ from `JWT_SECRET` and `INTERNAL_SERVICE_SECRET`; `check:config` and the production start-up
  validation refuse it when weak, a placeholder, or equal to either; listed in `.env.example`, the runbook env table, the launch checklist and the rotation table
  (rotating it makes existing tombstones useless – fail-open, no grace – so rotate only on suspected exposure).
* `EMAIL_TOMBSTONE_GUARD` – `true` (default) / `false`. `false` disables the lookup, the bonus skip and the tombstone creation (the secret is then not required),
  for the case that legal review rejects the guard. Existing tombstones stay until `purge_email_tombstones` removes them.
* Privacy/legal: `/privacy` carries a paragraph about the hash (conditional on `SITE_OWNER_EMAIL_TOMBSTONE_GUARD` starting with `enabled`; the draft notice is the page-wide `SITE_OWNER_LEGAL_REVIEWED` switch), and the launch checklist has a legal-review item (§1.6).

## 6. UI (profile page)

"Delete my account" section: shows the current balance in the warning – *"If you delete your account, your remaining N credits are permanently lost and cannot be restored.
Deletion takes effect after a 14-day grace period, during which you can cancel."* – password (or Google) confirmation, then signs out; when a deletion is scheduled the page shows the
date and a "Cancel deletion" button. English only (added to the native-translation list).

## 7. Test plan (PostgreSQL 18; nothing existing weakened)

* **DB** (`tests/db/account-deletion.test.ts`, scratch databases): every function outcome; fields changed / cleared; tokens and oauth links deleted; **ledger rows, balance, immutability triggers
  and `ledger_reconciliation()` identical before/after**; the user row id survives; tombstone stores 32 bytes and no e-mail; grace floor; privileges (app role cannot execute or write);
  idempotence; migration re-applicable; the CLI (due users anonymised, counts only in output, guard on/off, missing secret refuses, heartbeat).
* **API** (`tests/api/users.deletion.test.ts`): request needs re-authentication (403, never 401), admin refused, session revoked at once, sign-in during grace works and shows the date, cancel, Google re-auth,
  rate limit; after the job: cannot sign in, reset cannot revive, old e-mail registers as a new account; tombstone guard for password **and** Google sign-up (no bonus; identical responses; other
  addresses still get it; expired tombstone gets it; guard off gets it); **late `order_created` is not credited, late `order_refunded` is recorded, no receipt is sent**; export of an anonymised id is impossible.
* **Config**: `check:config` and `productionConfigProblems` for the new variables. **BFF/UI**: gateway pass-through, the section's warning text verbatim, the request and cancel flows.
