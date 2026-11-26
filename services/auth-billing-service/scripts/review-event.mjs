/**
 * Owner tool: close or reopen a review stop (V8 contract 17.6, 17.7, Q-D1). Runs on the owner connection; needs the V8
 * migration 022. Never run by the service.
 *
 *   npm run db:review-event -- close <event id> <do_not_credit|resolved> "<decision, initials>"
 *   npm run db:review-event -- reopen <event id>
 *
 * Exit 0: done. Exit 3: the event was not in a state that allows it (nothing changed). Exit 1: usage or refusal.
 */
import pg from "pg";
import { loadServiceEnv, resolveMigrationUrl } from "./lib/cli-env.mjs";
import { ReviewDecisionError, closeReview, reopenReview } from "./lib/review-decisions.mjs";

const [action, id, ...rest] = process.argv.slice(2);
if (!["close", "reopen"].includes(action) || !id || (action === "close" && rest.length < 2)) {
  console.error('usage: review-event close <id> <do_not_credit|resolved> "<note>" | review-event reopen <id>');
  process.exit(1);
}

loadServiceEnv();
const client = new pg.Client({ connectionString: resolveMigrationUrl() });
await client.connect();
try {
  const done = action === "close" ? await closeReview(client, id, rest[0], rest.slice(1).join(" ")) : await reopenReview(client, id);
  console.log(done ? `[review-event] ${action}d event ${id}.` : `[review-event] event ${id} was not ${action === "close" ? "closable" : "reopenable"}; nothing changed.`);
  process.exitCode = done ? 0 : 3;
} catch (err) {
  if (!(err instanceof ReviewDecisionError)) throw err;
  console.error(`[review-event] ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
