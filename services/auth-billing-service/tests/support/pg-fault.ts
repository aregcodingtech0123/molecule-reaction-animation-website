import pg from "pg";

/**
 * Deterministic database faults without production hooks: intercepts the service's promise-style client queries
 * (its transactions use those) at the same prototype as tests/support/pg-spy.ts. Callback-style calls, which is how
 * pool.query() reaches a client, always pass through, so a test's assertion pool is never affected.
 *
 * The faults stay real: `proceed(sqlStateFault(code))` makes the server raise that SQLSTATE and abort the statement,
 * and killConnection() terminates the backend. Nothing is faked on the JavaScript side unless a test does so itself.
 */
export interface InterceptedQuery {
  sql: string;
  client: pg.Client;
  /** Send the query, or a replacement statement, to the server. */
  proceed(replacementSql?: string): Promise<unknown>;
}

/** Return a promise to take over the query, or null to let it through. */
export type QueryInterceptor = (q: InterceptedQuery) => Promise<unknown> | null;

export function interceptClientQueries(handler: QueryInterceptor): () => void {
  const proto = pg.Client.prototype as unknown as { query: (...args: unknown[]) => unknown };
  const real = proto.query;
  proto.query = function (this: pg.Client, ...args: unknown[]) {
    const [sql] = args;
    if (typeof sql !== "string" || args.some((a) => typeof a === "function")) return real.apply(this, args);
    const send = (replacementSql?: string) => real.apply(this, replacementSql === undefined ? args : [replacementSql]) as Promise<unknown>;
    return handler({ sql, client: this, proceed: send }) ?? send();
  };
  return () => {
    proto.query = real;
  };
}

/** A statement that makes PostgreSQL itself raise `sqlState`, aborting the statement like the real error would. */
export function sqlStateFault(sqlState: string): string {
  return `DO $$ BEGIN RAISE EXCEPTION 'injected fault' USING ERRCODE = '${sqlState}'; END $$`;
}

const backendPid = (client: pg.Client) => (client as unknown as { processID: number }).processID;

/** Terminate the client's backend and wait until it is gone: the open transaction is rolled back by the server. */
export async function terminateBackend(admin: pg.Pool, client: pg.Client): Promise<void> {
  const pid = backendPid(client);
  await admin.query(`SELECT pg_terminate_backend($1)`, [pid]);
  for (;;) {
    const { rows } = await admin.query(`SELECT 1 FROM pg_stat_activity WHERE pid = $1`, [pid]);
    if (rows.length === 0) return;
    await new Promise((r) => setTimeout(r, 10));
  }
}

/**
 * terminateBackend() for tests about money rather than process survival: a listener is added first, so that a missing
 * handler cannot fail the run as an uncaught exception. Returns how many 'error' listeners the client had before that.
 */
export async function killConnection(admin: pg.Pool, client: pg.Client): Promise<{ errorListenersBefore: number }> {
  const errorListenersBefore = client.listenerCount("error");
  client.on("error", () => undefined);
  await terminateBackend(admin, client);
  return { errorListenersBefore };
}

export { backendPid };
