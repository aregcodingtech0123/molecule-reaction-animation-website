# Design note — account deletion and data export (KVKK / GDPR)

**Status: design only. Touches auth (sessions), the `users` table and, indirectly, billing handlers. Nothing is implemented; waiting for
the owner's approval.** Rule that governs it: ledger rows stay immutable and are never read for writing, updated or deleted.
Written 2026-11-01 from the code and migrations 001–016. Statements about the law and about third-party services are marked
**(unverified)** where I could not read the primary text; a lawyer must confirm them.

## 1. What the schema allows

| Table | Link to `users` | Consequence |
| --- | --- | --- |
| `credit_ledger_transactions` | `ON DELETE RESTRICT`, update/delete/truncate triggers | a user who ever had a ledger row **cannot be deleted**, by design |
| `ai_credit_holds` | `ON DELETE RESTRICT` | same |
| `user_balances` | `ON DELETE CASCADE` (write-guard trigger) | untouched by anonymisation |
| `oauth_accounts`, `verification_tokens`, `password_reset_tokens`, `pending_checkout_orders` | `ON DELETE CASCADE` | the first three hold identifiers and can be deleted row by row; `pending_checkout_orders` holds package, amount, status – no personal data |
| `lemon_webhook_events.payload` | – | contains the buyer's e-mail; already cleared 30 days after processing |
| `lemon_order_refunds` | – | order ids only |
| `revoked_tokens` | – | token ids only |

So: **anonymise the `users` row, never delete it.** The row (and its id) stays so the ledger's foreign key, `ledger_reconciliation()`
and the audit trail stay true.

## 2. Deletion — flow with a 14-day grace period

1. **Request.** `DELETE /api/users/me` (BFF → service), signed in, **password re-entry** (a fresh Google sign-in for Google-only
   accounts), rate-limited like login. Sets `users.deletion_requested_at = now()`, bumps `token_version` (every session dies), sends
   a confirmation e-mail stating the date and a cancel link.
2. **Grace (14 days).** The user can sign in again; the profile page shows "Deletion scheduled for <date> – cancel". Cancelling
   clears `deletion_requested_at`. Nothing else changes during the grace period.
3. **Execution.** A daily owner-connection job (`db:process-deletions`, same pattern, heartbeat alert and launch-gate rule as
   `db:purge-signup-ips`) calls `anonymise_user(uuid)` for every account whose request is ≥ 14 days old. In one transaction it
   locks the row and:
   * sets `email = 'deleted-<id>@invalid'` (`.invalid` can never be delivered), `password_hash` = a value that can never verify,
     `first_name`, `last_name`, `date_of_birth`, `signup_ip` = `NULL`, `is_verified = false`, `is_admin = false`,
     `token_version + 1`, `anonymised_at = now()`;
   * deletes the user's `oauth_accounts`, `verification_tokens`, `password_reset_tokens`;
   * **skips (retries next day)** when the user has an open `ai_credit_holds` row or a `pending` checkout order, so it never races
     a payment or an AI turn – no billing code is changed for that.
   * reads or writes **no** ledger row and does not touch `user_balances`; the function is `SECURITY INVOKER`, `EXECUTE` revoked
     from PUBLIC, not granted to the application role (as `purge_signup_ips`).
4. **Idempotent:** a second run on an anonymised user is a no-op.

Needs **migration 017**: two nullable columns on `users` (`deletion_requested_at`, `anonymised_at`) plus the function. Rollback SQL:
drop the function and the columns (columns contain only timestamps).

## 3. Side effects I found that the implementation must handle

* **Late webhooks.** `webhook.service` can fall back to the buyer's e-mail to find the user when `custom_data.user_id` is missing.
  After anonymisation that lookup fails. A refund for an old order must still resolve through `custom_data.user_id` / the order id;
  tests must cover "refund arrives after anonymisation" (ledger entry posts against the same user id, reconcile stays clean).
* **Receipts.** `loadReceiptRecipient` reads `users.email`; for an anonymised user it would address `deleted-…@invalid`. It must skip
  sending (no receipt to a non-existent address).
* **Re-registration for bonus credits.** After anonymisation the original e-mail is free, so the same person can register again and
  receive the signup bonus (10 credits) again. A tombstone (hash of the e-mail) would stop that but is itself personal data
  (pseudonymous). **Owner decision:** accept the 10-credit exposure (the 14-day wait and e-mail verification limit it) or keep a
  salted-hash tombstone and say so in the privacy text.
* **Remaining credits** are forfeited on anonymisation (no refund path exists); the terms and the request screen must say so.
* **Admins:** an account with `is_admin = true` cannot self-delete (avoid removing the last admin); handled by hand.

## 4. Export

`GET /api/users/me/export`, same guard (password re-entry), rate-limited (e.g. 1 per hour), read-only. One JSON file: profile fields,
linked provider **names** (not the Google subject id), current balance, **every ledger row** of the user (amount, type, reference id,
timestamp), checkout orders (package, amount, status, dates), AI holds (reference id, status, dates). Never the password hash, token
hashes, other users' data, or the stored Lemon message. The ledger is only `SELECT`ed.

## 5. KVKK / GDPR mapping (my understanding – **unverified**, for counsel)

| Right | How it is met |
| --- | --- |
| Access / copy; portability (GDPR Art. 15, 20; KVKK Art. 11) | §4, machine-readable JSON |
| Rectification (GDPR Art. 16) | existing profile edit |
| Erasure (GDPR Art. 17; KVKK Art. 7) | §2 anonymisation; ledger/order records are retained as accounting records under a legal-obligation / legal-claims ground – wording and period are for the lawyer |
| Response time | GDPR: one month (Art. 12(3)); KVKK: 30 days (Art. 13). The 14-day grace sits inside both; the job runs daily |
| Identity check | password re-entry / fresh Google sign-in before either action |

Until this is built, requests are handled by e-mail through the `accountDeletion` owner field on `/privacy` and `/terms`.

## 6. Other parties – what deletion does **not** reach

* **Lemon Squeezy** (merchant of record): holds the buyer's name/e-mail/billing data under its own responsibility; our anonymisation does
  not delete it. The owner must read Lemon's retention/erasure process and name it on `/privacy` **(unverified: not read)**.
* **Resend**: delivery logs for the e-mails we sent; retention depends on the plan **(unverified)**.
* **Google** (sign-in): we delete the link; the user can revoke access in their Google account. **Gemini**: the conversation is sent
  per request and not stored by us (retention under Google's terms for the plan used – owner field `geminiDataUse`).
* **Hosting logs** (IP addresses): kept for the hosts' retention (`logRetention`), not removable by us.
* **PubChem**: receives the SMILES string and IP from the browser, with no link to an account.

## 7. Tests (PostgreSQL 18, none weakened)

Ledger rows and `SUM` per user identical before/after, `ledger_reconciliation()` empty, balance untouched; anonymised user cannot
sign in, old JWT rejected, password reset cannot revive it, the old e-mail registers as a new user; double run is a no-op; held
accounts are skipped and picked up later; cancel within the grace period; refund webhook after anonymisation; no receipt sent;
export contains no hash or token and the exact ledger rows; function privileges (not executable by the app role).

## 8. Phasing, effort, risk

* **Phase A – export** (read-only, no migration): lowest risk, can ship first.
* **Phase B – deletion** (migration 017, two endpoints, daily job, webhook/receipt guards, UI on the profile page): the part that
  needs your explicit approval. Roughly the size of the ledger-hardening work: touches `users`, session revocation and two
  billing-adjacent read paths (§3), not the ledger.

## 9. Decisions needed

1. Go / no-go for Phase A and for Phase B (separately).
2. Grace period: 14 days as proposed?
3. Re-registration: accept the 10-credit exposure, or keep a hashed tombstone (privacy text changes)?
4. Remaining credits forfeited on deletion – confirm, and the wording for terms.
5. Who answers emailed requests until this exists (and the Lemon Squeezy side)?
