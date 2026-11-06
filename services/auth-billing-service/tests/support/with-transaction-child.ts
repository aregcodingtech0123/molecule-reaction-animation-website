/**
 * Child process of tests/db/with-transaction-connection-loss.test.ts: the real withTransaction with no test runner
 * around it, so an unhandled 'error' event ends the process exactly as it would end the service.
 * Run with `node --import tsx --import scripts/test/no-dotenv.mjs`, with DATABASE_URL set to a guarded test database.
 *
 * Prints `RESULT:{...}` and exits 0 only if the process survived the terminated connection.
 */
import pg from "pg";
import { closePool, withTransaction } from "../../src/db/index.js";

const scenario = process.argv[2];
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();

const pidOf = (client: unknown) => (client as { processID: number }).processID;
const terminate = (client: unknown) => admin.query(`SELECT pg_terminate_backend($1)`, [pidOf(client)]);

let terminatedPid = 0;
let outcome: { settled: "resolved" | "rejected"; code?: string };
try {
  await withTransaction(async (client) => {
    terminatedPid = pidOf(client);
    if (scenario === "active-query") {
      // Handled from the start: this query can reject before terminate() returns.
      const [sleeping] = await Promise.allSettled([client.query(`SELECT pg_sleep(30)`), terminate(client)]);
      if (sleeping.status === "rejected") throw sleeping.reason;
    } else {
      const ended = new Promise((resolve) => client.once("end", resolve));
      await terminate(client);
      await ended;
    }
  });
  outcome = { settled: "resolved" };
} catch (err) {
  outcome = { settled: "rejected", code: (err as { code?: string }).code };
}

// Long enough for any late socket event to arrive before this process claims to have survived it.
await new Promise((resolve) => setTimeout(resolve, 200));

const next = await withTransaction(async (client) => ({
  ok: (await client.query(`SELECT 1 AS ok`)).rows[0].ok as number,
  pid: pidOf(client),
}));

console.log(`RESULT:${JSON.stringify({ outcome, nextOk: next.ok, reusedDeadClient: next.pid === terminatedPid })}`);

await admin.end();
await closePool();
