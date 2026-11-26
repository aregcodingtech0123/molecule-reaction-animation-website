import type { TestProject } from "vitest/node";
import { loadTestEnvFile } from "../../../../scripts/test/test-env-file.mjs";
import { prepareTestDatabase } from "../../../../scripts/test/prepare-test-db.mjs";
import { provisionAckRole } from "../support/ack-role";
import { testDatabaseUrl } from "./test-db-url";

/**
 * Once per project: drop/recreate that project's guarded DB and apply the migrations, then provision the real
 * `moleculestudio_ack` login for it (O-21, tests/support/ack-role.ts). The ACK URL reaches the workers only through
 * `provide`, and only after the role, its grants and its login identity were verified.
 */
export default async function setup(project: TestProject) {
  loadTestEnvFile();
  const dbName = project.config.env?.TEST_DB_NAME as string | undefined;
  if (!dbName) throw new Error("global-db: TEST_DB_NAME must be set on the project");
  const url = testDatabaseUrl(dbName);
  await prepareTestDatabase(url);

  const ack = await provisionAckRole(url);
  if (!ack.ok) {
    console.warn(`[global-db] moleculestudio_ack not provisioned (${ack.reason}); suites that need the delivery-attempt pool will fail closed`);
  }
  project.provide("ackDatabaseUrl", ack.ok ? ack.ackUrl : null);
}
