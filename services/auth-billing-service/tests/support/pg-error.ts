import { expect } from "vitest";

export interface PgErrorShape {
  code: string;
  message: string;
  constraint?: string;
}

/** Await a promise that must reject with a Postgres error; returns the error for further asserts. */
export async function expectPgError(promise: Promise<unknown>, code?: string): Promise<PgErrorShape> {
  let caught: unknown;
  try {
    await promise;
  } catch (err) {
    caught = err;
  }
  expect(caught, "expected a Postgres error but the query succeeded").toBeDefined();
  const err = caught as PgErrorShape;
  if (code) expect(err.code, err.message).toBe(code);
  return err;
}
