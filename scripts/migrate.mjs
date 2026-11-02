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

  // 2. Safe Baseline Adoption for Pre-existing Databases:
  // If no migrations are recorded yet, check if the original baseline schema already exists
  if (appliedHashes.size === 0) {
    const existingTables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name IN ('users', 'bookings', 'event_types')
    `;

    if (existingTables.length === 3) {
      console.log(
        "[i] Detected existing pre-migration database with original Morrow schema (users, bookings, event_types)."
      );
      console.log(
        "[i] Safely adopting 0000_massive_songbird as existing baseline without re-running destructive table creation."
      );

      await sql`
        INSERT INTO "__drizzle_migrations" (hash, created_at)
        VALUES ('0000_massive_songbird', ${Date.now()})
      `;
      appliedHashes.add("0000_massive_songbird");
    }
  }

  // 3. Read journal
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
        // Distinguish genuinely existing baseline objects from missing columns, invalid constraints, or permissions
        const errObj = err || {};
        const sqlCode = errObj.code || (errObj.cause && errObj.cause.code);

        // PostgreSQL error codes:
        // 42P07: duplicate_table / duplicate_relation
        // 42710: duplicate_object
        const isDuplicateObject = sqlCode === "42P07" || sqlCode === "42710";

        if (tag.startsWith("0000") && isDuplicateObject) {
          console.log(`    Note: baseline object already exists (SQLSTATE ${sqlCode}), skipping duplicate statement #${i + 1}.`);
          continue;
        }

        console.error(`\n[FATAL] Migration failed at statement #${i + 1} of ${tag}:`);
        console.error(`Statement: ${stmt.slice(0, 150)}...`);
        console.error(`Error Code: ${sqlCode || "UNKNOWN"}`);
        console.error(`Error Message: ${errObj.message || String(err)}\n`);
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
