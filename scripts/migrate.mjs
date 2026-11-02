import fs from "fs";
import path from "path";
import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Error: DATABASE_URL is not set.");
  process.exit(1);
}

const sql = neon(connectionString);

async function runMigrations() {
  console.log("Starting safe database migration runner...");

  // 1. Ensure __drizzle_migrations tracking table exists
  await sql`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint
    )
  `;

  const appliedRows = await sql`SELECT hash, created_at FROM "__drizzle_migrations"`;
  const appliedHashes = new Set(appliedRows.map((r) => r.hash));

  // 2. Read journal
  const journalPath = path.resolve(import.meta.dirname, "../drizzle/meta/_journal.json");
  if (!fs.existsSync(journalPath)) {
    console.error("Migration journal not found at:", journalPath);
    process.exit(1);
  }

  const journal = JSON.parse(fs.readFileSync(journalPath, "utf-8"));
  const entries = journal.entries || [];

  for (const entry of entries) {
    const tag = entry.tag;
    if (appliedHashes.has(tag)) {
      console.log(`[✓] Migration already applied: ${tag}`);
      continue;
    }

    const sqlFilePath = path.resolve(import.meta.dirname, `../drizzle/${tag}.sql`);
    if (!fs.existsSync(sqlFilePath)) {
      console.error(`Migration file missing: ${sqlFilePath}`);
      process.exit(1);
    }

    console.log(`[→] Applying migration: ${tag}...`);
    const sqlContent = fs.readFileSync(sqlFilePath, "utf-8");
    const statements = sqlContent
      .split("--> statement-breakpoint")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      try {
        await sql.query(stmt);
      } catch (err) {
        // If 0000 baseline table creation encounters existing table, continue gracefully
        const errMsg = String(err);
        if (
          tag.startsWith("0000") &&
          (errMsg.includes("already exists") || errMsg.includes("duplicate key"))
        ) {
          console.log(`    Note: baseline object already exists in database (skipping).`);
          continue;
        }
        console.error(`Error executing statement #${i + 1} in ${tag}:`, err);
        throw err;
      }
    }

    await sql`
      INSERT INTO "__drizzle_migrations" (hash, created_at)
      VALUES (${tag}, ${Date.now()})
    `;
    console.log(`[✓] Successfully applied: ${tag}`);
  }

  console.log("All migrations successfully verified and up to date.");
}

runMigrations().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
