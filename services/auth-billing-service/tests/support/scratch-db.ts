import { randomBytes } from "node:crypto";
import pg from "pg";
import {
  applyMigrations,
  dropDatabase,
  listMigrationFiles,
  recreateDatabase,
} from "../../../../scripts/test/prepare-test-db.mjs";
import { testDatabaseUrl } from "../setup/test-db-url";

/** A throwaway database (name always contains `_test`, guarded) for tests that must not share state. */
export class ScratchDb {
  readonly url: string;
  readonly pool: pg.Pool;

  private constructor(url: string) {
    this.url = url;
    this.pool = new pg.Pool({ connectionString: url, max: 10 });
  }

  static async create(opts: { migrate?: boolean | string[] } = {}): Promise<ScratchDb> {
    const name = `mst_scratch_${randomBytes(4).toString("hex")}_test`;
    const url = testDatabaseUrl(name);
    await recreateDatabase(url);
    const db = new ScratchDb(url);
    if (opts.migrate === true) await applyMigrations(url);
    else if (Array.isArray(opts.migrate)) await applyMigrations(url, opts.migrate);
    return db;
  }

  async destroy(): Promise<void> {
    await this.pool.end();
    await dropDatabase(this.url);
  }
}

export const allMigrations = () => listMigrationFiles();
export const migrationsByPrefix = (...prefixes: string[]) =>
  listMigrationFiles().filter((f: string) => prefixes.some((p) => f.replace(/\\/g, "/").split("/").pop()!.startsWith(p)));
