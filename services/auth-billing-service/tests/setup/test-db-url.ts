import {
  assertTestDatabaseUrl,
  resolveTestDatabaseUrl,
} from "../../../../scripts/test/db-guard.mjs";

/** TEST_DATABASE_URL with its database name replaced — still passed through the guard. */
export function testDatabaseUrl(dbName = process.env.TEST_DB_NAME): string {
  const base = new URL(resolveTestDatabaseUrl());
  if (dbName) base.pathname = `/${dbName}`;
  const url = base.toString();
  assertTestDatabaseUrl(url);
  return url;
}
