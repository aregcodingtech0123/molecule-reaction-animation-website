import pg from "pg";
import { vi } from "vitest";

/**
 * Counts every query/connection the SERVICE makes, regardless of the lazy
 * Proxy around its pool: all pg.Pool / pg.Client instances share these
 * prototypes. Test-side assertion pools are created from the same classes, so
 * call `reset()` immediately before the action under test.
 */
export function spyOnPostgres() {
  const poolQuery = vi.spyOn(pg.Pool.prototype, "query");
  const poolConnect = vi.spyOn(pg.Pool.prototype, "connect");
  const clientQuery = vi.spyOn(pg.Client.prototype, "query");
  return {
    poolQuery,
    poolConnect,
    clientQuery,
    total: () => poolQuery.mock.calls.length + poolConnect.mock.calls.length + clientQuery.mock.calls.length,
    reset() {
      poolQuery.mockClear();
      poolConnect.mockClear();
      clientQuery.mockClear();
    },
  };
}
