/**
 * C11: the per-user advisory lock is keyed on the canonical (lower-case) UUID text, because the database's narrow operations
 * lock hashtext(p_user_id::text) and PostgreSQL prints a uuid in lower case. Pure: a fake client records the query parameters.
 */
import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";
import { canonicalLockKey, lockUser } from "../../src/services/aiCredits.service.js";

const LOWER = "3f2b8c1e-9a4d-4e6b-8c7a-1d2e3f4a5b6c";
const UPPER = LOWER.toUpperCase();

function fakeClient() {
  const query = vi.fn(async () => ({ rows: [] }));
  return { client: { query } as unknown as PoolClient, query };
}

describe("canonicalLockKey", () => {
  it("leaves a canonical lower-case UUID unchanged", () => {
    expect(canonicalLockKey(LOWER)).toBe(LOWER);
  });

  it("folds an upper-case or mixed-case UUID to the canonical form", () => {
    expect(canonicalLockKey(UPPER)).toBe(LOWER);
    expect(canonicalLockKey("3F2B8C1E-9a4d-4E6B-8c7a-1D2E3F4A5B6C")).toBe(LOWER);
  });

  it.each([
    ["not a uuid", "user-123"],
    ["a UUID with braces", `{${UPPER}}`],
    ["a UUID without hyphens", UPPER.replaceAll("-", "")],
    ["a UUID with surrounding space", ` ${UPPER} `],
    ["a UUID with a trailing newline", `${UPPER}\n`],
    ["an empty string", ""],
    ["a mixed-case non-UUID", "ABC-Def"],
  ])("returns %s unchanged: it is never guessed at", (_label, value) => {
    expect(canonicalLockKey(value)).toBe(value);
  });
});

describe("lockUser", () => {
  it("takes the same lock parameter for the same user in any letter case", async () => {
    const a = fakeClient();
    const b = fakeClient();
    await lockUser(a.client, LOWER);
    await lockUser(b.client, UPPER);
    expect(a.query).toHaveBeenCalledTimes(1);
    expect(a.query.mock.calls[0]).toEqual(b.query.mock.calls[0]);
  });

  it("issues exactly one advisory-lock statement with the canonical key as the only parameter", async () => {
    const { client, query } = fakeClient();
    await lockUser(client, UPPER);
    expect(query).toHaveBeenCalledExactlyOnceWith("SELECT pg_advisory_xact_lock(hashtext($1::text))", [LOWER]);
  });

  it("passes a non-UUID id through unchanged", async () => {
    const { client, query } = fakeClient();
    await lockUser(client, "legacy-id-7");
    expect(query).toHaveBeenCalledExactlyOnceWith("SELECT pg_advisory_xact_lock(hashtext($1::text))", ["legacy-id-7"]);
  });
});
