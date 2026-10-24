import type { TestProject } from "vitest/node";
import { loadTestEnvFile } from "../../../../scripts/test/test-env-file.mjs";
import { prepareTestDatabase } from "../../../../scripts/test/prepare-test-db.mjs";
import { testDatabaseUrl } from "./test-db-url";

/** Once per project: drop/recreate that project's guarded DB and apply 001→007. */
export default async function setup(project: TestProject) {
  loadTestEnvFile();
  const dbName = project.config.env?.TEST_DB_NAME as string | undefined;
  if (!dbName) throw new Error("global-db: TEST_DB_NAME must be set on the project");
  await prepareTestDatabase(testDatabaseUrl(dbName));
}
