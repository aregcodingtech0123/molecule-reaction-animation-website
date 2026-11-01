/**
 * Clears users.signup_ip for accounts older than the retention (migration 016, default 90 days).
 * Run it once a day from a scheduler (Render Cron Job, or any cron) with the OWNER connection:
 *
 *   node scripts/purge-signup-ips.mjs [--days 90]
 *
 * Prints how many addresses were cleared — never an address. Exit 0 on success, 64 on a bad argument.
 * It is not part of the running service on purpose: nothing billing-adjacent gets a new background task.
 */
import pg from "pg";
import { loadServiceEnv, resolveMigrationUrl } from "./lib/cli-env.mjs";

const args = process.argv.slice(2);
let days = 90;
if (args.length) {
  const ok = args.length === 2 && args[0] === "--days" && /^\d+$/.test(args[1]) && Number(args[1]) >= 1;
  if (!ok) {
    console.error("Usage: node scripts/purge-signup-ips.mjs [--days N]   (N is a whole number of days, at least 1)");
    process.exit(64);
  }
  days = Number(args[1]);
}

loadServiceEnv();

const client = new pg.Client({ connectionString: resolveMigrationUrl() });
await client.connect();
try {
  const { rows } = await client.query("SELECT purge_signup_ips(make_interval(days => $1::int)) AS cleared", [days]);
  console.log(`[purge-signup-ips] cleared ${rows[0].cleared} signup address(es) older than ${days} days.`);
} catch (err) {
  if (err?.code === "42883") {
    console.error("[purge-signup-ips] purge_signup_ips() does not exist: apply migration 016 first (npm run db:migrate).");
    process.exitCode = 1;
  } else {
    throw err;
  }
} finally {
  await client.end();
}
