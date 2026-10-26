/**
 * Samples PostgreSQL activity of the perf database while a load runs (one extra connection, read-only):
 * backends by state, backends waiting on a lock, ungranted advisory locks.
 */
import path from "node:path";
import { createRequire } from "node:module";
import { perfDatabaseUrl, serviceRoot } from "../config.mjs";
import { assertTestDatabaseUrl } from "../../test/db-guard.mjs";

const pg = createRequire(path.join(serviceRoot, "package.json"))("pg");

export async function startDbSampler({ intervalMs = 100, url = perfDatabaseUrl() } = {}) {
  assertTestDatabaseUrl(url);
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  const samples = [];
  let stopped = false;
  const loop = (async () => {
    while (!stopped) {
      const { rows } = await client.query(
        `SELECT count(*) FILTER (WHERE state = 'active')::int AS active,
                count(*) FILTER (WHERE state = 'idle in transaction')::int AS idle_in_tx,
                count(*) FILTER (WHERE state = 'idle')::int AS idle,
                count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS lock_waiting,
                (SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND NOT granted)::int AS advisory_waiting
         FROM pg_stat_activity
         WHERE datname = current_database() AND pid <> pg_backend_pid()`,
      );
      samples.push({ t: Date.now(), ...rows[0] });
      await new Promise((r) => setTimeout(r, intervalMs));
    }
  })();
  return {
    /** Summary of samples between t0 and t1 (epoch ms). */
    summary(t0 = 0, t1 = Infinity) {
      const s = samples.filter((x) => x.t >= t0 && x.t <= t1);
      const keys = ["active", "idle_in_tx", "idle", "lock_waiting", "advisory_waiting"];
      return Object.fromEntries(
        keys.map((k) => [k, { max: Math.max(0, ...s.map((x) => x[k])), mean: s.length ? Number((s.reduce((a, x) => a + x[k], 0) / s.length).toFixed(2)) : 0 }]),
      );
    },
    async stop() {
      stopped = true;
      await loop;
      await client.end();
    },
  };
}
