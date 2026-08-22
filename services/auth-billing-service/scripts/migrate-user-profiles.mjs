import pg from "pg";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serviceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(serviceRoot, ".env") });

const FIRST_NAMES = [
  "Emma", "Liam", "Olivia", "Noah", "Ava", "Ethan", "Sophia", "Mason", "Isabella", "Lucas",
  "Mia", "James", "Charlotte", "Benjamin", "Amelia", "Henry", "Harper", "Alexander", "Evelyn", "Daniel",
  "Ayşe", "Mehmet", "Zeynep", "Can", "Elif", "Yuki", "Hiro", "Sakura", "Carlos", "Maria",
];

const LAST_NAMES = [
  "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis", "Rodriguez", "Martinez",
  "Wilson", "Anderson", "Taylor", "Thomas", "Moore", "Jackson", "Martin", "Lee", "Thompson", "White",
  "Yılmaz", "Kaya", "Demir", "Şahin", "Çelik", "Tanaka", "Suzuki", "Sato", "Fernandez", "Lopez",
];

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function generateRandomProfile() {
  const today = new Date();
  const ageYears = 18 + Math.floor(Math.random() * 52);
  const birthYear = today.getUTCFullYear() - ageYears;
  const birthMonth = 1 + Math.floor(Math.random() * 12);
  const birthDay = 1 + Math.floor(Math.random() * 28);

  const dateOfBirth = [
    String(birthYear),
    String(birthMonth).padStart(2, "0"),
    String(birthDay).padStart(2, "0"),
  ].join("-");

  return {
    firstName: randomItem(FIRST_NAMES),
    lastName: randomItem(LAST_NAMES),
    dateOfBirth,
  };
}

const migrationPath = path.resolve(serviceRoot, "../../database/init/002_user_profile_fields.sql");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

try {
  if (fs.existsSync(migrationPath)) {
    const sql = fs.readFileSync(migrationPath, "utf8");
    await pool.query(sql);
    console.log("Applied schema migration:", migrationPath);
  } else {
    console.warn("Migration file not found:", migrationPath);
  }

  await pool.query(`UPDATE users SET is_admin = false WHERE is_admin IS NULL`);

  const { rows: usersToBackfill } = await pool.query(
    `SELECT id FROM users
     WHERE first_name IS NULL
        OR last_name IS NULL
        OR date_of_birth IS NULL`,
  );

  if (usersToBackfill.length === 0) {
    console.log("No users require profile backfill.");
  } else {
    console.log(`Backfilling profile data for ${usersToBackfill.length} user(s)...`);

    for (const user of usersToBackfill) {
      const profile = generateRandomProfile();
      await pool.query(
        `UPDATE users
         SET first_name = COALESCE(first_name, $2),
             last_name = COALESCE(last_name, $3),
             date_of_birth = COALESCE(date_of_birth, $4::date),
             is_admin = COALESCE(is_admin, false),
             updated_at = NOW()
         WHERE id = $1`,
        [user.id, profile.firstName, profile.lastName, profile.dateOfBirth],
      );
    }

    console.log("Profile backfill complete.");
  }

  const summary = await pool.query(
    `SELECT
       COUNT(*)::int AS total_users,
       COUNT(*) FILTER (WHERE is_admin = true)::int AS admin_users,
       COUNT(*) FILTER (WHERE first_name IS NULL OR last_name IS NULL OR date_of_birth IS NULL)::int AS incomplete_profiles
     FROM users`,
  );

  console.log("Summary:", summary.rows[0]);
} finally {
  await pool.end();
}
