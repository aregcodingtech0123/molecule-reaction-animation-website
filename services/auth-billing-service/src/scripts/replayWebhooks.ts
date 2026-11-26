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
import { env } from "../config/env.js";
import { consumeIngestedWebhookEvents } from "../services/v8Consumer.service.js";
import { retryStoredWebhookEvents } from "../services/webhookInbox.service.js";

// Both paths skip closed events and open review stops (Q-T3); external mode replays only rows of the ingestion process.
const replay = env.webhookIngestMode === "external" ? consumeIngestedWebhookEvents : retryStoredWebhookEvents;
const result = await replay({ all: true, limit: 10_000 });
if ("notReady" in result && result.notReady) {
  console.error("[webhooks:replay] The V8 schema is not ready; nothing was processed (no fallback to legacy):", result.notReady);
  await closePool();
  process.exit(1);
}
if (env.webhookIngestMode === "external") {
  console.log(
    "[webhooks:replay] external mode: only events stored by the ingestion process are replayed. Legacy rows (stored by the main service) " +
      "are drained only by the F3 procedure with the old build.",
  );
}
console.log(
  `[webhooks:replay] ${result.processed} processed, ${result.failed} still failing, ${result.skipped} skipped ` +
    "(already done, or being processed by the service right now).",
);
await closePool();
process.exitCode = result.failed > 0 ? 2 : 0;
