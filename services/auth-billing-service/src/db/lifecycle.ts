import { closeAckPool } from "./ackPool.js";
import { logDbError } from "./diagnostics.js";
import { closePool } from "./index.js";

/**
 * Close every database pool on shutdown: the main pool and the delivery-attempt pool. Both are always attempted, so one failing
 * to close does not keep the other open. Each failure is logged with safe fields only. Rejects after both attempts if either
 * failed. Safe to call repeatedly: a pool that is already closed (or was never created) is a no-op.
 */
export async function closeDatabasePools(): Promise<void> {
  const results = await Promise.allSettled([closePool(), closeAckPool()]);
  const errors: unknown[] = [];
  results.forEach((r, i) => {
    if (r.status === "rejected") {
      logDbError(i === 0 ? "shutdown main pool" : "shutdown ack pool", r.reason);
      errors.push(r.reason);
    }
  });
  if (errors.length > 0) throw new AggregateError(errors, "One or more database pools failed to close.");
}
