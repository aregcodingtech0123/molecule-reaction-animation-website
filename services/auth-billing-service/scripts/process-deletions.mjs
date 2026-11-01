/**
 * Daily account-deletion job (migration 017): anonymises every account whose deletion request is at least 14 days old, and
 * removes e-mail tombstones older than 12 months. Run it once a day from a scheduler with the OWNER connection:
 *
 *   node scripts/process-deletions.mjs [--dry-run]
 *
 * For each due account it calls anonymise_user() in its own transaction (one failure never stops the others). An account with
 * an unexpired AI reservation or a recent pending checkout is skipped and retried the next day. Ledger rows and balances are
 * never read for writing: the SQL function does not name those tables.
 *
 * Re-registration guard: with EMAIL_TOMBSTONE_GUARD on (the default) each e-mail is hashed here with HMAC-SHA256 under
 * EMAIL_TOMBSTONE_SECRET and only the hash is stored. If the secret is missing the job REFUSES to run - it never falls back to an
 * unkeyed hash. With EMAIL_TOMBSTONE_GUARD=false no hash is computed or stored.
 *
 * Prints counts only - never an address, hash or user id. Exit 0 on success, 1 on failure (including a missing migration 017
 * or secret), 2 when the work succeeded but the heartbeat ping failed, 64 on a bad argument.
 * Dead-man's switch: set DELETION_HEARTBEAT_URL to a heartbeat monitor's ping URL (see lib/heartbeat.mjs).
 */
import { createHmac, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import pg from "pg";
import { loadServiceEnv, resolveMigrationUrl } from "./lib/cli-env.mjs";
import { sendHeartbeat } from "./lib/heartbeat.mjs";

const args = process.argv.slice(2);
const dryRun = args.length === 1 && args[0] === "--dry-run";
if (args.length && !dryRun) {
  console.error("Usage: node scripts/process-deletions.mjs [--dry-run]");
  process.exit(64);
}

loadServiceEnv();

const rawGuard = process.env.EMAIL_TOMBSTONE_GUARD?.trim().toLowerCase() ?? "";
const guardOn = rawGuard === "" || /^(true|1|yes|on)$/.test(rawGuard);
if (!guardOn && !/^(false|0|no|off)$/.test(rawGuard)) {
  console.error('[process-deletions] EMAIL_TOMBSTONE_GUARD must be "true" or "false"; nothing was changed.');
  process.exit(1);
}
const secret = process.env.EMAIL_TOMBSTONE_SECRET?.trim() ?? "";
if (guardOn && secret.length < 32) {
  console.error(
    "[process-deletions] EMAIL_TOMBSTONE_SECRET is missing or shorter than 32 characters while EMAIL_TOMBSTONE_GUARD is on; " +
      "refusing to anonymise anyone (an unkeyed hash is never stored). Nothing was changed.",
  );
  process.exit(1);
}

const BATCH = 500;
const client = new pg.Client({ connectionString: resolveMigrationUrl() });
await client.connect();
try {
  const due = await client.query(
    `SELECT id, email FROM users
      WHERE deletion_requested_at <= NOW() - INTERVAL '14 days' AND anonymised_at IS NULL AND NOT is_admin
      ORDER BY deletion_requested_at LIMIT ${BATCH}`,
  );

  if (dryRun) {
    console.log(`[process-deletions] dry run: ${due.rowCount} account(s) are due; nothing was changed.`);
  } else {
    const tally = {};
    let failed = 0;
    for (const { id, email } of due.rows) {
      try {
        const emailHmac = guardOn ? createHmac("sha256", secret).update(String(email).trim().toLowerCase()).digest() : null;
        // A valid bcrypt hash of a random value nobody knows: the account can no longer be signed in to.
        const unusableHash = await bcrypt.hash(randomBytes(48).toString("base64url"), 10);
        const { rows } = await client.query("SELECT anonymise_user($1::uuid, $2, $3::bytea) AS outcome", [id, unusableHash, emailHmac]);
        tally[rows[0].outcome] = (tally[rows[0].outcome] ?? 0) + 1;
      } catch (err) {
        failed += 1;
        console.error(`[process-deletions] one account could not be anonymised (SQLSTATE ${err?.code ?? "unknown"}); it is retried tomorrow.`);
      }
    }
    const removed = await client.query("SELECT purge_email_tombstones() AS removed");
    const done = tally.anonymised ?? 0;
    const busy = tally.busy ?? 0;
    const other = Object.entries(tally).filter(([k]) => k !== "anonymised" && k !== "busy").reduce((n, [, v]) => n + v, 0);
    console.log(
      `[process-deletions] anonymised ${done} account(s); ${busy} postponed (open AI reservation or pending checkout); ` +
        `${other} skipped for other reasons; ${failed} failed; removed ${removed.rows[0].removed} expired e-mail tombstone(s)` +
        `${due.rowCount === BATCH ? `; more may be due (batch limit ${BATCH}) - they are handled on the next run` : ""}.`,
    );
    if (failed > 0) process.exitCode = 1;
  }
  if (process.exitCode !== 1 && !(await sendHeartbeat("process-deletions", process.env.DELETION_HEARTBEAT_URL))) process.exitCode = 2;
} catch (err) {
  if (err?.code === "42883" || err?.code === "42703" || err?.code === "42P01") {
    console.error("[process-deletions] migration 017 is not applied: run npm run db:migrate first.");
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  await client.end();
}
