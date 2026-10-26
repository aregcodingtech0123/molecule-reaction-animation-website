/**
 * Process every stored Lemon Squeezy webhook event that is not done (R19): failed ones (also past the
 * automatic attempt limit), ones never picked up, and stale claims. Live claims are left alone.
 *
 *   npm run webhooks:replay        (after `npm run build`; uses the service's own environment)
 *
 * Safe to run at any time and repeatedly: crediting is idempotent per order. Exit 0 when nothing failed,
 * 2 when some events still fail (their last error is in `npm run db:reconcile`).
 */
import "../config/loadEnv.js";
import { closePool } from "../db/index.js";
import { retryStoredWebhookEvents } from "../services/webhookInbox.service.js";

const result = await retryStoredWebhookEvents({ all: true, limit: 10_000 });
console.log(
  `[webhooks:replay] ${result.processed} processed, ${result.failed} still failing, ${result.skipped} skipped ` +
    "(already done, or being processed by the service right now).",
);
await closePool();
process.exitCode = result.failed > 0 ? 2 : 0;
