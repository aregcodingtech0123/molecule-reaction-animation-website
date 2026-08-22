import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(serviceRoot, ".env") });

const adminUrl =
  process.env.DATABASE_URL?.replace(/\/[^/]+$/, "/postgres") ??
  `postgresql://${process.env.DB_USER}:${process.env.DB_PASSWORD}@${process.env.DB_HOST ?? "localhost"}:${process.env.DB_PORT ?? 5432}/postgres`;

const dbName = process.env.DB_NAME ?? "molecule_studio_db";

const client = new pg.Client({ connectionString: adminUrl });

try {
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);

  if (exists.rowCount === 0) {
    await client.query(`CREATE DATABASE ${dbName}`);
    console.log(`Created database: ${dbName}`);
  } else {
    console.log(`Database already exists: ${dbName}`);
  }
} finally {
  await client.end();
}

const initSqlFiles = [
  path.resolve(serviceRoot, "../../database/init/001_moleculestudio_core.sql"),
  path.resolve(serviceRoot, "../../database/init/002_user_profile_fields.sql"),
  path.resolve(serviceRoot, "../../database/init/003_dual_payment_providers.sql"),
  path.resolve(serviceRoot, "../../database/init/004_email_verification.sql"),
  path.resolve(serviceRoot, "../../database/init/005_oauth_and_token_revocation.sql"),
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

for (const initSqlPath of initSqlFiles) {
  if (fs.existsSync(initSqlPath)) {
    const sql = fs.readFileSync(initSqlPath, "utf8");
    await pool.query(sql);
    console.log("Applied schema:", initSqlPath);
  } else {
    console.warn("Schema file not found:", initSqlPath);
  }
}

const probe = await pool.query("SELECT NOW() AS server_time");
console.log("Connection OK:", probe.rows[0]);
await pool.end();
