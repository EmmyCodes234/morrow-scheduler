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
    const requiredTables = [
      "availability",
      "availability_overrides",
      "bookings",
      "contacts",
      "event_types",
      "users",
      "verification_tokens",
    ];

    const existingTablesResult = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name = ANY(${requiredTables})
    `;
    const foundTables = new Set(existingTablesResult.map((r) => r.table_name));

    if (foundTables.size === 0) {
      console.log("[i] Fresh database detected (no baseline tables found). Running migrations from scratch.");
    } else {
      // Pre-existing database detected. Check if complete baseline is present.
      const missingTables = requiredTables.filter((t) => !foundTables.has(t));
      if (missingTables.length > 0) {
        console.error(`\n[FATAL] Incomplete baseline schema detected.`);
        console.error(`Found tables: ${Array.from(foundTables).join(", ")}`);
        console.error(`Missing required baseline tables: ${missingTables.join(", ")}`);
        console.error(`Cannot adopt baseline safely. Please inspect the database.\n`);
        process.exit(1);
      }

      // Check essential required columns on key baseline tables
      const requiredColumns = {
        users: ["id", "email", "timezone"],
        bookings: ["id", "host_id", "event_type_id", "start_time", "end_time", "status", "guest_email"],
        event_types: ["id", "user_id", "title", "slug", "duration_mins"],
        availability: ["id", "user_id", "day_of_week", "start_time", "end_time"],
        availability_overrides: ["id", "user_id", "date", "is_blocked"],
        contacts: ["id", "user_id", "email"],
        verification_tokens: ["identifier", "token", "expires"],
      };

      const columnsResult = await sql`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY(${requiredTables})
      `;

      const foundColumnsByTable = new Map();
      for (const row of columnsResult) {
        if (!foundColumnsByTable.has(row.table_name)) {
          foundColumnsByTable.set(row.table_name, new Set());
        }
        foundColumnsByTable.get(row.table_name).add(row.column_name);
      }

      const columnDiscrepancies = [];
      for (const [table, expectedCols] of Object.entries(requiredColumns)) {
        const tableCols = foundColumnsByTable.get(table) || new Set();
        for (const col of expectedCols) {
          if (!tableCols.has(col)) {
            columnDiscrepancies.push(`${table}.${col}`);
          }
        }
      }

      if (columnDiscrepancies.length > 0) {
        console.error(`\n[FATAL] Incompatible baseline schema detected.`);
        console.error(`Missing required baseline columns: ${columnDiscrepancies.join(", ")}`);
        console.error(`Cannot adopt baseline safely. Please inspect the database.\n`);
        process.exit(1);
      }

      console.log(
        "[i] Detected complete, compatible pre-migration database with all 7 required baseline tables and verified columns."
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
