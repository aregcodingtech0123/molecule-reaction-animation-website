/**
 * Apply pending migrations from database/init through the tracked runner.
 *
 *   node scripts/migrate.mjs                 apply pending migrations
 *   node scripts/migrate.mjs --status        show applied / baselined / pending
 *   node scripts/migrate.mjs --baseline      adopt an existing (pre-runner) database
 *   node scripts/migrate.mjs --dry-run       print the plan, change nothing
 *
 * Uses MIGRATION_DATABASE_URL if set, else DATABASE_URL (must be a DIRECT,
 * non-pooled connection).
 */
import { flag, loadServiceEnv, resolveMigrationUrl } from "./lib/cli-env.mjs";
import { migrate, migrationStatus } from "./lib/migrator.mjs";

loadServiceEnv();
const connectionString = resolveMigrationUrl();
const host = new URL(connectionString).host;

try {
  if (flag("--status")) {
    const rows = await migrationStatus({ connectionString });
    console.log(`Migration status for ${host}:`);
    for (const r of rows) console.log(`  ${r.state.padEnd(18)} ${r.filename}`);
  } else {
    const result = await migrate({
      connectionString,
      baseline: flag("--baseline"),
      dryRun: flag("--dry-run"),
      log: (m) => console.log(`[migrate] ${m}`),
    });
    console.log(
      `[migrate] ${host}: mode=${result.mode} baselined=${result.baselined.length} applied=${result.applied.length}` +
        (result.pending.length ? ` pending=${result.pending.join(",")}` : ""),
    );
  }
} catch (err) {
  console.error(`[migrate] FAILED (${err.code ?? "error"}): ${err.message}`);
  process.exit(1);
}
