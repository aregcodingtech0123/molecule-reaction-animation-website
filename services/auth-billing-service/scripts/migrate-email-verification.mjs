/**
 * Applies database/init/004_email_verification.sql against the configured DB.
 * Usage: node scripts/migrate-email-verification.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serviceRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(serviceRoot, ".env") });

const sqlPath = path.resolve(serviceRoot, "../../database/init/004_email_verification.sql");

async function main() {
  const connectionString =
    process.env.DATABASE_URL ||
    `postgresql://${process.env.DB_USER || "postgres"}:${process.env.DB_PASSWORD || "postgres"}@${process.env.DB_HOST || "localhost"}:${process.env.DB_PORT || "5432"}/${process.env.DB_NAME || "molecule_studio_db"}`;

  const sql = fs.readFileSync(sqlPath, "utf8");
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
    console.log("Applied 004_email_verification.sql");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
