# Database roles (SEC-12)

> **Phase 2C:** this document describes the **legacy** application role that `database/roles/app-role.sql` creates. A staged
> replacement contract (V7) exists in `database/staged/phase-2c-v7/`; it is **not applied** and **not production-approved**.
> Its R transition (step S10) is a **point of no return**: after it, the build in this repository (which still uses the
> legacy operations) fails against the database. Read [Phase 2C V7 transition](#phase-2c-v7-transition-staged-not-applied) before re-running `app-role.sql`.

Today the auth-billing service connects as the role that owns the schema. That role can do anything to the
ledger: `UPDATE`/`DELETE`/`TRUNCATE`, disable the append-only and balance-guard triggers, or set the guard's
flag (`moleculestudio.ledger_write`) itself. The triggers stop mistakes, not an attacker who can run SQL as
the service (an injection we have not found, a compromised dependency, a leaked `DATABASE_URL`).

Migration `012_function_search_path.sql` (applied by the normal runner, no behaviour change) prepares a split:

* `post_credit_transaction()` is `SECURITY DEFINER` with `search_path = public, pg_temp`, and `EXECUTE` is
  revoked from `PUBLIC`. Credits move only through it, with the owner's rights.
* The other ledger functions (`guard_user_balance_write`, `ledger_reconciliation`, `release_expired_ai_holds`,
  `expire_stale_checkout_orders`) also pin `search_path`.

`database/roles/app-role.sql` then grants a separate login role exactly what the **current (legacy) build** uses. This is the
legacy grant set, not the staged V7 post-R contract, which revokes `EXECUTE` on `post_credit_transaction()`:

| Table | App role |
| --- | --- |
| `users` | SELECT, INSERT, UPDATE |
| `oauth_accounts` | SELECT, INSERT |
| `verification_tokens`, `password_reset_tokens` | SELECT, INSERT, DELETE, UPDATE (needed only for `SELECT … FOR UPDATE`) |
| `revoked_tokens` | SELECT, INSERT, DELETE |
| `pending_checkout_orders`, `ai_credit_holds` | SELECT, INSERT, UPDATE |
| `credit_ledger_transactions` | SELECT |
| `user_balances` | SELECT, INSERT |
| `lemon_order_refunds` | SELECT, INSERT (the webhook records refunds; marking them reviewed is owner-only) |
| `lemon_webhook_events` | SELECT, INSERT, UPDATE (the webhook stores deliveries before its 200, then status changes and the 30-day payload clean-up — R19, migration 015); deleting stored events is owner-only |
| `schema_migrations` | — |
| functions | EXECUTE `post_credit_transaction(…)`, `release_expired_ai_holds()` |

## Switching (optional, owner decision)

1. Apply migrations as usual (`node scripts/migrate.mjs`), so 012, 013 and 015 are in place.
2. Create the login role with SQL: `CREATE ROLE moleculestudio_app LOGIN NOINHERIT PASSWORD '…'`. Do not create it through a
   console that adds role memberships (console-created roles may carry them; this has not been tested on Neon): the V7
   contract requires a role with no memberships.
3. As the owner: `psql "$OWNER_DATABASE_URL" -f database/roles/app-role.sql` (idempotent; it refuses to run
   before 012).
4. Set the auth-billing service's `DATABASE_URL` to the new role. Keep the owner URL for migrations,
   `db:reconcile` and the scheduled SQL jobs (`expire_stale_checkout_orders()`), which stay owner-only.
5. Re-run the script after any migration that adds a table the service uses (new tables get no grant).
   **Never re-run it after the Phase 2C R transition (S10):** it grants back `EXECUTE` on `post_credit_transaction()` and the
   table-level writes that R removes, which the contract prohibits (see below).

Rollback (legacy setup only): point `DATABASE_URL` back at the owner role. Nothing in the schema depends on the app role.
This does **not** apply after the Phase 2C R transition: the old build is then not a valid rollback target.

## What the legacy role guarantees (tested)

This test applies `app-role.sql` only; it says nothing about the staged V7 contract, which was verified separately as
role-substituted copies in a disposable database.

`services/auth-billing-service/tests/api/app-role.test.ts` applies the script verbatim and, as the app role:
UPDATE/DELETE on balances and ledger, direct ledger INSERT, `DELETE FROM users`, `TRUNCATE`, `DISABLE TRIGGER`,
replacing `post_credit_transaction()`, `CREATE TABLE` in `public`, and reading or forging `schema_migrations`
are all refused (`42501`); setting the guard flag and then updating a balance is refused too. A role that was
not granted `EXECUTE` cannot mint credits. Registration, email verification, login, profile, password reset,
logout, Google sign-in, checkout → signed webhook → credits, AI consume → capture / refund and the expiry sweep
all work through the real HTTP API connected as the app role.

## Residual (legacy role)

* The app role can `INSERT` a `user_balances` row with any balance for a user that has none yet (the service
  creates the zero row at sign-up). Closing it needs the column default changed from the legacy `10` to `0`
  and a column-level grant; `db:reconcile` reports such a row as a balance / ledger mismatch.
* The owner role keeps every right. Protect the owner URL like a root credential.

## Phase 2C V7 transition (staged, not applied)

**Status.** The V7 contract is staged in `database/staged/phase-2c-v7/` (see its `README.md` and `MANIFEST.json`). It is a
conditional SQL-level contract for disposable environments. It is **not production-approved**, and nothing in it has been run
in production.

**Not applied automatically.** `node scripts/migrate.mjs` reads `database/init` by default and never applies files under
`database/staged/`. The migration library can be given another directory (V7 verification used that), but that is a
verification method, not an operator procedure. Staged files are applied only by the separately approved deployment
procedure; placing a file in the staged folder executes nothing.

**What was and was not verified.** V7 executed role-substituted copies of these files (`moleculestudio_` replaced by
`v7v_20261109_`) in a disposable PostgreSQL 18.6 test database. The files as staged, with the real `moleculestudio_` role
names, have not been executed anywhere, and nothing has been executed in production.

**Order**, as defined by the approved deployment document (this outline does not replace it):

* S0 read-only pre-flight (a restorable snapshot and data checks); S1 optional out-of-band index pre-build.
* **S2** migration 021. **S3** create the acknowledgement and webhook roles, then the read-only verification at stage
  `roles_created`. **S4** migration 022. **S5** the owner fills `ledger_policy` and `credit_packages`.
* **S6** webhook and acknowledgement privileges. **S7** additive grants (R0): exactly seven privileges added, none removed.
* **S8** deploy the new service build next to the old one. **S9** pre-R soak: at least 24 hours, and every listed criterion met.
* **S10** the R transition, only when the soak criterion is met and no old instance is running, immediately followed by the
  final verification.

**What R does to the build in this repository.** R removes `EXECUTE` on `post_credit_transaction()` and the table-level
`INSERT`/`UPDATE` on `ai_credit_holds`, `lemon_webhook_events` and `user_balances`. Only column-level grants remain: `INSERT`
of six reservation columns on `ai_credit_holds`, `UPDATE` of six processing columns on `lemon_webhook_events`, and `INSERT` of
`user_id` and `balance` on `user_balances`. It grants `EXECUTE` on only the six narrow operations
(`grant_signup_bonus`, `credit_verified_purchase`, `capture_ai_hold`, `release_ai_hold`, `clear_processed_webhook_payloads`,
`release_expired_ai_holds`) and `SELECT` on `credit_packages` and `ledger_policy`, alongside the unchanged ordinary table
grants (accounts, tokens, checkout orders, refunds). The build in this repository still calls
`post_credit_transaction()`, writes holds and the webhook inbox with direct statements, and locks holds with
`SELECT … FOR UPDATE`. Applying R while it serves the database makes **capture, release, signup bonus, purchase crediting
and webhook inbox storage and clean-up fail with PostgreSQL error `42501`**, and so does any reservation or acknowledgement
that locks a hold row. Those direct statements are **not** substitutes for the six operations: the application has to be
changed first, and applying R before a compatible build is deployed causes an outage.

**S10 is the point of no return.** After R the old build is not a valid rollback target. Never grant `post_credit_transaction()`
(or any generic ledger writer) back to the application role, not even temporarily. A problem after R is fixed forward, or
handled by rolling back only to a release that already uses the narrow operations. A rollback before R is possible only as far
as the approved deployment document describes. **Never re-run `database/roles/app-role.sql` after R.**
