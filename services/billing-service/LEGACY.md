# LEGACY — not part of the running stack

`services/billing-service` (Node.js/Express + Prisma billing service (Stripe)) is **not wired into the running stack**: no compose file, CI workflow, script,
root `package.json` or deployment config references it, and no running code calls it. Its role is covered by
services/auth-billing-service (billing routes, Lemon Squeezy).

It is **kept for reference only and is pending removal**. Removal will be decided in Phase 2, after hosting panels and
any external webhooks (e.g. Stripe) have been checked outside the repository.

* Do not deploy it, add features to it, or point external services (webhooks, DNS) at it.
* Untested: excluded from the Phase 1 test plan (`docs/testing/TEST_PLAN.md`).
* Vendored artifacts (`node_modules/`, `dist/`, `__pycache__/`) are no longer tracked (`040ff8b`); reinstall locally if
  you need to run it.
