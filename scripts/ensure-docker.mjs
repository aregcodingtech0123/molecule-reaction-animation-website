/**
 * Best-effort local Postgres bring-up for `npm run dev:all`.
 * If Docker Desktop is not running, logs a warning and continues
 * (so you can still use a remote/Supabase DATABASE_URL).
 */
import { spawnSync } from "node:child_process";

const result = spawnSync("docker", ["compose", "up", "-d"], {
  stdio: "inherit",
  shell: true,
});

if (result.status !== 0) {
  console.warn(
    "\n[dev:all] Docker Postgres was not started (is Docker Desktop running?).\n" +
      "          Continuing without it — point services/auth-billing-service/.env\n" +
      "          at a reachable DATABASE_URL, or start Docker and re-run.\n",
  );
  process.exit(0);
}

process.exit(0);
