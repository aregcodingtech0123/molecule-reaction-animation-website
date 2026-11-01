# Design note — account deletion and data export (KVKK / GDPR)

**Status: Phase A (export) is implemented (see §4). Phase B (deletion) is approved in principle (14-day grace, forfeited credits shown
clearly on the deletion screen) but is NOT implemented in this round; this revision adds the late-webhook/receipt handling (§3.1–3.2) and the
re-registration guard (§3.3). Waiting for the owner's go before any Phase B code.** Rule that governs it: ledger rows stay immutable and are never read for writing, updated or deleted.
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

## 3. Side effects that the implementation must handle (checked against the code, with the tests planned for each)

### 3.1 Late webhooks — a refund, or a purchase, arriving after anonymisation

I read the webhook code to see exactly what each event does with the user row.

| Event arriving after the account was anonymised | What the code does today | What it would do after anonymisation | Change needed | Planned test (PostgreSQL 18) |
| --- | --- | --- | --- | --- |
| `order_refunded` (late refund of an old order) | `recordLemonRefund` writes one `lemon_order_refunds` row keyed by the order id and **never reads `users`**; credits are never changed ("recorded for review"); `refunded_orders_to_review()` joins the ledger by order reference and returns `user_id`, no e-mail | identical – the user id still exists | **none** | refund for an order of an anonymised user: row recorded, ledger and balance unchanged, `refunded_orders_to_review()` lists it with the same `user_id`, `db:reconcile` stays clean otherwise |
| `order_created` (a late or re-delivered purchase, `custom_data.user_id` = the anonymised user) | `resolveUserId` accepts any existing `users.id`, so the credits would be posted to a dead account – the customer pays, gets nothing, and nothing flags it | **must not credit** | `userExists()` (and `findUserIdByEmail`) ignore rows with `anonymised_at IS NOT NULL`, so resolution falls through to the existing `missing_user` outcome: the inbox row stays unprocessed and `db:reconcile` reports `webhook_unprocessed` – the owner then refunds the buyer in the Lemon dashboard. No ledger row is written for an order nobody can use | `order_created` for an anonymised user: HTTP 200 to Lemon, **no** ledger row, **no** balance change, event stored as unprocessed with `missing_user`, reconcile exit 2 names it; same order for a *normal* user is credited exactly as before (regression); the old e-mail re-registered by someone new: the order email fallback matches that new account only when `custom_data.user_id` is absent (unchanged rule) |
| a purchase whose checkout was started before the request (pending order) | – | the deletion job **skips** users with a `pending` checkout order or an open AI hold and retries the next day | none in billing code | job skips a user with a pending order, anonymises them the day after the order completes, and the credits from that order are then forfeited like the rest of the balance (the privacy/terms text and the deletion screen say so) |

The ledger itself is never touched by any of these changes; the only billing-adjacent code edit is the user lookup in the two helpers above (a read).

### 3.2 Receipts for anonymised users

`queuePurchaseReceipt` → `loadReceiptRecipient(userId)` reads `users.email`; it already returns `null` when the user is not found, and the caller then logs "Skipping purchase receipt — user not found" and returns. Change: the query adds `AND anonymised_at IS NULL`, so an anonymised user is "not found" and **no e-mail is sent** to `deleted-<id>@invalid`. Because §3.1 already stops crediting an anonymised user, a receipt can only be requested for an anonymised user in a race (credited a moment before the job ran); the receipt is then skipped, the purchase is in the ledger, and the export/audit trail is intact.
Planned tests: no outgoing e-mail for an anonymised user (the e-mail transport is asserted not called, and the log line is the existing "Skipping…"); a normal user's receipt unchanged; a receipt queued for a user anonymised between crediting and sending does not throw and does not block fulfilment (the existing "never blocks or fails fulfilment" guarantee).

### 3.3 Re-registration for bonus credits — proposed guard: a salted (keyed) hash of the e-mail

**Problem.** After anonymisation the original e-mail is free, so the same person can register again and receive the signup bonus (10 credits) again.

**Proposal.**
* At anonymisation the job stores `HMAC-SHA256(secret, lower(trim(email)))` in a new table `deleted_email_tombstones (email_hmac BYTEA PRIMARY KEY, created_at TIMESTAMPTZ)`. "Salted" here means **keyed with a server-side secret** (`EMAIL_TOMBSTONE_SECRET`, in the environment, never in the database): a per-row random salt cannot be looked up later, and an unkeyed hash of an e-mail address can be reversed by trying a list of addresses. The e-mail itself is not kept.
* At sign-up (password registration and the brand-new-Google-user branch) the same HMAC is computed; if a tombstone exists the account is created normally and verification works as usual, but **`grantSignupBonus` is skipped**. Nothing is blocked, and the HTTP answer stays identical for new and existing addresses (FINDING-09). The only visible difference is a starting balance of 0 instead of 10, seen by the mailbox owner alone.
* The ledger is untouched: no row is written for a skipped bonus. The signup path and `grantSignupBonus` are edited (auth/billing-adjacent), hence the approval gate.
* Limits: a different e-mail address bypasses it (it is a speed bump for the 10-credit exposure, not an identity check); rotating or losing `EMAIL_TOMBSTONE_SECRET` makes old tombstones useless (fail-open) – it becomes a `check:config` variable and a rotation-table entry.

**Privacy implication — flagged for legal review.** A keyed hash of an e-mail address is still personal data (pseudonymised, not anonymous), so keeping it after an erasure request needs a stated purpose and legal basis (fraud / abuse prevention as a legitimate interest is the usual argument), a fixed retention period (suggestion: 12 months, then the job deletes the tombstone), disclosure on `/privacy`, and a view on whether it conflicts with the erasure right (GDPR Art. 17; KVKK Art. 7). **(unverified — my reading, not legal advice.)** If counsel says no, the alternative is to accept the 10-credit exposure; nothing else in this design depends on the guard.

Planned tests: tombstone written in the same transaction as anonymisation and contains no e-mail; re-registering the deleted address creates a working account **without** the signup bonus (balance 0, ledger empty) for both password and Google sign-up; a different address still gets the bonus; response bodies identical for tombstoned and fresh addresses; the ledger of the old and new account untouched; expired tombstones (older than the retention) are removed by the job and the bonus is granted again; a missing `EMAIL_TOMBSTONE_SECRET` makes the job refuse to anonymise (it never falls back to storing an unkeyed hash).

### 3.4 Other points

* **Remaining credits** are forfeited on anonymisation (no refund path exists). The **deletion screen must say so clearly before the user confirms**: the current balance in credits, "these credits are lost and cannot be restored or refunded", the 14-day grace period and the cancel option, and what is kept (the ledger as the accounting record). The same sentence goes into the terms and privacy text.
* **Admins:** an account with `is_admin = true` cannot self-delete (avoid removing the last admin); handled by hand.

## 4. Export — implemented (Phase A)

As built: `POST /api/users/export` (POST so the secret is never in a URL), authenticated, body `{password}` **or** `{idToken}` (a Google ID token issued within the last 5 minutes for the Google identity linked to this account; every failure is a 403 `REAUTH_FAILED`, never 401, so the browser does not sign the user out), rate limit 5 attempts/hour/account (wrong passwords count), `Cache-Control: no-store`. UI: profile page "Download my data". Tests: `tests/api/users.export.test.ts`, `tests/api/gateway.export.test.ts`, `tests/unit/profile/export-data-section.test.tsx`. Original design follows.

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

## 9. Decisions still needed before Phase B

1. Go / no-go for Phase B (migration 017 with `deletion_requested_at`, `anonymised_at`, the tombstone table; two endpoints; the daily job with heartbeat; the webhook-lookup and receipt guards of §3.1–3.2).
2. Re-registration guard (§3.3): build it (and have counsel review the keyed-hash tombstone, its 12-month retention and the privacy wording), or accept the 10-credit exposure.
3. Who answers e-mailed requests until Phase B exists, and the Lemon Squeezy / Resend sides (§6).
4. Wording of the forfeited-credits warning on the deletion screen and in the terms (§3.4).

Decided already: 14-day grace period; remaining credits forfeited; anonymise rather than delete; the ledger stays immutable.
