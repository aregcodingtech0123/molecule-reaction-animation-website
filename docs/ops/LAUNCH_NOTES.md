# Launch notes — constraints accepted for launch

Owner decisions from the security audit (Phase 2) that limit how the product may be operated at launch.
Each line says what must stay true and what would have to change first. The launch checklist (Part 3)
links here.

## Payments (Lemon Squeezy)

* **Do not create discount codes** (no percentage, fixed or 100 % codes, no affiliate coupons) until the webhook
  validates the amount actually paid. Today an order is credited when `total`, `subtotal` **or** the line price
  equals the pack's list price; `subtotal` is before discounts, so any discount code — even 100 % off — credits
  the full pack (SEC-13 review). Before enabling codes: change the check to `total - tax` (or
  `total_usd - tax_usd`) against the list price, with a test.
* **Refunds are never clawed back automatically** (SEC-14). Subscribe `order_refunded`, run `db:reconcile`
  daily and review `refunded_order_credited` rows (runbook §9). Lemon documents no dispute/chargeback event:
  check disputes in the Lemon dashboard weekly.
* **Test mode:** never set `LEMONSQUEEZY_ALLOW_TEST_MODE=true` on the live deployment (SEC-13).

## Scale-out: single instance only

* **Express must run as exactly one instance** at launch. Its rate limiters (`express-rate-limit`, memory store)
  are per process (SEC-06 decision): with N instances behind a load balancer every limit is effectively N times
  higher, and a restart resets them. Before adding a second instance: move the limiters to a shared store
  (Redis / Upstash) and add the per-account (cross-IP) login limit noted in SEC-06.
* The in-process expired-hold sweeper also assumes one instance; with more, disable it
  (`AI_HOLD_SWEEP_INTERVAL_MS=0`) and schedule `SELECT release_expired_ai_holds();` (runbook §9).
* **Next.js:** `/api/chat` uses Upstash for its distributed limit when configured, plus an in-memory per-instance
  limit. Without Upstash the same single-instance rule applies.

## AI spend

* AI turns are capped per user (200 / 24 h) and globally (3 000 / 24 h) by default (SEC-16). Set
  `AI_DAILY_TURNS_GLOBAL` from the model budget before launch and alert on `AI_CAPACITY_REACHED` in the Express
  logs. Keep Upstash configured for the chat limiter if Next runs on more than one instance.

## Database role

* The service may keep using the owner role at launch. The least-privilege role (SEC-12,
  `docs/security/DB_ROLES.md`) is to be rehearsed on a Neon branch before switching production.
