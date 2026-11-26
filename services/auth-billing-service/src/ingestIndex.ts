/**
 * Entry point of the SEPARATE webhook ingestion process (Step 7.5, O-1 Option B): `npm run start:ingest` (after `npm run build`).
 *
 * It loads only `.env.ingest` of this folder (never the main service's `.env`), refuses to start when its configuration is wrong
 * or when it holds any credential that belongs to the main service, and serves only the webhook endpoint.
 */
import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createIngestApp } from "./ingest/app.js";
import { resolveIngestConfig } from "./ingest/config.js";
import { createIngestStore } from "./ingest/store.js";

if (process.env.MOLECULESTUDIO_SKIP_DOTENV !== "1") {
  dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../.env.ingest") });
}

const resolved = resolveIngestConfig();
if (!resolved.ok) {
  for (const problem of resolved.problems) console.error(`FATAL: ${problem}`);
  console.error("FATAL: refusing to start the webhook ingestion process. Exiting.");
  process.exit(1);
}
const { config } = resolved;

const store = createIngestStore({ connectionString: config.databaseUrl });
const app = createIngestApp({ config, store });

// Not fatal: deliveries are answered 503 (and redelivered by Lemon) until the role and its grants check out.
const first = await store.ready();
console.log(`[ingest] database: ${first.ready ? "webhook role verified" : `not ready (${first.reason}) — deliveries are refused with 503`}`);

const server = app.listen(config.port, config.host, () => {
  console.log(`[ingest] webhook ingestion listening on ${config.host}:${config.port}`);
});
server.on("error", (err) => {
  console.error(`[ingest] failed to bind port ${config.port}: ${err.message}`);
  process.exit(1);
});

function shutdown(signal: string): void {
  console.log(`[ingest] ${signal} — shutting down`);
  server.close(() => {
    void store.close().finally(() => process.exit(0));
  });
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
