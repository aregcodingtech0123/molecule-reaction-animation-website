/**
 * Clears users.signup_ip for accounts older than the retention (migration 016, default 90 days).
 * Run it once a day from a scheduler (Render Cron Job, or any cron) with the OWNER connection:
 *
 *   node scripts/purge-signup-ips.mjs [--days 90]
 *
 * Prints how many addresses were cleared — never an address. Exit 0 on success, 64 on a bad argument, 1 on failure
 * (including a missing migration 016), 2 if the job succeeded but the heartbeat ping failed.
 *
 * Dead-man's switch: set PURGE_HEARTBEAT_URL to the ping URL of a heartbeat monitor (healthchecks.io-style: it alerts
 * when NO ping arrives within the expected period). The script GETs it once, only after the purge succeeded, so a job
 * that fails OR never runs at all is noticed. The URL usually carries a secret: only its host is ever printed.
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

/** One GET to the heartbeat monitor; resolves to true when it answered 2xx. Never prints the URL, only its host. */
async function ping(raw) {
  let url;
  try {
    url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("protocol");
  } catch {
    console.error("[purge-signup-ips] PURGE_HEARTBEAT_URL is not an http(s) URL; the heartbeat was not sent.");
    return false;
  }
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) console.error(`[purge-signup-ips] heartbeat to ${url.host} answered HTTP ${res.status}.`);
    else console.log(`[purge-signup-ips] heartbeat sent to ${url.host}.`);
    return res.ok;
  } catch {
    console.error(`[purge-signup-ips] heartbeat to ${url.host} failed.`);
    return false;
  }
}

const client = new pg.Client({ connectionString: resolveMigrationUrl() });
await client.connect();
try {
  const { rows } = await client.query("SELECT purge_signup_ips(make_interval(days => $1::int)) AS cleared", [days]);
  console.log(`[purge-signup-ips] cleared ${rows[0].cleared} signup address(es) older than ${days} days.`);
  const heartbeat = process.env.PURGE_HEARTBEAT_URL?.trim();
  if (heartbeat && !(await ping(heartbeat))) process.exitCode = 2;
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
