# Database roles (SEC-12)

Today the auth-billing service connects as the role that owns the schema. That role can do anything to the
ledger: `UPDATE`/`DELETE`/`TRUNCATE`, disable the append-only and balance-guard triggers, or set the guard's
flag (`moleculestudio.ledger_write`) itself. The triggers stop mistakes, not an attacker who can run SQL as
the service (an injection we have not found, a compromised dependency, a leaked `DATABASE_URL`).

Migration `012_function_search_path.sql` (applied by the normal runner, no behaviour change) prepares a split:

* `post_credit_transaction()` is `SECURITY DEFINER` with `search_path = public, pg_temp`, and `EXECUTE` is
  revoked from `PUBLIC`. Credits move only through it, with the owner's rights.
* The other ledger functions (`guard_user_balance_write`, `ledger_reconciliation`, `release_expired_ai_holds`,
  `expire_stale_checkout_orders`) also pin `search_path`.

`database/roles/app-role.sql` then grants a separate login role exactly what the service uses:

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
| `schema_migrations` | — |
| functions | EXECUTE `post_credit_transaction(…)`, `release_expired_ai_holds()` |

## Switching (optional, owner decision)

1. Apply migrations as usual (`node scripts/migrate.mjs`), so 012 and 013 are in place.
2. Create the login role (Neon console → Roles, or `CREATE ROLE moleculestudio_app LOGIN PASSWORD '…'`).
3. As the owner: `psql "$OWNER_DATABASE_URL" -f database/roles/app-role.sql` (idempotent; it refuses to run
   before 012).
4. Set the auth-billing service's `DATABASE_URL` to the new role. Keep the owner URL for migrations,
   `db:reconcile` and the scheduled SQL jobs (`expire_stale_checkout_orders()`), which stay owner-only.
5. Re-run the script after any migration that adds a table the service uses (new tables get no grant).

Rollback: point `DATABASE_URL` back at the owner role. Nothing in the schema depends on the app role.

## What it guarantees (tested)

`services/auth-billing-service/tests/api/app-role.test.ts` applies the script verbatim and, as the app role:
UPDATE/DELETE on balances and ledger, direct ledger INSERT, `DELETE FROM users`, `TRUNCATE`, `DISABLE TRIGGER`,
replacing `post_credit_transaction()`, `CREATE TABLE` in `public`, and reading or forging `schema_migrations`
are all refused (`42501`); setting the guard flag and then updating a balance is refused too. A role that was
not granted `EXECUTE` cannot mint credits. Registration, email verification, login, profile, password reset,
logout, Google sign-in, checkout → signed webhook → credits, AI consume → capture / refund and the expiry sweep
all work through the real HTTP API connected as the app role.

## Residual

* The app role can `INSERT` a `user_balances` row with any balance for a user that has none yet (the service
  creates the zero row at sign-up). Closing it needs the column default changed from the legacy `10` to `0`
  and a column-level grant; `db:reconcile` reports such a row as a balance / ledger mismatch.
* The owner role keeps every right. Protect the owner URL like a root credential.
