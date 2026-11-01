# Privacy follow-ups — design note (branch `seo/aeo-geo`, written before any code)

Three items from `TRUST_PAGES.md` §3. Rule from the owner: anything that touches **auth, ledger or billing → stop and ask first;
ledger rows stay immutable.** So this note splits the work into what is built now and what waits for your answer.

| # | Item | Touches auth/ledger/billing? | Status |
| --- | --- | --- | --- |
| 1 | `signup_ip` retention (clear after 90 days) | writes one column of `users`; no auth logic, no ledger, no billing | **built** in this change (you asked for it) |
| 2 | Stop generating a fake name / date of birth for Google sign-ups | **yes: the Google sign-up code path, the `users` insert and what the UI does with empty fields** | **design note written, waiting for your approval:** [`GOOGLE_PROFILE_DESIGN.md`](GOOGLE_PROFILE_DESIGN.md) (supersedes §2 below: the response shape does **not** need to change); the privacy text says it honestly meanwhile |
| 3 | Account deletion + data export (KVKK / GDPR) | **yes: auth (sessions), `users`, and it must leave the ledger untouched** | **design note written, waiting for your approval:** [`ACCOUNT_DELETION_DESIGN.md`](ACCOUNT_DELETION_DESIGN.md) (supersedes §3 below; 14-day grace, export, third parties, side effects found) |

## 1. `signup_ip` retention — built

**Facts.** `users.signup_ip` (INET) is written once at registration (`auth.service.ts` `insertUser`, from the BFF-forwarded client IP).
Nothing in the code reads it back: the only reader in the repo is the tests. Its column comment says "used for signup credit abuse
heuristics". It has no retention today.

**Design.**
* Migration `016_signup_ip_retention.sql`: `purge_signup_ips(p_retention INTERVAL DEFAULT '90 days') RETURNS INTEGER` — sets
  `signup_ip = NULL` for rows older than the retention and returns how many it cleared. `SECURITY INVOKER`, `search_path`
  pinned like every function since SEC-12, **a floor of 1 day** (a typo cannot wipe today's signups), `EXECUTE` revoked from
  PUBLIC and **not granted to the application role**: the web app cannot call it; only the owner/migration connection can.
* **Mandatory + monitored (owner decision, round 2):** the job is a launch-checklist gate (§5.1, Go/no-go); with
  `PURGE_HEARTBEAT_URL` it pings a heartbeat monitor after each successful run, so "no ping in 26 h" alerts even when the
  scheduler never starts it (exit codes alone cannot). The privacy sentence is conditional on `SITE_OWNER.signupIpPurgeJob`.
* Scheduled call: `npm run db:purge-signup-ips` (service script, same style as `db:reconcile`; it uses the migration connection,
  prints the count, never an IP). **Run it daily** from a scheduler — a Render Cron Job, or any cron with the owner connection
  string. It is *not* wired into the running service: the service's only in-process sweepers touch holds and webhook payloads, and I
  did not add a new one to a billing-adjacent process.
* `users.updated_at` moves to now when an IP is cleared (the existing trigger); nothing reads `updated_at`.
* Why 90 days: your example. The abuse-heuristic purpose needs recent signups only. Change by passing an interval
  (`--days 30`) or editing the default in one place.
* Not changed: login, registration, tokens, any billing table. Ledger untouched.

**Tests** (PostgreSQL 18): clears only rows older than the retention; leaves newer rows and non-IP columns alone; idempotent;
returns the count; rejects less than 1 day; not executable by PUBLIC; function hardening, migration list, rollback SQL and
runbook updated; the CLI exits 0 and prints no address.

## 2. Google sign-ups get invented personal data — proposal (needs your go)

**Facts.** For a new Google user the service stores `generateRandomProfile()`: a random first name, random last name and a random date
of birth for an age of 18–69. The columns are nullable (migration 002), but
`UserProfileInput` is non-null everywhere: `insertUser`, `toPublicUserProfile`, the profile validation, the BFF types, `AuthContext`,
the Navbar (shows `firstName`), the profile page (form fields), the AuthModal, and the verification-email template read them.
Nothing marks a profile as generated, so a user cannot tell, and neither can we.

**Proposal.** Store nothing we do not have: `first_name`, `last_name`, `date_of_birth` stay `NULL` for Google sign-ups until the user
fills them in on the profile page. Concretely:
1. `insertUser` takes an optional profile; the Google path passes none (service, ~10 lines).
2. `toPublicUserProfile` / API types: the three fields become `string | null`.
3. UI: Navbar greets with the email local-part when `firstName` is empty; the profile page shows empty inputs (it already has the
   form); the required-field validation applies on save, not on read.
4. Existing Google accounts keep their generated values; a one-off migration cannot tell generated from real ones, so I would
   **not** null them silently. Option: show a "Check your details" notice on the profile page for accounts created via Google.

**Risk.** It changes the shape of the auth response (`null` where there was a string): every consumer must tolerate it, and the
service tests that assert the generated profile (`pure-modules.test.ts`, the Google sign-in tests) change. Feasible without
breaking the flows; it is a real change to the auth service and the sign-in UI, so: **do you want it?**

**Until you decide:** the draft privacy policy says exactly what happens (it does).

## 3. Account deletion and export — proposal (needs your go)

**Facts that constrain the design.**
* `credit_ledger_transactions.user_id` and `ai_credit_holds.user_id` are `ON DELETE RESTRICT`, and the ledger is immutable by
  triggers: a user who ever bought or spent credits **cannot be deleted** — by design (the audit trail). A real `DELETE FROM users`
  is impossible for them and must stay impossible.
* `oauth_accounts`, `verification_tokens`, `password_reset_tokens`, `pending_checkout_orders` cascade.
* `lemon_webhook_events.payload` (buyer email) is cleared 30 days after processing; `lemon_order_refunds` holds order ids, no email.
* Not stored by us: AI Lab conversations. Held by others: Lemon Squeezy (merchant of record), Resend, Google, Gemini, PubChem.

**Proposal: anonymise, do not delete.**
* `DELETE /api/users/me` (BFF → service), signed in, **password re-entry** (or a fresh Google token) in the request, then one
  transaction: set `email` to `deleted-<uuid>@invalid`, `password_hash` to an unusable random hash, `first_name`, `last_name`,
  `date_of_birth`, `signup_ip` to `NULL`, `is_verified` false, `token_version + 1` (all sessions die), delete the user's
  `oauth_accounts` and one-time tokens, revoke the current token. The `users.id` row **stays** so the ledger's foreign key and
  `ledger_reconciliation()` stay true; no ledger row is read for writing, updated or deleted.
* `GET /api/users/me/export` (same guard): one JSON with the profile fields, linked providers (not the Google id), the credit
  balance, every ledger row of the user, checkout orders and AI holds (reference ids). No password hash, no tokens.
* Docs: the privacy policy states what is anonymised and what is kept (ledger rows, as the accounting record) — the legal basis
  for keeping them (tax/accounting law) is for your lawyer, and so is the response deadline wording.
* Needs: a UI entry on the profile page, rate limiting like login, tests against PostgreSQL 18 (ledger sums unchanged, reconcile
  clean, deleted user cannot log in, tokens dead, double-delete is a no-op), and a decision on a grace period (e.g. 14 days) —
  ask if you want one.

**Risk.** New write path on `users` and new endpoints in the auth service; the ledger is read for export only. **Do you want it,
and with a grace period?**

## What the privacy text changes now

* `signup_ip`: "kept for 90 days, then cleared" — true only once the daily job runs; the launch checklist gets the job.
* Webhook payloads: "cleared 30 days after an event is processed" (already true in the code; it was missing from the text).
* Google sign-ups: still states the generated values (item 2 pending); deletion/export: still "[to be provided]" (item 3 pending).
